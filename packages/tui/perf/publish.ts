import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Array as Arr, Console, Effect, FileSystem, Layer, Option, Order, Path, Stream, SubscriptionRef } from "effect";

import { Index } from "../src/data/Index.ts";
import { InputFile } from "../src/data/InputFile.ts";
import { SpanSource } from "../src/data/SpanSource.ts";
import { SpanStore } from "../src/data/SpanStore.ts";

import type { Status } from "../src/data/Snapshot.ts";

const PUBLISHES = 300;
const RECORDS_PER_PUBLISH = 500;
const WARMUP_PUBLISHES = 20;
const SPANS_PER_NEW_TRACE = 9;

const percentile = (samples: ReadonlyArray<number>, p: number): number => {
    const sorted = Arr.sort(samples, Order.Number);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const summary = (label: string, samples: ReadonlyArray<number>): string =>
    `${label}: n=${samples.length} p50=${percentile(samples, 50).toFixed(2)} p95=${percentile(samples, 95).toFixed(2)} max=${Math.max(...samples).toFixed(2)} ms`;

const following: Status = {
    phase: "following",
    bytesRead: 0,
    bytesTotal: 0,
    lastRecordAt: Option.none(),
    lastReset: Option.none(),
    error: Option.none(),
};

// The spec's live scenario: 5,000 spans/s for 30 s at one publish per 100 ms, half into new traces and half into
// existing ones. The bare copy of the previous traces map is timed beside each freeze because it is most of it.
const live = Effect.fnUntraced(function* (file: string) {
    const fs = yield* FileSystem.FileSystem;
    const lines = Arr.filter((yield* fs.readFileString(file)).split("\n"), (text) => text.length > 0);
    const index = new Index();
    Arr.forEach(lines, (text, i) => index.ingest(text, i + 1, 0, Option.none()));
    let snapshot = index.freeze(following);
    const traceIds = Arr.fromIterable(snapshot.traces.keys());
    const templates = Arr.map(Arr.take(lines, 5000), (text): object => JSON.parse(text));

    const publishes = Arr.makeBy(PUBLISHES, (publish) => {
        Arr.forEach(Arr.range(1, RECORDS_PER_PUBLISH), (i) => {
            const n = publish * RECORDS_PER_PUBLISH + i;
            const trace =
                i % 2 === 0
                    ? `live${String(Math.floor(n / (2 * SPANS_PER_NEW_TRACE))).padStart(28, "0")}`
                    : traceIds[(n * 7919) % traceIds.length];
            const span = `l${String(n).padStart(15, "0")}`;
            index.ingest(
                JSON.stringify({ ...templates[n % templates.length], trace, span, parent: null }),
                n,
                0,
                Option.some(n),
            );
        });
        const previous = snapshot.traces;
        const start = performance.now();
        snapshot = index.freeze(following);
        const frozen = performance.now();
        const copied = new Map(previous).size;
        return { freezeMs: frozen - start, copyMs: performance.now() - frozen, copied };
    });

    const measured = Arr.drop(publishes, WARMUP_PUBLISHES);
    yield* Console.log(
        `live: ${snapshot.spanCount} spans, ${snapshot.traces.size} traces, ${snapshot.badLines.malformed} bad lines, ` +
            `${Math.min(...Arr.map(measured, (p) => p.copied))} to ${Math.max(...Arr.map(measured, (p) => p.copied))} traces copied`,
    );
    yield* Console.log(
        summary(
            "freeze per publish",
            Arr.map(measured, (p) => p.freezeMs),
        ),
    );
    yield* Console.log(
        summary(
            "copy of the previous traces map",
            Arr.map(measured, (p) => p.copyMs),
        ),
    );
});

// The whole file through the real SpanSource and SpanStore under --no-follow, timing every freeze the store makes.
const full = Effect.fnUntraced(function* (file: string) {
    let freezes: ReadonlyArray<number> = [];
    // SAFETY: `freeze` is a method declared on `Index`, so its prototype holds it as a data property.
    const freeze = Object.getOwnPropertyDescriptor(Index.prototype, "freeze") as TypedPropertyDescriptor<
        Index["freeze"]
    >;
    Object.defineProperty(Index.prototype, "freeze", {
        value(this: Index, status: Status) {
            const start = performance.now();
            const result = freeze.value?.call(this, status);
            freezes = Arr.append(freezes, performance.now() - start);
            return result;
        },
    });
    const start = performance.now();
    const done = yield* Effect.gen(function* () {
        const { snapshot } = yield* SpanStore;
        return yield* SubscriptionRef.changes(snapshot).pipe(
            Stream.filter((s) => s.status.phase === "done"),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
        );
    }).pipe(
        Effect.scoped,
        Effect.provide(
            SpanStore.layer.pipe(
                Layer.provide(SpanSource.layer),
                Layer.provide(InputFile.layer({ file, follow: false })),
            ),
        ),
    );
    const total = performance.now() - start;
    yield* Console.log(
        `full: ${done.spanCount} spans, ${done.traces.size} traces, ${done.badLines.malformed} bad lines`,
    );
    yield* Console.log(
        `full index ${total.toFixed(0)} ms, ${freezes.length} freezes totalling ${Arr.reduce(freezes, 0, (a, b) => a + b).toFixed(0)} ms`,
    );
    yield* Console.log(summary("freeze while loading", freezes));
});

const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.resolve(import.meta.dirname, "../test/fixtures/huge/spans.jsonl");
    if (!(yield* fs.exists(file))) {
        return yield* Console.error(
            `missing ${file}; run pnpm exec tsx packages/effect/scripts/sample-fixture.ts huge`,
        );
    }
    const mode = process.argv[2];
    if (mode === "live") {
        return yield* live(file);
    }
    if (mode === "full") {
        return yield* full(file);
    }
    yield* Console.error("usage: perf/publish.ts live|full");
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
