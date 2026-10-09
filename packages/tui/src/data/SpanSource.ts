import { Context, Data, Effect, FileSystem, Layer, Option, Path, Queue, Ref, Stream } from "effect";

import { InputFile } from "./InputFile.ts";
import { splitLines } from "./Lines.ts";

import type { ResetReason } from "./Snapshot.ts";

export type TailEvent = Data.TaggedEnum<{
    Lines: {
        readonly lines: ReadonlyArray<string>;
        readonly offsets: ReadonlyArray<number>;
        readonly firstLine: number;
        readonly size: number;
    };
    CaughtUp: { readonly size: number };
    Reset: { readonly reason: ResetReason };
    Missing: {};
    Failed: { readonly message: string };
}>;

export const TailEvent = Data.taggedEnum<TailEvent>();

const SLICE_BYTES = 1024 * 1024;
const HEAD_BYTES = 4096;

const noBytes = new Uint8Array(0);

interface Reading {
    readonly _tag: "Reading";
    readonly ino: Option.Option<number>;
    readonly offset: number;
    readonly pending: Uint8Array;
    readonly nextLine: number;
    readonly head: Uint8Array;
    readonly reportedCaughtUp: boolean;
}

type Tail = { readonly _tag: "Unreported" } | { readonly _tag: "ReportedMissing" } | Reading;

const unreported: Tail = { _tag: "Unreported" };
const reportedMissing: Tail = { _tag: "ReportedMissing" };

const fresh = (ino: Option.Option<number>): Reading => ({
    _tag: "Reading",
    ino,
    offset: 0,
    pending: noBytes,
    nextLine: 1,
    head: noBytes,
    reportedCaughtUp: false,
});

const forgetCaughtUp = (tail: Tail): Tail =>
    tail._tag === "Reading" ? { ...tail, reportedCaughtUp: false } : unreported;

const extendHead = (head: Uint8Array, chunk: Uint8Array): Uint8Array => {
    if (head.length >= HEAD_BYTES) {
        return head;
    }
    const extended = new Uint8Array(Math.min(HEAD_BYTES, head.length + chunk.length));
    extended.set(head, 0);
    extended.set(chunk.subarray(0, extended.length - head.length), head.length);
    return extended;
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
};

const readAt = (file: FileSystem.File, offset: number, length: number) =>
    Effect.andThen(file.seek(BigInt(offset), "start"), file.readAlloc(length));

// Truncating and then writing past the old offset between two wake-ups leaves the size and inode looking like an append.
const rewrittenUnderOffset = (file: FileSystem.File, tail: Reading) =>
    tail.head.length === 0
        ? Effect.succeed(false)
        : Effect.map(
              readAt(file, 0, tail.head.length),
              (head) =>
                  !sameBytes(
                      Option.getOrElse(head, () => noBytes),
                      tail.head,
                  ),
          );

const resetReason = Effect.fnUntraced(function* (
    file: FileSystem.File,
    tail: Reading,
    ino: Option.Option<number>,
    size: number,
) {
    if (Option.isSome(tail.ino) && Option.isSome(ino) && tail.ino.value !== ino.value) {
        return Option.some<ResetReason>("replaced");
    }
    if (size < tail.offset) {
        return Option.some<ResetReason>("truncated");
    }
    return (yield* rewrittenUnderOffset(file, tail))
        ? Option.some<ResetReason>("truncated")
        : Option.none<ResetReason>();
});

export class SpanSource extends Context.Service<SpanSource, { readonly events: Stream.Stream<TailEvent> }>()(
    "@wmaurer/otelscope/data/SpanSource",
) {
    static readonly layer = Layer.effect(
        SpanSource,
        Effect.gen(function* () {
            const input = yield* InputFile;
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const dir = path.dirname(input.file);
            const name = path.basename(input.file);
            yield* fs.stat(dir);

            const events = Stream.callback<TailEvent>(
                Effect.fnUntraced(function* (queue) {
                    const tail = yield* Ref.make<Tail>(unreported);
                    const emit = (event: TailEvent) => Queue.offer(queue, event);
                    const fail = (message: string) =>
                        Effect.andThen(emit(TailEvent.Failed({ message })), Ref.update(tail, forgetCaughtUp));

                    const wakeUp = Effect.gen(function* () {
                        const before = yield* Ref.get(tail);
                        const opened = yield* fs.open(input.file).pipe(
                            Effect.asSome,
                            Effect.catchIf(
                                ({ reason }) => reason._tag === "NotFound",
                                () => Effect.succeedNone,
                            ),
                        );
                        if (Option.isNone(opened)) {
                            if (before._tag === "Reading") {
                                yield* emit(TailEvent.Reset({ reason: "removed" }));
                            }
                            if (before._tag !== "ReportedMissing") {
                                yield* emit(TailEvent.Missing());
                            }
                            return yield* Ref.set(tail, reportedMissing);
                        }
                        const file = opened.value;
                        const info = yield* file.stat;
                        const size = Number(info.size);
                        let current = before._tag === "Reading" ? before : fresh(info.ino);
                        const reason = yield* resetReason(file, current, info.ino, size);
                        if (Option.isSome(reason)) {
                            yield* emit(TailEvent.Reset({ reason: reason.value }));
                            current = fresh(info.ino);
                        }
                        yield* Ref.set(tail, current);

                        let readAny = false;
                        while (current.offset < size) {
                            const chunk = yield* readAt(
                                file,
                                current.offset,
                                Math.min(SLICE_BYTES, size - current.offset),
                            );
                            if (Option.isNone(chunk)) {
                                break;
                            }
                            const split = splitLines(
                                current.pending,
                                chunk.value,
                                current.offset - current.pending.length,
                                current.nextLine,
                            );
                            current = {
                                ...current,
                                offset: current.offset + chunk.value.length,
                                pending: split.pending,
                                nextLine: split.nextLine,
                                head: extendHead(current.head, chunk.value),
                            };
                            readAny = true;
                            yield* Ref.set(tail, current);
                            if (split.lines.length > 0) {
                                yield* emit(
                                    TailEvent.Lines({
                                        lines: split.lines,
                                        offsets: split.offsets,
                                        firstLine: split.firstLine,
                                        size,
                                    }),
                                );
                            }
                        }
                        if (current.offset >= size && (readAny || !current.reportedCaughtUp)) {
                            yield* Ref.set(tail, { ...current, reportedCaughtUp: true });
                            yield* emit(TailEvent.CaughtUp({ size }));
                        }
                    }).pipe(
                        Effect.scoped,
                        Effect.catch((error) => fail(error.message)),
                    );

                    yield* wakeUp;
                    if (!input.follow) {
                        return yield* Queue.end(queue);
                    }

                    const wake = yield* Queue.sliding<void>(1);
                    const signal = Queue.offer(wake, undefined);
                    yield* fs.watch(dir).pipe(
                        Stream.filter((event) => path.basename(event.path) === name),
                        Stream.runForEach(() => signal),
                        Effect.catch((error) => fail(error.message)),
                        Effect.andThen(Effect.sleep(input.pollMillis)),
                        Effect.forever,
                        Effect.forkScoped,
                    );
                    yield* signal.pipe(Effect.delay(input.pollMillis), Effect.forever, Effect.forkScoped);
                    return yield* Queue.take(wake).pipe(Effect.andThen(wakeUp), Effect.forever);
                }),
                { bufferSize: 4 },
            );

            return SpanSource.of({ events });
        }),
    );
}
