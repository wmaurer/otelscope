import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Fiber, Layer, Option, Order, pipe, Schedule, Schema, Tracer } from "effect";
import { TestClock, TestConsole } from "effect/testing";

import { type JsonlSpanRecord, OtelscopeTracer, JsonlSpanRecord as RecordSchema } from "../src/index.ts";
import { env, type Received, recordingCollector, spansIn } from "./support/collector.ts";

const program = Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ "item.count": 3, "prompt.body": "p".repeat(300_000) });
    yield* Effect.logWarning("sample warning");
    yield* Effect.fail(new Error("boom")).pipe(Effect.withSpan("child.fails"), Effect.ignore);
}).pipe(Effect.withSpan("parent"));

const traced = Effect.fn("traced.fn")(function* () {
    yield* Effect.log("in traced.fn");
});

const hooked = Effect.gen(function* () {
    yield* Effect.log("in hooked");
    yield* Effect.void.pipe(Effect.withSpan("located"));
    yield* traced();
    yield* Effect.withSpan(Effect.void, "uncaptured", { captureStackTrace: false });
    yield* Effect.log("in forked").pipe(Effect.withSpan("forked"), Effect.forkChild, Effect.flatMap(Fiber.join));
}).pipe(Effect.withSpan("hooked"));

// No collector variables, so the file is the only sink.
const fileOnly = Effect.map(recordingCollector(), (collector) =>
    Layer.mergeAll(NodeServices.layer, collector.layer, env({})),
);

const run = <A, E>(effect: Effect.Effect<A, E>, file: string, runId?: string, bodies?: boolean) =>
    Effect.runPromise(
        Effect.flatMap(fileOnly, (services) =>
            effect.pipe(
                Effect.provide(OtelscopeTracer.layer({ serviceName: "test", file, runId, bodies })),
                Effect.provide(services),
            ),
        ),
    );

const lines = (file: string): ReadonlyArray<string> =>
    existsSync(file) ? Arr.filter(readFileSync(file, "utf8").split("\n"), (l) => l.length > 0) : [];

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(RecordSchema));

const records = (file: string): ReadonlyArray<JsonlSpanRecord> =>
    Arr.map(lines(file), (l) => Option.getOrThrow(decodeLine(l)));

const named = (rows: ReadonlyArray<JsonlSpanRecord>, name: string): JsonlSpanRecord | undefined =>
    Option.getOrUndefined(Arr.findFirst(rows, (r) => r.name === name));

const fiberOfLog = (row: JsonlSpanRecord | undefined, message: string) =>
    Option.getOrUndefined(Arr.findFirst(row?.events ?? [], (e) => e.name === message))?.attrs["effect.fiberId"];

const tempFile = () => join(mkdtempSync(join(tmpdir(), "jsonl-trace-")), "spans.jsonl");

const source = readFileSync(import.meta.filename, "utf8").split("\n");

const lineOf = (text: string): number =>
    Option.getOrThrow(Arr.findFirstIndex(source, (line) => line.includes(text))) + 1;

