import { Array as Arr, Context, Effect, Layer, Option, Queue, Stream, SubscriptionRef } from "effect";

import { Index } from "../../src/data/Index.ts";
import { InputFile } from "../../src/data/InputFile.ts";
import { SpanSource, TailEvent } from "../../src/data/SpanSource.ts";
import { SpanStore } from "../../src/data/SpanStore.ts";
import { utf8Length } from "./files.ts";
import { line } from "./records.ts";

import type { Snapshot, Status } from "../../src/data/Snapshot.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export const status: Status = {
    phase: "following",
    bytesRead: 0,
    bytesTotal: 0,
    lastRecordAt: Option.none(),
    lastReset: Option.none(),
    error: Option.none(),
};

export const ingestAll = (index: Index, texts: ReadonlyArray<string>, arrivalAt = Option.none<number>()): Index => {
    Arr.forEach(texts, (text, i) => index.ingest(text, i + 1, i * 1000, arrivalAt));
    return index;
};

/** The snapshot with its traces copied into a plain `Map`, so `toEqual` compares the entries, not how they are stored. */
export const plainTraces = (snapshot: Snapshot): Snapshot => ({ ...snapshot, traces: new Map(snapshot.traces) });

export const indexed = (records: ReadonlyArray<JsonlSpanRecord>): Snapshot =>
    ingestAll(new Index(), Arr.map(records, line)).freeze(status);

export const linesEvent = (
    texts: ReadonlyArray<string>,
    firstLine = 1,
    startOffset = 0,
): Extract<TailEvent, { readonly _tag: "Lines" }> => {
    const offsets = Arr.scan(texts, startOffset, (offset, text) => offset + utf8Length(text) + 1);
    return TailEvent.Lines({
        lines: texts,
        offsets: Arr.dropRight(offsets, 1),
        firstLine,
        size: Arr.lastNonEmpty(offsets),
    });
};

export const scriptedStore = Effect.fnUntraced(function* (follow: boolean) {
    const events = yield* Queue.unbounded<TailEvent>();
    const pulls = yield* Queue.unbounded<void>();
    const source = SpanSource.of({
        events: Stream.fromEffectRepeat(Effect.andThen(Queue.offer(pulls, undefined), Queue.take(events))),
    });
    const input = InputFile.of({ file: "/tmp/spans.jsonl", bodiesDir: "/tmp/bodies", follow, pollMillis: 20 });
    const context = yield* Layer.build(
        SpanStore.layer.pipe(
            Layer.provide(Layer.succeed(SpanSource, source)),
            Layer.provide(Layer.succeed(InputFile, input)),
        ),
    );
    const store = Context.get(context, SpanStore);
    yield* Queue.take(pulls);
    return {
        send: (event: TailEvent) => Effect.andThen(Queue.offer(events, event), Queue.take(pulls)),
        snapshot: SubscriptionRef.get(store.snapshot),
        published: (version: number) =>
            SubscriptionRef.changes(store.snapshot).pipe(
                Stream.filter((snapshot) => snapshot.version >= version),
                Stream.runHead,
                Effect.map(Option.getOrThrow),
            ),
    };
});
