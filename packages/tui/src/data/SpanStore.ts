import { Clock, Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";

import { Index } from "./Index.ts";
import { InputFile } from "./InputFile.ts";
import { SpanSource, TailEvent } from "./SpanSource.ts";

import type { Phase, Snapshot, Status } from "./Snapshot.ts";

export const SLICE_LINES = 2000;

export const THROTTLE_MILLIS = 100;

const initialStatus: Status = {
    phase: "loading",
    bytesRead: 0,
    bytesTotal: 0,
    lastRecordAt: Option.none(),
    lastReset: Option.none(),
    error: Option.none(),
};

const phaseAfter = (phase: Phase, event: TailEvent, follow: boolean): Phase =>
    TailEvent.$match(event, {
        Lines: (): Phase => (phase === "following" ? "following" : "loading"),
        CaughtUp: (): Phase => (follow ? "following" : "done"),
        Reset: ({ reason }): Phase => (reason === "removed" ? "waiting" : "loading"),
        Missing: (): Phase => "waiting",
        Failed: () => phase,
    });

export class SpanStore extends Context.Service<
    SpanStore,
    { readonly snapshot: SubscriptionRef.SubscriptionRef<Snapshot> }
>()("@wmaurer/otelscope/data/SpanStore") {
    static readonly layer = Layer.effect(
        SpanStore,
        Effect.gen(function* () {
            const input = yield* InputFile;
            const source = yield* SpanSource;
            const index = new Index();
            let status = initialStatus;
            const snapshot = yield* SubscriptionRef.make(index.freeze(status));

            let lastPublishAt = Option.none<number>();
            let dirty = false;
            let trailing = false;

            const publish = Effect.gen(function* () {
                dirty = false;
                lastPublishAt = Option.some(yield* Clock.currentTimeMillis);
                yield* SubscriptionRef.set(snapshot, index.freeze(status));
            });

            const publishSoon = Effect.gen(function* () {
                dirty = true;
                const now = yield* Clock.currentTimeMillis;
                const wait = Option.match(lastPublishAt, {
                    onNone: () => 0,
                    onSome: (at) => at + THROTTLE_MILLIS - now,
                });
                if (wait <= 0) {
                    return yield* publish;
                }
                if (trailing) {
                    return;
                }
                trailing = true;
                yield* Effect.gen(function* () {
                    yield* Effect.sleep(wait);
                    trailing = false;
                    if (dirty) {
                        yield* publish;
                    }
                }).pipe(Effect.forkScoped);
            });

            const indexLines = Effect.fnUntraced(function* (lines: TailEvent & { readonly _tag: "Lines" }) {
                for (let start = 0; start < lines.lines.length; start += SLICE_LINES) {
                    const arrivalAt =
                        status.phase === "following" ? Option.some(yield* Clock.currentTimeMillis) : Option.none();
                    const end = Math.min(lines.lines.length, start + SLICE_LINES);
                    for (let i = start; i < end; i++) {
                        index.ingest(lines.lines[i], lines.firstLine + i, lines.offsets[i], arrivalAt);
                    }
                    const last = end - 1;
                    status = {
                        ...status,
                        bytesRead: lines.offsets[last] + Buffer.byteLength(lines.lines[last]) + 1,
                        lastRecordAt: Option.isSome(arrivalAt) ? arrivalAt : status.lastRecordAt,
                    };
                    yield* publishSoon;
                    yield* Effect.yieldNow;
                }
            });

            const handle = Effect.fnUntraced(function* (event: TailEvent) {
                status = { ...status, phase: phaseAfter(status.phase, event, input.follow) };
                switch (event._tag) {
                    case "Lines":
                        status = { ...status, bytesTotal: event.size, error: Option.none() };
                        return yield* indexLines(event);
                    case "CaughtUp":
                        status = { ...status, bytesRead: event.size, bytesTotal: event.size, error: Option.none() };
                        return yield* publish;
                    case "Reset": {
                        index.reset();
                        const at = yield* Clock.currentTimeMillis;
                        status = {
                            ...status,
                            bytesRead: 0,
                            bytesTotal: 0,
                            lastReset: Option.some({ reason: event.reason, at }),
                        };
                        return yield* publish;
                    }
                    case "Missing":
                        return yield* publish;
                    case "Failed":
                        status = { ...status, error: Option.some(event.message) };
                        return yield* publish;
                }
            });

            yield* source.events.pipe(Stream.runForEach(handle), Effect.forkScoped);
            return SpanStore.of({ snapshot });
        }),
    );
}