describe("OtelscopeTracer.layer with a file", () => {
    it("writes every span of the program, with parents, exits, attributes and log events", async () => {
        const file = tempFile();
        await run(program, file);

        const rows = records(file);
        const parent = named(rows, "parent");
        const child = named(rows, "child.fails");
        assert.lengthOf(rows, 2);
        assert.strictEqual(child?.parent, parent?.span);
        assert.strictEqual(child?.exit, "Failure");
        assert.strictEqual(parent?.exit, "Success");
        assert.isTrue(Arr.some(child?.events ?? [], (e) => e.name === "exception"));
        assert.isTrue(Arr.some(parent?.events ?? [], (e) => e.name === "sample warning"));
        assert.strictEqual(parent?.attrs["item.count"], 3);
        assert.isTrue(Arr.every(rows, (r) => r.service === "test"));
    });

    it("writes Interrupted for a span whose fiber was interrupted", async () => {
        const file = tempFile();
        await run(Effect.never.pipe(Effect.withSpan("cut"), Effect.timeout("10 millis"), Effect.ignore), file);

        const cut = named(records(file), "cut");
        assert.strictEqual(cut?.exit, "Interrupted");
    });

    it("writes lines that JsonlSpanRecord decodes", async () => {
        const file = tempFile();
        await run(program, file);
        await run(hooked, file);

        const decoded = Arr.map(lines(file), (line) => decodeLine(line));
        assert.lengthOf(decoded, 7);
        assert.isTrue(Arr.every(decoded, Option.isSome));
    });

    it("writes a batch whose span has a NaN or infinite number attribute, with null for those values", async () => {
        const file = tempFile();
        const nonFinite = Effect.void.pipe(
            Effect.withSpan("ratio", {
                attributes: { "ratio.nan": NaN, "ratio.max": Infinity, "ratio.min": -Infinity },
            }),
            Effect.andThen(Effect.void.pipe(Effect.withSpan("plain"))),
        );
        await run(nonFinite, file);

        const rows = records(file);
        assert.deepStrictEqual(
            Arr.sort(
                Arr.map(rows, (r) => r.name),
                Order.String,
            ),
            ["plain", "ratio"],
        );
        const ratio = named(rows, "ratio");
        assert.isNull(ratio?.attrs["ratio.nan"]);
        assert.isNull(ratio?.attrs["ratio.max"]);
        assert.isNull(ratio?.attrs["ratio.min"]);
    });

    it("names the run by start time and a random suffix when no run id is given", async () => {
        const file = tempFile();
        await run(program, file);

        assert.match(records(file)[0]?.run ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/);
    });

    it("appends a second run to the same file under its own run id", async () => {
        const file = tempFile();
        await run(program, file, "first");
        await run(program, file, "second");

        assert.deepStrictEqual(Arr.dedupe(Arr.map(records(file), (r) => r.run)), ["first", "second"]);
    });

    it("with bodies, moves a large body to a file and keeps the line short", async () => {
        const file = tempFile();
        await run(program, file, "run-1", true);

        const parent = named(records(file), "parent");
        assert.strictEqual(parent?.attrs["prompt.bytes"], 300_000);
        assert.isBelow(readFileSync(file, "utf8").length, 10_000);
        assert.lengthOf(
            readFileSync(join(dirname(file), "bodies", `${String(parent?.attrs["prompt.sha256"])}.txt`), "utf8"),
            300_000,
        );
    });
});

describe("OtelscopeTracer.layer's tracer hook", () => {
    it("gives a withSpan span the location of its withSpan call, and no def", async () => {
        const file = tempFile();
        await run(hooked, file);

        const located = named(records(file), "located");
        assert.strictEqual(located?.site?.file, import.meta.filename);
        assert.strictEqual(located?.site?.line, lineOf('Effect.withSpan("located")'));
        assert.isNull(located?.def);
        assert.deepStrictEqual(
            Arr.filter(
                Object.keys(located?.attrs ?? {}),
                (key) => key.startsWith("code.") || key.startsWith("otelscope."),
            ),
            [],
        );
    });

    it("gives an Effect.fn span the location of its call as site and of its definition as def", async () => {
        const file = tempFile();
        await run(hooked, file);

        const fn = named(records(file), "traced.fn");
        assert.strictEqual(fn?.site?.file, import.meta.filename);
        assert.strictEqual(fn?.site?.line, lineOf("yield* traced()"));
        assert.strictEqual(fn?.def?.file, import.meta.filename);
        assert.strictEqual(fn?.def?.line, lineOf('Effect.fn("traced.fn")'));
    });

    it("gives a span opened with captureStackTrace: false neither site nor def", async () => {
        const file = tempFile();
        await run(hooked, file);

        const uncaptured = named(records(file), "uncaptured");
        assert.isNull(uncaptured?.site);
        assert.isNull(uncaptured?.def);
    });

    it("records the fiber a span was opened on, as effect.fiberId on its logs, and a forked span's own fiber", async () => {
        const file = tempFile();
        await run(hooked, file);

        const rows = records(file);
        const parent = named(rows, "hooked");
        const forked = named(rows, "forked");
        assert.isNumber(parent?.fiber);
        assert.strictEqual(parent?.fiber, fiberOfLog(parent, "in hooked"));
        assert.isNumber(forked?.fiber);
        assert.strictEqual(forked?.fiber, fiberOfLog(forked, "in forked"));
        assert.notStrictEqual(forked?.fiber, parent?.fiber);
    });

    it("never fails the program, even when reading a stack frame throws", async () => {
        const file = tempFile();
        const unreadable = Effect.withSpan(Effect.succeed(42), "unreadable", {
            captureStackTrace: () => {
                throw new Error("no stack");
            },
        });

        assert.strictEqual(await run(unreadable, file), 42);
        const row = named(records(file), "unreadable");
        assert.isNull(row?.site);
        assert.isNumber(row?.fiber);
    });
});

// Waits on the live clock, while the program and its exporter run on the test clock.
const waitForLines = (file: string, count: number) =>
    TestClock.withLive(
        Effect.suspend(() => (lines(file).length >= count ? Effect.void : Effect.fail("pending"))).pipe(
            Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 300 }),
            Effect.ignore,
        ),
    );

