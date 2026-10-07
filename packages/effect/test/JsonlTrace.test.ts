import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect, Option } from "effect";

import { type JsonlSpanRecord, JsonlTrace } from "../src/index.ts";

const program = Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ "item.count": 3 });
    yield* Effect.logWarning("rate limited, retrying");
    yield* Effect.fail(new Error("boom")).pipe(Effect.withSpan("child.fails"), Effect.ignore);
}).pipe(Effect.withSpan("parent"));

const runIn = (file: string, runId?: string) =>
    Effect.runPromise(
        program.pipe(
            Effect.provide(JsonlTrace.layer({ serviceName: "test", file, runId })),
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
        assert.isTrue(Arr.some(parent?.events ?? [], (e) => e.name === "rate limited, retrying"));
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
});
