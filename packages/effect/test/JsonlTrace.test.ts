import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Exit, Fiber, Option, Schedule, Schema } from "effect";
import { TestClock } from "effect/testing";

import { type JsonlSpanRecord, JsonlSpanRecord as RecordSchema, JsonlTrace } from "../src/index.ts";

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

const run = <A, E>(effect: Effect.Effect<A, E>, file: string, runId?: string, bodies?: boolean) =>
    Effect.runPromise(
        effect.pipe(
            Effect.provide(JsonlTrace.layer({ serviceName: "test", file, runId, bodies })),
            Effect.provide(NodeServices.layer),
        ),
    );

const lines = (file: string): ReadonlyArray<string> =>
    existsSync(file) ? Arr.filter(readFileSync(file, "utf8").split("\n"), (l) => l.length > 0) : [];

// SAFETY: every line of the file is one JsonlSpanRecord, written by the sink through JSON.stringify of that
// same type.
const records = (file: string): ReadonlyArray<JsonlSpanRecord> =>
    Arr.map(lines(file), (l) => JSON.parse(l) as JsonlSpanRecord);

const named = (rows: ReadonlyArray<JsonlSpanRecord>, name: string): JsonlSpanRecord | undefined =>
    Option.getOrUndefined(Arr.findFirst(rows, (r) => r.name === name));

const fiberOfLog = (row: JsonlSpanRecord | undefined, message: string) =>
    Option.getOrUndefined(Arr.findFirst(row?.events ?? [], (e) => e.name === message))?.attrs["effect.fiberId"];

const tempFile = () => join(mkdtempSync(join(tmpdir(), "jsonl-trace-")), "spans.jsonl");

const source = readFileSync(import.meta.filename, "utf8").split("\n");

// The 1-based line of this file that contains `text`, as a stack trace reports it.
const lineOf = (text: string): number =>
    Option.getOrThrow(Arr.findFirstIndex(source, (line) => line.includes(text))) + 1;

describe("JsonlTrace.layer", () => {
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

    it("writes lines that JsonlSpanRecord decodes", async () => {
        const file = tempFile();
        await run(program, file);
        await run(hooked, file);

        const decoded = Arr.map(lines(file), (line) => Schema.decodeUnknownExit(RecordSchema)(JSON.parse(line)));
        assert.lengthOf(decoded, 7);
        assert.isTrue(Arr.every(decoded, Exit.isSuccess));
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

describe("JsonlTrace.layer's tracer hook", () => {
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

describe("JsonlTrace.layer's export interval", () => {
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
                Effect.provide(JsonlTrace.layer({ serviceName: "test", file })),
                Effect.provide(NodeServices.layer),
            );
        }),
    );
});
