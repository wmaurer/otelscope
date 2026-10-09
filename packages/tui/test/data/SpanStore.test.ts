import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Option } from "effect";
import { TestClock } from "effect/testing";

import { TailEvent } from "../../src/data/SpanSource.ts";
import { SLICE_LINES, THROTTLE_MILLIS } from "../../src/data/SpanStore.ts";
import { line, record } from "../support/records.ts";
import { linesEvent, scriptedStore } from "../support/store.ts";

const spanLine = (span: string, trace = "trace-1") => line(record({ span, trace }));

describe("SpanStore", () => {
    it.effect("publishes the first change at once, then at most once per 100 ms on the trailing edge", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            const initial = yield* store.snapshot;

            yield* store.send(linesEvent([spanLine("a")]));
            const first = yield* store.snapshot;
            expect(first.version, "first publish is immediate").toBe(initial.version + 1);
            expect(first.spanCount).toBe(1);

            yield* store.send(linesEvent([spanLine("b")], 2));
            yield* TestClock.adjust(THROTTLE_MILLIS - 1);
            expect((yield* store.snapshot).version, "held back inside the window").toBe(first.version);

            yield* TestClock.adjust(1);
            const trailing = yield* store.published(first.version + 1);
            expect(trailing.spanCount, "the trailing publish carries the held-back change").toBe(2);

            yield* store.send(linesEvent([spanLine("c")], 3));
            yield* store.send(TailEvent.CaughtUp({ size: 300 }));
            const caughtUp = yield* store.snapshot;
            expect(caughtUp.version, "CaughtUp publishes at once").toBe(trailing.version + 1);
            expect(caughtUp.spanCount).toBe(3);

            yield* TestClock.adjust(THROTTLE_MILLIS);
            expect((yield* store.snapshot).version, "nothing left for the trailing edge").toBe(caughtUp.version);
        }),
    );

    it.effect("publishes Reset, Missing and Failed at once", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            yield* store.send(linesEvent([spanLine("a")]));
            const start = (yield* store.snapshot).version;
            yield* store.send(linesEvent([spanLine("b")], 2));
            yield* store.send(TailEvent.Failed({ message: "EIO" }));
            expect((yield* store.snapshot).version).toBe(start + 1);
            yield* store.send(TailEvent.Reset({ reason: "removed" }));
            expect((yield* store.snapshot).version).toBe(start + 2);
            yield* store.send(TailEvent.Missing());
            expect((yield* store.snapshot).version).toBe(start + 3);
        }),
    );

    it.effect("moves through waiting, loading, following and done", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            const phase = Effect.map(store.snapshot, (snapshot) => snapshot.status.phase);
            yield* store.send(TailEvent.Missing());
            expect(yield* phase, "missing at start").toBe("waiting");
            const missing = yield* store.snapshot;
            yield* store.send(linesEvent([spanLine("a")]));
            yield* TestClock.adjust(THROTTLE_MILLIS);
            expect((yield* store.published(missing.version + 1)).status.phase).toBe("loading");
            yield* store.send(TailEvent.CaughtUp({ size: 10 }));
            expect(yield* phase).toBe("following");
            yield* TestClock.adjust(THROTTLE_MILLIS);
            yield* store.send(linesEvent([spanLine("b")], 2));
            expect(yield* phase, "appends while following").toBe("following");
            yield* store.send(TailEvent.Reset({ reason: "truncated" }));
            expect(yield* phase).toBe("loading");
            yield* store.send(TailEvent.Reset({ reason: "removed" }));
            expect(yield* phase).toBe("waiting");

            const once = yield* scriptedStore(false);
            yield* once.send(linesEvent([spanLine("a")]));
            yield* once.send(TailEvent.CaughtUp({ size: 10 }));
            expect((yield* once.snapshot).status.phase, "caught up under --no-follow").toBe("done");
        }),
    );

    it.effect("tracks progress, the last error until a read succeeds, and the last reset", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            const event = linesEvent([spanLine("a"), spanLine("b")]);
            yield* store.send(TailEvent.Lines({ ...event, size: 10_000 }));
            const loading = (yield* store.snapshot).status;
            expect(loading.bytesTotal).toBe(10_000);
            expect(loading.bytesRead, "the end of the last indexed line").toBe(event.size);

            yield* store.send(TailEvent.Failed({ message: "EACCES" }));
            expect((yield* store.snapshot).status.error).toEqual(Option.some("EACCES"));
            yield* store.send(TailEvent.CaughtUp({ size: 10_000 }));
            expect((yield* store.snapshot).status).toMatchObject({
                error: Option.none(),
                bytesRead: 10_000,
                bytesTotal: 10_000,
            });

            yield* TestClock.adjust(7_000);
            yield* store.send(TailEvent.Reset({ reason: "replaced" }));
            expect((yield* store.snapshot).status.lastReset).toEqual(Option.some({ reason: "replaced", at: 7_000 }));
        }),
    );

    it.effect("clears the index on Reset and bumps the epoch", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            yield* store.send(linesEvent([spanLine("a"), "not json"]));
            const before = yield* store.snapshot;
            yield* store.send(TailEvent.Reset({ reason: "truncated" }));
            const after = yield* store.snapshot;
            expect(after).toMatchObject({
                version: before.version + 1,
                epoch: before.epoch + 1,
                spanCount: 0,
                traces: new Map(),
                runs: new Map(),
                badLines: { legacy: 0, malformed: 0, samples: [] },
            });
        }),
    );

    it.effect("stamps arrivals only for records indexed after this epoch's first catch-up", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            yield* TestClock.adjust(1_000);
            yield* store.send(linesEvent([spanLine("a", "old")]));
            const initialRead = yield* store.snapshot;
            expect(initialRead.traces.get("old")?.lastArrivalAt, "initial read").toEqual(Option.none());
            expect(initialRead.status.lastRecordAt).toEqual(Option.none());

            yield* store.send(TailEvent.CaughtUp({ size: 100 }));
            yield* TestClock.adjust(5_000);
            yield* store.send(linesEvent([spanLine("b", "new")], 2));
            const live = yield* store.snapshot;
            expect(live.traces.get("new")?.lastArrivalAt, "appended while following").toEqual(Option.some(6_000));
            expect(live.runs.get("run-1")?.lastArrivalAt).toEqual(Option.some(6_000));
            expect(live.status.lastRecordAt).toEqual(Option.some(6_000));
            expect(live.traces.get("old")?.lastArrivalAt, "the earlier trace stays as it was").toEqual(Option.none());

            yield* store.send(TailEvent.Reset({ reason: "truncated" }));
            yield* TestClock.adjust(THROTTLE_MILLIS);
            yield* store.send(linesEvent([spanLine("a", "old"), spanLine("b", "new")]));
            const reread = yield* store.snapshot;
            expect(reread.traces.get("new")?.lastArrivalAt, "the re-read after a reset").toEqual(Option.none());
        }),
    );

    it.effect("yields to the event loop between slices of 2,000 lines", () =>
        Effect.gen(function* () {
            const store = yield* scriptedStore(true);
            const slices = 5;
            const texts = Arr.makeBy(SLICE_LINES * slices, (i) => spanLine(`span-${i}`, `trace-${i % 50}`));
            let turns = 0;
            let counting = true;
            const count = () => {
                turns += 1;
                if (counting) {
                    setImmediate(count);
                }
            };
            setImmediate(count);
            yield* store.send(linesEvent(texts));
            counting = false;
            expect(turns, "event-loop turns while indexing").toBeGreaterThanOrEqual(slices);
            yield* store.send(TailEvent.CaughtUp({ size: 1 }));
            expect((yield* store.snapshot).spanCount).toBe(SLICE_LINES * slices);
        }),
    );
});
