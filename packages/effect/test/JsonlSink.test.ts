import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import { TestConsole } from "effect/testing";

import * as JsonlSink from "../src/JsonlSink.ts";
import { otlpSpan, str } from "./support/spans.ts";

import type { JsonlSpanRecord } from "../src/format/Jsonl.ts";

// SAFETY: every line of the file is one JsonlSpanRecord, written by the sink through JSON.stringify of that
// same interface.
const records = (file: string): ReadonlyArray<JsonlSpanRecord> =>
    Arr.map(
        Arr.filter(readFileSync(file, "utf8").split("\n"), (l) => l.length > 0),
        (l) => JSON.parse(l) as JsonlSpanRecord,
    );

const open = (file: string, bodies?: boolean) =>
    JsonlSink.make({ file, runId: "run-1", bodies }).pipe(Effect.provide(NodeServices.layer));

const prompt = (spanId: string) =>
    otlpSpan({ name: "agent.match", spanId, attributes: [str("prompt.body", "Compare this ticket.")] });

describe("JsonlSink", () => {
    it.effect("creates the parent directories and appends one line per span across batches", () =>
        Effect.gen(function* () {
            const file = join(mkdtempSync(join(tmpdir(), "sink-")), "a", "b", "spans.jsonl");
            const write = yield* open(file);

            yield* write([otlpSpan({ name: "first", spanId: "s1" })]);
            yield* write([otlpSpan({ name: "second", spanId: "s2" }), otlpSpan({ name: "third", spanId: "s3" })]);

            const rows = records(file);
            assert.deepStrictEqual(
                Arr.map(rows, (r) => r.name),
                ["first", "second", "third"],
            );
            assert.isTrue(Arr.every(rows, (r) => r.run === "run-1"));
        }),
    );

    it.effect("stops writing after a failure and warns once", () =>
        Effect.gen(function* () {
            // A directory where the sink appends to a file makes every append fail with EISDIR, without
            // depending on filesystem permissions, which root ignores.
            const file = join(mkdtempSync(join(tmpdir(), "sink-")), "spans.jsonl");
            mkdirSync(file);
            const write = yield* open(file);

            yield* write([otlpSpan({ name: "first", spanId: "s1" })]);
            yield* write([otlpSpan({ name: "second", spanId: "s2" })]);

            assert.lengthOf(yield* TestConsole.errorLines, 1);
        }),
    );

    it.effect("with bodies, writes each body once next to the file, and a line that names it", () =>
        Effect.gen(function* () {
            const dir = mkdtempSync(join(tmpdir(), "sink-"));
            const file = join(dir, "spans.jsonl");
            const write = yield* open(file, true);

            yield* write([prompt("s1")]);
            yield* write([prompt("s2")]);

            const rows = records(file);
            assert.lengthOf(rows, 2);
            assert.isFalse("prompt.body" in (rows[0]?.attrs ?? {}));
            assert.strictEqual(rows[0]?.attrs["prompt.preview"], "Compare this ticket.");
            const sha = String(rows[0]?.attrs["prompt.sha256"]);
            assert.strictEqual(rows[1]?.attrs["prompt.sha256"], sha);
            assert.deepStrictEqual(readdirSync(join(dir, "bodies")), [`${sha}.txt`]);
            assert.strictEqual(readFileSync(join(dir, "bodies", `${sha}.txt`), "utf8"), "Compare this ticket.");
        }),
    );

    it.effect("without bodies, keeps the body text inline and creates no bodies directory", () =>
        Effect.gen(function* () {
            const dir = mkdtempSync(join(tmpdir(), "sink-"));
            const file = join(dir, "spans.jsonl");
            const write = yield* open(file);

            yield* write([prompt("s1")]);

            assert.strictEqual(records(file)[0]?.attrs["prompt.body"], "Compare this ticket.");
            assert.isFalse(existsSync(join(dir, "bodies")));
        }),
    );
});
