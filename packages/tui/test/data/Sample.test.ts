import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";

import { InputFile } from "../../src/data/InputFile.ts";
import { SpanSource } from "../../src/data/SpanSource.ts";
import { SpanStore } from "../../src/data/SpanStore.ts";

const sample = fileURLToPath(new URL("../fixtures/sample/spans.jsonl", import.meta.url));

const storeLayer = SpanStore.layer.pipe(
    Layer.provide(SpanSource.layer),
    Layer.provide(InputFile.layer({ file: sample, follow: false })),
    Layer.provide(NodeServices.layer),
);

describe("the sample fixture", () => {
    it.live("indexes completely through the real SpanSource and SpanStore under follow: false", () =>
        Effect.gen(function* () {
            const lines = Arr.filter(readFileSync(sample, "utf8").split("\n"), (text) => text.length > 0);
            const traces = new Set(Arr.map(lines, (text) => String(JSON.parse(text).trace)));

            const { snapshot } = yield* SpanStore;
            const done = yield* SubscriptionRef.changes(snapshot).pipe(
                Stream.filter((latest) => latest.status.phase === "done"),
                Stream.runHead,
                Effect.map(Option.getOrThrow),
                Effect.timeout("5 seconds"),
            );
            expect(done.runs.size).toBe(4);
            expect(done.runOrder).toHaveLength(4);
            expect(done.traces.size).toBe(traces.size);
            expect(done.traceOrder).toHaveLength(traces.size);
            expect(done.spanCount).toBe(lines.length);
            expect(done.badLines).toEqual({ legacy: 0, malformed: 0, samples: [] });
            expect(done.status.bytesRead).toBe(done.status.bytesTotal);
        }).pipe(Effect.provide(storeLayer)),
    );
});
