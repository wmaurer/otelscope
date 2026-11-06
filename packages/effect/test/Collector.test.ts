import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Layer } from "effect";
import { OtlpSerialization, OtlpTracer } from "effect/observability";
import { TestConsole } from "effect/testing";

import { OtelscopeTracer } from "../src/index.ts";
import { configured, env, recordingCollector } from "./support/collector.ts";

// Two spans, each over gzip's 1 KB minimum, so compression shows in the request.
const program = Effect.forEach(
    ["first", "second"],
    (name) => Effect.void.pipe(Effect.withSpan(name, { attributes: { padding: "x".repeat(2_000) } })),
    { discard: true },
);

// What Effect's own tracer sends for this environment.
const effectSends = (variables: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
        const collector = yield* recordingCollector();
        yield* program.pipe(
            Effect.provide(
                OtlpTracer.layerFromConfig({ resource: { serviceName: "test" } }).pipe(
                    Layer.provide([OtlpSerialization.layerProtobuf, collector.layer]),
                ),
            ),
            Effect.provide(env(variables)),
        );
        return Arr.map(yield* collector.received, configured);
    });

// What `OtelscopeTracer.layer` without a file sends for this environment.
const otelscopeSends = (variables: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
        const collector = yield* recordingCollector();
        yield* program.pipe(
            Effect.provide(OtelscopeTracer.layer({ serviceName: "test" })),
            Effect.provide([NodeServices.layer, collector.layer, env(variables)]),
        );
        return Arr.map(yield* collector.received, configured);
    });

const BASE = "http://collector.test:4318";

// `requests` is how many requests Effect's tracer makes for the two spans, so that a row cannot pass by both
// sides sending nothing.
const rows: ReadonlyArray<readonly [name: string, requests: number, variables: Readonly<Record<string, string>>]> = [
    ["nothing set", 0, {}],
    ["an endpoint without OTEL_TRACES_EXPORTER", 0, { OTEL_EXPORTER_OTLP_ENDPOINT: BASE }],
    ["otlp listed without an endpoint", 0, { OTEL_TRACES_EXPORTER: "otlp" }],
    ["the base endpoint", 1, { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: BASE }],
    [
        "the base endpoint with a trailing slash",
        1,
        { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: `${BASE}/` },
    ],
    ["the base endpoint with a path", 1, { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: `${BASE}/otlp` }],
    [
        "the traces endpoint, used as given and over the base one",
        1,
        {
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${BASE}/custom`,
        },
    ],
    [
        "an invalid traces endpoint beside a valid base one",
        1,
        {
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "not a url",
        },
    ],
    [
        "otlp among other exporters, in any case",
        1,
        { OTEL_TRACES_EXPORTER: " console, OTLP ", OTEL_EXPORTER_OTLP_ENDPOINT: BASE },
    ],
    [
        "OTEL_SDK_DISABLED",
        0,
        { OTEL_SDK_DISABLED: "true", OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: BASE },
    ],
    [
        "an invalid compression while disabled",
        0,
        {
            OTEL_SDK_DISABLED: "true",
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
            OTEL_EXPORTER_OTLP_COMPRESSION: "brotli",
        },
    ],
    [
        "base headers, percent-decoded",
        1,
        {
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
            OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20abc,x-tenant=t1",
        },
    ],
    [
        "traces headers over base headers",
        1,
        {
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
            OTEL_EXPORTER_OTLP_HEADERS: "x-base=1",
            OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-traces=2",
        },
    ],
    [
        "base gzip",
        1,
        { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: BASE, OTEL_EXPORTER_OTLP_COMPRESSION: "gzip" },
    ],
    [
        "traces none over base gzip",
        1,
        {
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
            OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
            OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: "none",
        },
    ],
    [
        "a batch size of one",
        2,
        { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: BASE, OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "1" },
    ],
];

describe("OtelscopeTracer.layer reads the collector from OTEL_*", () => {
    describe("sends what OtlpTracer.layerFromConfig sends", () => {
        for (const [name, requests, variables] of rows) {
            it.effect(`for ${name}`, () =>
                Effect.gen(function* () {
                    const expected = yield* effectSends(variables);
                    assert.lengthOf(expected, requests);
                    assert.deepStrictEqual(yield* otelscopeSends(variables), expected);
                    assert.deepStrictEqual(yield* TestConsole.errorLines, []);
                }),
            );
        }

        // The control: the comparison sees a wrong URL. A collector named by the base endpoint and one named by
        // the same URL as the traces endpoint are posted to at different paths.
        it.effect("and the comparison tells two different endpoints apart", () =>
            Effect.gen(function* () {
                assert.notDeepEqual(
                    yield* otelscopeSends({ OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: BASE }),
                    yield* effectSends({ OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: BASE }),
                );
            }),
        );
    });

    it.effect("turns the collector off with one line on stderr for an endpoint that is not http or https", () =>
        Effect.gen(function* () {
            const sent = yield* otelscopeSends({
                OTEL_TRACES_EXPORTER: "otlp",
                OTEL_EXPORTER_OTLP_ENDPOINT: "localhost:4318",
            });

            assert.deepStrictEqual(sent, []);
            const lines = yield* TestConsole.errorLines;
            assert.lengthOf(lines, 1);
            assert.match(String(lines[0]), /^otelscope: not sending spans to a collector: .*localhost:4318/);
        }),
    );

    it.effect("turns the collector off with one line on stderr naming an invalid variable", () =>
        Effect.gen(function* () {
            const sent = yield* otelscopeSends({
                OTEL_TRACES_EXPORTER: "otlp",
                OTEL_EXPORTER_OTLP_ENDPOINT: BASE,
                OTEL_EXPORTER_OTLP_COMPRESSION: "brotli",
            });

            assert.deepStrictEqual(sent, []);
            const lines = yield* TestConsole.errorLines;
            assert.lengthOf(lines, 1);
            assert.match(
                String(lines[0]),
                /^otelscope: not sending spans to a collector: .*OTEL_EXPORTER_OTLP_COMPRESSION/,
            );
            assert.notInclude(String(lines[0]), "\n");
        }),
    );
});