const settle = TestClock.withLive(Effect.sleep("50 millis"));

describe("OtelscopeTracer.layer's export interval", () => {
    it.effect("writes the spans ended in each second as one batch at the end of that second", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const names = () => Arr.map(records(file), (r) => r.name);

            yield* Effect.gen(function* () {
                yield* Effect.void.pipe(Effect.withSpan("first"));
                yield* TestClock.adjust("999 millis");
                yield* settle;
                assert.deepStrictEqual(names(), []);

                yield* TestClock.adjust("1 millis");
                yield* waitForLines(file, 1);
                assert.deepStrictEqual(names(), ["first"]);
                yield* settle;

                yield* Effect.void.pipe(Effect.withSpan("second"));
                yield* TestClock.adjust("999 millis");
                yield* settle;
                assert.deepStrictEqual(names(), ["first"]);

                yield* TestClock.adjust("1 millis");
                yield* waitForLines(file, 2);
                assert.deepStrictEqual(names(), ["first", "second"]);
            }).pipe(
                Effect.provide(OtelscopeTracer.layer({ serviceName: "test", file })),
                Effect.provide(yield* fileOnly),
            );
        }),
    );
});

const COLLECTOR = { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.test:4318" };

// Runs `effect` under the tracer with a recording collector, moving the test clock until it ends, so the
// collector's retry delays and the final flush complete. Returns what the collector received.
const withCollector = <A, E>(
    effect: Effect.Effect<A, E>,
    options: {
        readonly file?: string;
        readonly bodies?: boolean;
        readonly variables?: Readonly<Record<string, string>>;
        readonly status?: (n: number) => number;
    },
) =>
    Effect.gen(function* () {
        const collector = yield* recordingCollector(options.status);
        const fiber = yield* effect.pipe(
            Effect.provide(OtelscopeTracer.layer({ serviceName: "test", file: options.file, bodies: options.bodies })),
            Effect.provide([NodeServices.layer, collector.layer, env(options.variables ?? COLLECTOR)]),
            Effect.forkChild,
        );
        yield* Effect.andThen(TestClock.adjust("500 millis"), TestClock.withLive(Effect.sleep("5 millis"))).pipe(
            Effect.repeat({ while: () => fiber.pollUnsafe() === undefined, times: 400 }),
        );
        yield* Fiber.join(fiber);
        return yield* collector.received;
    });

const twoSpans = Effect.void.pipe(
    Effect.withSpan("child", { attributes: { padding: "x".repeat(2_000) } }),
    Effect.withSpan("root"),
);

const collectedNames = (received: ReadonlyArray<Received>) =>
    pipe(
        Arr.flatMap(received, spansIn),
        Arr.map((span) => span.name),
        Arr.sort(Order.String),
    );

const recordNames = (file: string) =>
    Arr.sort(
        Arr.map(records(file), (r) => r.name),
        Order.String,
    );

describe("OtelscopeTracer.layer with a collector", () => {
    it.effect("installs no tracer with neither a file nor a collector, so Effect's native tracer stays", () =>
        Effect.gen(function* () {
            const outside = yield* Tracer.Tracer;
            const collector = yield* recordingCollector();
            const inside = yield* Tracer.Tracer.pipe(
                Effect.provide(OtelscopeTracer.layer({ serviceName: "test" })),
                Effect.provide([NodeServices.layer, collector.layer, env({})]),
            );

            assert.strictEqual(inside, outside);
            assert.deepStrictEqual(yield* collector.received, []);
            assert.deepStrictEqual(yield* TestConsole.errorLines, []);
        }),
    );

    it.effect("sends every span to the collector, without a file", () =>
        Effect.gen(function* () {
            const received = yield* withCollector(twoSpans, {});

            assert.deepStrictEqual(collectedNames(received), ["child", "root"]);
            assert.deepStrictEqual(yield* TestConsole.errorLines, []);
        }),
    );

    it.effect("sends a span ended just before the layer closes, because the hub flushes into the collector first", () =>
        Effect.gen(function* () {
            const received = yield* withCollector(
                Effect.andThen(Effect.sleep("10 seconds"), Effect.void.pipe(Effect.withSpan("last"))),
                {},
            );

            assert.deepStrictEqual(collectedNames(received), ["last"]);
        }),
    );

    it.effect("writes the file and sends to the collector the same spans, with the same ids", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const received = yield* withCollector(twoSpans, { file });

            const collected = Arr.flatMap(received, spansIn);
            assert.deepStrictEqual(collectedNames(received), ["child", "root"]);
            assert.deepStrictEqual(
                Arr.sort(
                    Arr.map(records(file), (r) => `${r.trace}/${r.span}`),
                    Order.String,
                ),
                Arr.sort(
                    Arr.map(collected, (s) => `${s.traceId}/${s.spanId}`),
                    Order.String,
                ),
            );
        }),
    );

    it.effect("writes each span to the file once while the collector answers 503, 503, then 200", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const received = yield* withCollector(twoSpans, { file, status: (n) => (n < 2 ? 503 : 200) });

            assert.lengthOf(received, 3);
            assert.deepStrictEqual(collectedNames([received[2] ?? assert.fail("no third post")]), ["child", "root"]);
            assert.deepStrictEqual(recordNames(file), ["child", "root"]);
            const lines = yield* TestConsole.errorLines;
            assert.lengthOf(lines, 1);
            assert.match(
                String(lines[0]),
                /^otelscope: the collector at http:\/\/collector\.test:4318\/v1\/traces failed/,
            );
        }),
    );

    it.effect("gzips the request with OTEL_EXPORTER_OTLP_COMPRESSION=gzip, and the file still gets every span", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const received = yield* withCollector(twoSpans, {
                file,
                variables: { ...COLLECTOR, OTEL_EXPORTER_OTLP_COMPRESSION: "gzip" },
            });

            assert.isTrue(Arr.every(received, (r) => r.headers["content-encoding"] === "gzip"));
            assert.deepStrictEqual(collectedNames(received), ["child", "root"]);
            assert.deepStrictEqual(recordNames(file), ["child", "root"]);
        }),
    );

    it.effect(
        "with bodies, sends the collector the reference instead of a 1 MB body, and stores the body by the file",
        () =>
            Effect.gen(function* () {
                const file = tempFile();
                const big = Effect.void.pipe(
                    Effect.withSpan("ask", { attributes: { "prompt.body": "p".repeat(1_000_000) } }),
                );
                const received = yield* withCollector(big, { file, bodies: true });

                const [sent] = Arr.flatMap(received, spansIn);
                const recorded = named(records(file), "ask");
                assert.deepStrictEqual(
                    Arr.sort(
                        Arr.filter(Object.keys(sent?.attributes ?? {}), (key) => key.startsWith("prompt.")),
                        Order.String,
                    ),
                    ["prompt.bytes", "prompt.preview", "prompt.sha256"],
                );
                assert.isTrue(Arr.every(Object.values(sent?.attributes ?? {}), (value) => String(value).length <= 200));
                assert.strictEqual(sent?.attributes["prompt.sha256"], recorded?.attrs["prompt.sha256"]);
                assert.strictEqual(recorded?.attrs["prompt.preview"], "p".repeat(200));
                assert.lengthOf(
                    readFileSync(
                        join(dirname(file), "bodies", `${String(recorded?.attrs["prompt.sha256"])}.txt`),
                        "utf8",
                    ),
                    1_000_000,
                );
            }),
    );

    it.effect("prints one line and still writes the whole file when the collector refuses everything", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const many = Effect.forEach(Arr.range(1, 5), (i) => Effect.void.pipe(Effect.withSpan(`step-${i}`)), {
                discard: true,
            });
            const received = yield* withCollector(many, { file, status: () => 503 });

            assert.isAbove(received.length, 0);
            assert.lengthOf(records(file), 5);
            assert.lengthOf(yield* TestConsole.errorLines, 1);
        }),
    );

    it.effect("prints one line and still sends every span to the collector when the file cannot be written", () =>
        Effect.gen(function* () {
            // A directory where the sink appends to a file fails every append, also for root.
            const file = tempFile();
            mkdirSync(file);
            const received = yield* withCollector(twoSpans, { file });

            assert.deepStrictEqual(collectedNames(received), ["child", "root"]);
            const lines = yield* TestConsole.errorLines;
            assert.lengthOf(lines, 1);
            assert.match(String(lines[0]), /^otelscope: stopped writing /);
        }),
    );

    it.effect("prints one line and writes only the file for an endpoint that is not an http URL", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const received = yield* withCollector(twoSpans, {
                file,
                variables: { OTEL_TRACES_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: "localhost:4318" },
            });

            assert.deepStrictEqual(received, []);
            assert.deepStrictEqual(recordNames(file), ["child", "root"]);
            const lines = yield* TestConsole.errorLines;
            assert.lengthOf(lines, 1);
            assert.match(String(lines[0]), /^otelscope: not sending spans to a collector: .*localhost:4318/);
        }),
    );
});
