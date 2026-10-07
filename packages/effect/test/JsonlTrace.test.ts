import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option } from "effect";

import { type JsonlSpanRecord, JsonlTrace } from "../src/index.ts";

const program = Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ "item.count": 3, "prompt.body": "p".repeat(300_000) });
    yield* Effect.logWarning("sample warning");
    yield* Effect.fail(new Error("boom")).pipe(Effect.withSpan("child.fails"), Effect.ignore);
}).pipe(Effect.withSpan("parent"));

const runIn = (file: string, runId?: string, bodies?: boolean) =>
    Effect.runPromise(
        program.pipe(
            Effect.provide(JsonlTrace.layer({ serviceName: "test", file, runId, bodies })),
            Effect.provide(NodeServices.layer),
        ),
    );

// SAFETY: every line of the file is one JsonlSpanRecord, written by the sink through JSON.stringify of that
// same interface.
const records = (file: string): ReadonlyArray<JsonlSpanRecord> =>
    Arr.map(
        Arr.filter(readFileSync(file, "utf8").split("\n"), (l) => l.length > 0),
        (l) => JSON.parse(l) as JsonlSpanRecord,
    );

const tempFile = () => join(mkdtempSync(join(tmpdir(), "jsonl-trace-")), "spans.jsonl");

describe("JsonlTrace.layer", () => {
    it("writes every span of the program, with parents, exits, attributes and log events", async () => {
        const file = tempFile();
        await runIn(file);

        const rows = records(file);
        const parent = Option.getOrUndefined(Arr.findFirst(rows, (r) => r.name === "parent"));
        const child = Option.getOrUndefined(Arr.findFirst(rows, (r) => r.name === "child.fails"));
        assert.lengthOf(rows, 2);
        assert.strictEqual(child?.parent, parent?.span);
        assert.strictEqual(child?.exit, "Failure");
        assert.strictEqual(parent?.exit, "Success");
        assert.isTrue(Arr.some(child?.events ?? [], (e) => e.name === "exception"));
        assert.isTrue(Arr.some(parent?.events ?? [], (e) => e.name === "sample warning"));
        assert.strictEqual(parent?.attrs["item.count"], 3);
    });

    it("names the run by start time and a random suffix when no run id is given", async () => {
        const file = tempFile();
        await runIn(file);

        assert.match(records(file)[0]?.run ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/);
    });

    it("appends a second run to the same file under its own run id", async () => {
        const file = tempFile();
        await runIn(file, "first");
        await runIn(file, "second");

        assert.deepStrictEqual(Arr.dedupe(Arr.map(records(file), (r) => r.run)), ["first", "second"]);
    });

    it("with bodies, moves a large body to a file and keeps the line short", async () => {
        const file = tempFile();
        await runIn(file, "run-1", true);

        const parent = Option.getOrUndefined(Arr.findFirst(records(file), (r) => r.name === "parent"));
        assert.strictEqual(parent?.attrs["prompt.bytes"], 300_000);
        assert.isBelow(readFileSync(file, "utf8").length, 10_000);
        assert.lengthOf(
            readFileSync(join(dirname(file), "bodies", `${String(parent?.attrs["prompt.sha256"])}.txt`), "utf8"),
            300_000,
        );
    });
});
