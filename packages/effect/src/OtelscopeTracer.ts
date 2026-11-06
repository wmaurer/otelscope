import { Array as Arr, DateTime, Effect, FileSystem, Layer, Option, Path, Random, Tracer } from "effect";
import { Digest } from "effect/crypto";
import { OtlpExporter, OtlpResource, OtlpSerialization, OtlpTracer } from "effect/observability";

import * as Collector from "./Collector.ts";
import { slimSpan } from "./format/Bodies.ts";
import { spansOf, type TraceData } from "./format/TraceData.ts";
import * as JsonlSink from "./JsonlSink.ts";
import * as ReceiverClient from "./ReceiverClient.ts";
import { withSites } from "./Sites.ts";

import type { Sink } from "./Sink.ts";
import type { HttpClient } from "effect/http";

export interface Options {
    readonly serviceName: string;
    // The JSONL file. Each batch is appended, so several runs can share one file and stay apart by `run`.
    // Omitted, no file is written, and spans go only to a collector the environment names.
    readonly file?: string | undefined;
    // The `run` value of every record. `makeRunId` gives the default.
    readonly runId?: string | undefined;
    // `true` replaces each `<prefix>.body` attribute by a reference, for the file and the collector alike. The
    // text is stored in `bodies/` next to `file`, or dropped when there is no file.
    readonly bodies?: boolean | undefined;
}

// `2026-10-06T14-03-27-412-9f3a`: sortable, free of colons, and distinct for two runs in one millisecond.
export const makeRunId: Effect.Effect<string> = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const suffix = yield* Random.nextIntBetween(0, 0xffff);
    const stamp = DateTime.formatIso(now).replace(/[:.]/g, "-").replace(/Z$/, "");
    return `${stamp}-${suffix.toString(16).padStart(4, "0")}`;
});

// Where spans go. A plan names at least one sink: with neither a file nor a collector there is no plan.
type Plan =
    | { readonly file: string; readonly collector: Collector.Settings | undefined }
    | { readonly file: undefined; readonly collector: Collector.Settings };

const planOf = (file: string | undefined, collector: Option.Option<Collector.Settings>): Plan | undefined => {
    if (file !== undefined) {
        return { file, collector: Option.getOrUndefined(collector) };
    }
    return Option.isSome(collector) ? { file, collector: collector.value } : undefined;
};

const collectorSink = (settings: Collector.Settings, options: Options) =>
    Effect.flatMap(OtlpResource.fromConfig({ serviceName: options.serviceName }), (resource) =>
        Collector.sink(settings, resource),
    );

const fileSink = (file: string, options: Options) =>
    Effect.flatMap(options.runId === undefined ? makeRunId : Effect.succeed(options.runId), (runId) =>
        JsonlSink.make({ file, runId, service: options.serviceName, bodies: options.bodies === true }),
    );

// The collector's sink is acquired first, so that its exporter flushes after the hub's.
const sinksOf = Effect.fnUntraced(function* (plan: Plan, options: Options) {
    if (plan.file === undefined) {
        return Arr.of(yield* collectorSink(plan.collector, options));
    }
    const collector = plan.collector === undefined ? [] : [yield* collectorSink(plan.collector, options)];
    return Arr.append(collector, yield* fileSink(plan.file, options));
});

// The one place a batch fans out. The hub never retries, because `ReceiverClient` always answers 200, so each
// span arrives here once. Bodies are slimmed once for every sink.
const ingestInto =
    (sinks: Arr.NonEmptyReadonlyArray<Sink>, bodies: boolean) =>
    (data: TraceData): Effect.Effect<void> =>
        Effect.gen(function* () {
            const spans = spansOf(data);
            if (spans.length === 0) {
                return;
            }
            const batch = bodies
                ? yield* Effect.forEach(spans, (span) => slimSpan(span)).pipe(Effect.provide(Digest.layerWebCrypto))
                : Arr.map(spans, (span) => ({ span, bodies: [] }));
            yield* Effect.forEach(sinks, (sink) => sink.write(batch), { discard: true });
        });

// The tracer posts here, but the request never reaches the network: `ReceiverClient` answers it in process.
const RECEIVER_URL = "http://otelscope.invalid/v1/traces";

// Effect's OTLP tracer, posting JSON to `ReceiverClient`: no network, no compression, no retries.
const hubTracer = (serviceName: string, ingest: (data: TraceData) => Effect.Effect<void>) =>
    OtlpTracer.make({
        url: RECEIVER_URL,
        resource: { serviceName },
        // Writes are local appends, so exporting often costs little, and a live viewer sees spans within about
        // a second instead of Effect's default of five.
        exportInterval: "1 second",
        // The receiver is local, so this bounds only the final write to the file and the push to the
        // collector's exporter. When the exporter reaches it, it drops every span still buffered.
        shutdownTimeout: "30 seconds",
    }).pipe(Effect.provide([OtlpSerialization.layerJson, ReceiverClient.layer(ingest), OtlpExporter.layerFlusher]));

// Installs one tracer whose spans reach the file when `options.file` is set, and the collector when the
// `OTEL_*` variables name one. With neither it installs nothing, and Effect's native tracer stays. Provide it as
// the outermost layer, so the tracer is installed before any other layer is built.
//
// It never fails. Invalid collector variables, an unwritable file and a failing collector are each reported
// once on stderr and cost only their own sink.
export const layer = (
    options: Options,
): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient> =>
    Layer.unwrap(
        Effect.gen(function* () {
            const plan = planOf(options.file, yield* Collector.settings);
            if (plan === undefined) {
                return Layer.empty;
            }
            // The layer's scope runs its finalizers in reverse: the hub's flush writes its last batch into the
            // sinks before the collector's exporter flushes.
            const sinks = yield* sinksOf(plan, options);
            const hub = yield* hubTracer(options.serviceName, ingestInto(sinks, options.bodies === true));
            return Layer.succeed(Tracer.Tracer, withSites(hub));
        }),
    );
