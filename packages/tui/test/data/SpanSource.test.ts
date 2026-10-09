import {
    appendFileSync,
    chmodSync,
    closeSync,
    openSync,
    renameSync,
    rmSync,
    truncateSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Predicate, Queue, Stream } from "effect";

import { InputFile } from "../../src/data/InputFile.ts";
import { SpanSource, TailEvent } from "../../src/data/SpanSource.ts";
import { tempDir, tempFile, utf8Length } from "../support/files.ts";

const sourceLayer = (file: string, follow: boolean) =>
    SpanSource.layer.pipe(
        Layer.provide(InputFile.layer({ file, follow, pollMillis: 20 })),
        Layer.provide(NodeServices.layer),
    );

const follow = Effect.fnUntraced(function* (file: string) {
    const { events } = yield* Effect.provide(Effect.service(SpanSource), sourceLayer(file, true));
    const queue = yield* Queue.unbounded<TailEvent>();
    yield* events.pipe(
        Stream.runForEach((event) => Queue.offer(queue, event)),
        Effect.forkScoped,
    );
    return {
        next: Queue.take(queue).pipe(
            Effect.timeoutOption("2 seconds"),
            Effect.map(Option.getOrElse(() => "no event within 2 s")),
        ),
    };
});

const readOnce = (file: string) =>
    Effect.flatMap(Effect.provide(Effect.service(SpanSource), sourceLayer(file, false)), ({ events }) =>
        Stream.runCollect(events),
    );

const Lines = (lines: ReadonlyArray<string>, offsets: ReadonlyArray<number>, firstLine: number, size: number) =>
    TailEvent.Lines({ lines, offsets, firstLine, size });

describe("SpanSource", () => {
    it.live("emits appended lines with offsets and line numbers, then catches up", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "one\ntwo\n");
            const { next } = yield* follow(file);
            expect(yield* next, "initial lines").toEqual(Lines(["one", "two"], [0, 4], 1, 8));
            expect(yield* next, "initial catch-up").toEqual(TailEvent.CaughtUp({ size: 8 }));

            appendFileSync(file, "three\n");
            expect(yield* next, "appended line").toEqual(Lines(["three"], [8], 3, 14));
            expect(yield* next, "caught up after the append").toEqual(TailEvent.CaughtUp({ size: 14 }));
        }),
    );

    it.live("holds back a partial last line until its newline arrives", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "one\ntw");
            const { next } = yield* follow(file);
            expect(yield* next, "only the complete line").toEqual(Lines(["one"], [0], 1, 6));
            expect(yield* next, "caught up with the partial line pending").toEqual(TailEvent.CaughtUp({ size: 6 }));

            appendFileSync(file, "o\n");
            expect(yield* next, "the completed line").toEqual(Lines(["two"], [4], 2, 8));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 8 }));
        }),
    );

    it.live("decodes a multi-byte character split across a 1 MiB slice", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const long = `${"x".repeat(1024 * 1024 - 1)}é`;
            writeFileSync(file, `${long}\nz\n`);
            const size = utf8Length(long) + 3;
            expect(yield* readOnce(file)).toEqual([
                Lines([long, "z"], [0, utf8Length(long) + 1], 1, size),
                TailEvent.CaughtUp({ size }),
            ]);
        }),
    );

    it.live("resets on truncation and reads the file again from the start", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "first line\nsecond line\n");
            const { next } = yield* follow(file);
            yield* next;
            yield* next;

            truncateSync(file, 0);
            appendFileSync(file, "new\n");
            expect(yield* next, "reset").toEqual(TailEvent.Reset({ reason: "truncated" }));
            expect(yield* next, "re-read from 0").toEqual(Lines(["new"], [0], 1, 4));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 4 }));
        }),
    );

    it.live("resets when the file is replaced by a rename", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "old\n");
            const { next } = yield* follow(file);
            yield* next;
            yield* next;

            const replacement = join(dirname(file), "replacement.tmp");
            writeFileSync(replacement, "old\nnew\n");
            renameSync(replacement, file);
            expect(yield* next, "reset").toEqual(TailEvent.Reset({ reason: "replaced" }));
            expect(yield* next, "the new file from 0").toEqual(Lines(["old", "new"], [0, 4], 1, 8));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 8 }));
        }),
    );

    it.live("reports a removed file as a reset and missing, then reads it when it comes back", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "one\n");
            const { next } = yield* follow(file);
            yield* next;
            yield* next;

            rmSync(file);
            expect(yield* next, "reset").toEqual(TailEvent.Reset({ reason: "removed" }));
            expect(yield* next, "missing").toEqual(TailEvent.Missing());

            writeFileSync(file, "again\n");
            expect(yield* next, "the recreated file").toEqual(Lines(["again"], [0], 1, 6));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 6 }));
        }),
    );

    it.live("resets when the head changes at the same size", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "aaaa\n");
            const { next } = yield* follow(file);
            yield* next;
            yield* next;

            const fd = openSync(file, "r+");
            writeSync(fd, "bbbb\n", 0);
            closeSync(fd);
            expect(yield* next, "reset").toEqual(TailEvent.Reset({ reason: "truncated" }));
            expect(yield* next, "the rewritten line").toEqual(Lines(["bbbb"], [0], 1, 5));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 5 }));
        }),
    );

    it.live("reports a file missing at start once, then reads it when it is created", () =>
        Effect.gen(function* () {
            const file = tempFile();
            const { next } = yield* follow(file);
            expect(yield* next, "missing").toEqual(TailEvent.Missing());

            writeFileSync(file, "late\n");
            expect(yield* next, "missing is reported once, then the lines").toEqual(Lines(["late"], [0], 1, 5));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 5 }));
        }),
    );

    // Root reads any file regardless of its mode.
    it.live.skipIf(process.getuid?.() === 0)("reports a read error and recovers on a later wake-up", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "one\n");
            chmodSync(file, 0o000);
            const { next } = yield* follow(file);
            expect(yield* next, "the stream reports the error instead of failing").toMatchObject({ _tag: "Failed" });

            chmodSync(file, 0o644);
            let event = yield* next;
            while (Predicate.isTagged(event, "Failed")) {
                event = yield* next;
            }
            expect(event, "read once the file is readable").toEqual(Lines(["one"], [0], 1, 4));
            expect(yield* next).toEqual(TailEvent.CaughtUp({ size: 4 }));
        }),
    );

    it.live("fails its layer when the directory is missing", () =>
        Effect.gen(function* () {
            const file = join(tempDir(), "missing", "spans.jsonl");
            const error = yield* Effect.flip(Effect.provide(Effect.service(SpanSource), sourceLayer(file, true)));
            expect(error.reason._tag).toBe("NotFound");
        }),
    );

    it.live("reads once to the size at open, catches up and ends under follow: false", () =>
        Effect.gen(function* () {
            const file = tempFile();
            writeFileSync(file, "one\n\nthree\n");
            expect(yield* readOnce(file)).toEqual([
                Lines(["one", "", "three"], [0, 4, 5], 1, 11),
                TailEvent.CaughtUp({ size: 11 }),
            ]);
        }),
    );
});
