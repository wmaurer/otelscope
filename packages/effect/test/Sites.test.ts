import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Layer, Option, Ref, Tracer } from "effect";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import { type JsonlSpanRecord, ReceiverClient, spansOf, toRecord, withSites } from "../src/index.ts";
import { parseFrame } from "../src/Sites.ts";

describe("parseFrame", () => {
    it("reads the first frame of a tsx or CommonJS stack, dropping the function name", () => {
        assert.deepStrictEqual(
            parseFrame("Error\n    at <anonymous> (/app/src/main.ts:32:40)\n    at run (/app/src/run.ts:1:1)"),
            { file: "/app/src/main.ts", line: 32, col: 40 },
        );
    });

    it("reads a Node ESM frame, converting the file URL to a path", () => {
        assert.deepStrictEqual(parseFrame("Error\n    at file:///app/my%20dist/main.mjs:7:3"), {
            file: "/app/my dist/main.mjs",
            line: 7,
            col: 3,
        });
    });

    it("gives undefined for a stack without a file frame", () => {
        assert.isUndefined(parseFrame("Error\n    at new Promise (<anonymous>)"));
        assert.isUndefined(parseFrame(undefined));
    });
});

const traced = Effect.fn("traced.fn")(function* () {
    yield* Effect.void;
});

// The tracer a program builds itself from `OtlpTracer` and `ReceiverClient`, instead of using `JsonlTrace.layer`.
const recordsOf = (wrap: (tracer: Tracer.Tracer) => Tracer.Tracer) =>
    Effect.gen(function* () {
        const rows = yield* Ref.make<ReadonlyArray<JsonlSpanRecord>>([]);
        const otlp = OtlpTracer.layer({ url: "http://test.invalid/v1/traces", resource: { serviceName: "test" } }).pipe(
            Layer.provide(OtlpSerialization.layerJson),
            Layer.provide(
                ReceiverClient.layer((data) =>
                    Ref.update(rows, Arr.appendAll(Arr.map(spansOf(data), (s) => toRecord("run", "test", s)))),
                ),
            ),
        );
        const tracer = Layer.effect(Tracer.Tracer, Effect.map(Tracer.Tracer, wrap)).pipe(Layer.provide(otlp));
        yield* traced().pipe(Effect.provide(tracer));
        return Option.getOrThrow(Arr.findFirst(yield* Ref.get(rows), (r) => r.name === "traced.fn"));
    });

describe("withSites", () => {
    it.effect("gives the spans of a hand-built OTLP tracer a site, a def and a fiber", () =>
        Effect.gen(function* () {
            const row = yield* recordsOf(withSites);
            assert.strictEqual(row.site?.file, import.meta.filename);
            assert.strictEqual(row.def?.file, import.meta.filename);
            assert.isNumber(row.fiber);
        }),
    );

    it.effect("is what sets them: the same tracer without it records none", () =>
        Effect.gen(function* () {
            const row = yield* recordsOf((tracer) => tracer);
            assert.isNull(row.site);
            assert.isNull(row.def);
            assert.isNull(row.fiber);
        }),
    );
});
