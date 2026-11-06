import { Array as Arr, Brand, Config, Console, Duration, Effect, Option, Ref, Schema, Version } from "effect";
import { type Headers, HttpClient, HttpClientError } from "effect/http";
import { OtlpExporter, type OtlpResource, OtlpSerialization } from "effect/observability";

import type { Sink } from "./Sink.ts";

// An absolute http or https URL. `localhost:4318` parses as a URL with the scheme `localhost:`, so it is not one.
export type HttpUrl = string & Brand.Brand<"HttpUrl">;

const HttpUrl = Brand.make<HttpUrl>((url) => /^https?:\/\//.test(url));

// The OTLP collector the environment names, parsed once when the tracer layer is built.
export interface Settings {
    readonly url: HttpUrl;
    readonly headers: Headers.Input | undefined;
    readonly compression: "gzip" | "none";
    readonly exportInterval: Duration.Duration;
    readonly maxBatchSize: number;
    readonly shutdownTimeout: Duration.Duration;
    readonly requestTimeout: Duration.Duration;
}

// Effect 4.1's `internal/otlpEnv.ts`, rewritten on the public `Config` API because it is not exported.
// `test/Collector.test.ts` compares the result with `OtlpTracer.layerFromConfig`.
const exporterList = (path: string) =>
    Config.Array(Schema.String, path).pipe(
        Config.map((names) =>
            Arr.filter(
                Arr.map(names, (name) => name.toLowerCase().trim()),
                (name) => name !== "",
            ),
        ),
    );

const headersRecord = (path: string) => Config.Record(Schema.String, Schema.StringFromUriComponent, path);

const tracesHeaders = headersRecord("OTEL_EXPORTER_OTLP_TRACES_HEADERS").pipe(
    Config.orElse(() => headersRecord("OTEL_EXPORTER_OTLP_HEADERS")),
    Config.withDefault(undefined),
);

const tracesEndpoint = Config.URL("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").pipe(
    Config.orElse(() =>
        Config.URL("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
            Config.map((url) => {
                const slash = url.pathname.endsWith("/") ? "" : "/";
                url.pathname += `${slash}v1/traces`;
                return url;
            }),
        ),
    ),
    Config.withDefault(undefined),
);

const tracesExporters = exporterList("OTEL_TRACES_EXPORTER").pipe(Config.withDefault<ReadonlyArray<string>>([]));

const off = (reason: string) =>
    Effect.as(Console.error(`otelscope: not sending spans to a collector: ${reason}`), Option.none<Settings>());

// A schema error spans several lines, the last naming the variable. stderr gets one line.
const oneLine = (error: Config.ConfigError): string => error.cause.message.replaceAll(/\s*\n\s*/g, " ");

// Reads the collector with the rules of Effect 4.1's `OtlpTracer.layerFromConfig`, in the same two steps, so
// that an invalid compression is ignored while the collector is off. `None` when `OTEL_SDK_DISABLED` is true,
// when no endpoint is set, or when `OTEL_TRACES_EXPORTER` does not list `otlp`. Two rules are stricter than
// Effect's: the endpoint must be an http or https URL, and a variable that is set but invalid prints one line
// on stderr and turns the collector off, where Effect dies while building the layer.
export const settings: Effect.Effect<Option.Option<Settings>> = Effect.gen(function* () {
    const { disabled, endpoint, exporters } = yield* Config.all({
        disabled: Config.Boolean("OTEL_SDK_DISABLED").pipe(Config.withDefault(false)),
        endpoint: tracesEndpoint,
        exporters: tracesExporters,
    });
    if (disabled || endpoint === undefined || !Arr.contains(exporters, "otlp")) {
        return Option.none();
    }
    const url = HttpUrl.option(endpoint.toString());
    if (Option.isNone(url)) {
        return yield* off(`the traces endpoint ${endpoint.toString()} is not an http or https URL`);
    }

    const env = yield* Config.all({
        baseCompression: Config.option(Config.Literals(["gzip", "none"], "OTEL_EXPORTER_OTLP_COMPRESSION")),
        compression: Config.option(Config.Literals(["gzip", "none"], "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION")),
        baseTimeout: Config.option(Config.Int("OTEL_EXPORTER_OTLP_TIMEOUT")),
        tracesTimeout: Config.option(Config.Int("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT")),
        exportTimeout: Config.option(Config.Int("OTEL_BSP_EXPORT_TIMEOUT")),
        scheduleDelay: Config.option(Config.Int("OTEL_BSP_SCHEDULE_DELAY")),
        maxBatchSize: Config.option(Config.Int("OTEL_BSP_MAX_EXPORT_BATCH_SIZE")),
        headers: tracesHeaders,
    });
    const requestTimeout = Option.firstSomeOf([env.tracesTimeout, env.baseTimeout]);

    return Option.some<Settings>({
        url: url.value,
        headers: env.headers,
        compression: Option.getOrElse(Option.firstSomeOf([env.compression, env.baseCompression]), () => "none"),
        exportInterval: Duration.millis(Option.getOrElse(env.scheduleDelay, () => 5_000)),
        maxBatchSize: Option.getOrElse(env.maxBatchSize, () => 1_000),
        shutdownTimeout: Duration.millis(
            Option.getOrElse(Option.firstSomeOf([requestTimeout, env.exportTimeout]), () => 3_000),
        ),
        requestTimeout: Duration.millis(Option.getOrElse(requestTimeout, () => 10_000)),
    });
}).pipe(Effect.catchTag("ConfigError", (error) => off(oneLine(error))));

// What `OtlpTracer.make` writes as the instrumentation scope.
const scope = { name: "effect", version: Version.getCurrentVersion() };

// A sink that pushes each span into an exporter of its own, so the collector keeps Effect's batching, gzip,
// retries of transient failures, 60-second pause after a failed export, and final flush. Its finalizer
// flushes it, so it must be acquired before the exporter that feeds it, which then flushes into it first.
export const sink = Effect.fnUntraced(function* (settings: Settings, resource: OtlpResource.Resource) {
    const warned = yield* Ref.make(false);
    const warnOnce = (error: HttpClientError.HttpClientError) =>
        Effect.flatMap(Ref.getAndSet(warned, true), (done) =>
            done ? Effect.void : Console.error(`otelscope: the collector at ${settings.url} failed: ${error.message}`),
        );
    const client = (yield* HttpClient.HttpClient).pipe(
        // So that an error status is reported too. The exporter also filters, then retries what is transient.
        HttpClient.filterStatusOk,
        // A collector that accepts the connection and never answers, such as a dead tunnel, would otherwise
        // hold the export forever. A transport error is transient, so the exporter retries it.
        HttpClient.transform((response, request) =>
            Effect.timeoutOrElse(response, {
                duration: settings.requestTimeout,
                orElse: () =>
                    Effect.fail(
                        new HttpClientError.HttpClientError({
                            reason: new HttpClientError.TransportError({
                                request,
                                description: `no answer within ${Duration.format(settings.requestTimeout)}`,
                            }),
                        }),
                    ),
            }),
        ),
        HttpClient.tapError(warnOnce),
    );
    const serialization = yield* OtlpSerialization.OtlpSerialization;
    const exporter = yield* OtlpExporter.make({
        // `OtlpTracer`'s label, so the collector sees the user agent `layerFromConfig` sends.
        label: "OtlpTracer",
        url: settings.url,
        headers: settings.headers,
        compression: settings.compression,
        exportInterval: settings.exportInterval,
        maxBatchSize: settings.maxBatchSize,
        shutdownTimeout: settings.shutdownTimeout,
        body: (spans) => [
            serialization.traces({ resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] }),
            Effect.void,
        ],
    }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.provide(OtlpExporter.layerFlusher));

    return {
        write: (batch) => Effect.sync(() => Arr.forEach(batch, (slim) => exporter.push(slim.span))),
    } satisfies Sink;
}, Effect.provide(OtlpSerialization.layerProtobuf));
