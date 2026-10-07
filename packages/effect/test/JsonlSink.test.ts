import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Effect } from "effect";
import { TestConsole } from "effect/testing";

import * as JsonlSink from "../src/JsonlSink.ts";
import { otlpSpan } from "./support/spans.ts";

import type { JsonlSpanRecord } from "../src/Jsonl.ts";

// SAFETY: every line of the file is one JsonlSpanRecord, written by the sink through JSON.stringify of that
// same interface.
const records = (file: string): ReadonlyArray<JsonlSpanRecord> =>
    Arr.map(
        Arr.filter(readFileSync(file, "utf8").split("\n"), (l) => l.length > 0),
        (l) => JSON.parse(l) as JsonlSpanRecord,
    );

const open = (file: string) => JsonlSink.make({ file, runId: "run-1" }).pipe(Effect.provide(NodeServices.layer));

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
});
