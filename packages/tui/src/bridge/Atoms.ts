import { Clock, Context, Effect, Layer, MutableRef, Option, Stream } from "effect";
import { type AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { Bodies, type BodyMissing, type BodyReadFailed, type BodyText } from "../data/Bodies.ts";
import { SpanStore } from "../data/SpanStore.ts";
import { defaultPanes } from "../model/panes.ts";
import { resolvePrefixes } from "../nav/Resolve.ts";
import { initialReadDone, openArrivedTrace, openSingleRun } from "../nav/Seed.ts";
import { listAtom, settledFilter } from "./Lists.ts";
import { bodyStatsAtom, traceModelAtom } from "./Trace.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Panes } from "../model/panes.ts";
import type { ScreenList } from "../model/screenList.ts";
import type { BodyStats } from "../model/traceFrame.ts";
import type { TraceModel } from "../model/traceModel.ts";
import type { Nav } from "../nav/Nav.ts";

export const NOW_MILLIS = 1000;

export const MESSAGE_MILLIS = 5000;

export interface BodyKey {
    readonly sha256: string;
    readonly bytes: number;
}

export class Atoms extends Context.Service<
    Atoms,
    {
        readonly registry: AtomRegistry.AtomRegistry;
        readonly snapshot: Atom.Atom<Snapshot>;
        readonly now: Atom.Writable<number>;
        /**
         * The screen stack. Key handlers and the snapshot subscription below both write it, each with a change computed
         * from the current value in the same synchronous step, so neither loses the other's.
         */
        readonly nav: Atom.Writable<Nav>;
        readonly panes: Atom.Writable<Panes>;
        readonly list: Atom.Atom<ScreenList>;
        /** The top Trace screen's model, None elsewhere or while its trace is absent. */
        readonly trace: Atom.Atom<Option.Option<TraceModel>>;
        /** `Bodies.stat` for the bodies of the span the Trace screen shows. */
        readonly bodyStats: Atom.Atom<BodyStats>;
        /** Setting `Some(text)` shows it for 5 s, even when the text is the same as the one showing. */
        readonly message: Atom.Writable<Option.Option<string>>;
        /**
         * The shell calls this on every key press. A file holding one run opens on its traces only when no key was
         * pressed before the initial read ended.
         */
        readonly keyPressed: () => void;
        readonly body: (key: BodyKey) => Atom.Atom<AsyncResult.AsyncResult<BodyText, BodyMissing | BodyReadFailed>>;
        readonly bodyStat: (sha256: string) => Atom.Atom<AsyncResult.AsyncResult<Option.Option<number>>>;
    }
>()("@wmaurer/otelscope/bridge/Atoms") {
    static readonly layer = (initialNav: Nav) =>
        Layer.effect(
            Atoms,
            Effect.gen(function* () {
                const store = yield* SpanStore;
                const bodies = yield* Bodies;
                const registry = yield* Effect.acquireRelease(
                    Effect.sync(() => AtomRegistry.make()),
                    (registry) => Effect.sync(() => registry.dispose()),
                );
                const now = Atom.keepAlive(Atom.make(yield* Clock.currentTimeMillis));
                yield* Effect.gen(function* () {
                    yield* Effect.sleep(NOW_MILLIS);
                    registry.set(now, yield* Clock.currentTimeMillis);
                }).pipe(Effect.forever, Effect.forkScoped);

                const message = Atom.keepAlive(Atom.make(Option.none<string>()));
                yield* AtomRegistry.toStream(registry, message).pipe(
                    Stream.switchMap((shown) =>
                        Option.isNone(shown)
                            ? Stream.empty
                            : Stream.fromEffect(
                                  Effect.andThen(
                                      Effect.sleep(MESSAGE_MILLIS),
                                      Effect.sync(() => registry.set(message, Option.none())),
                                  ),
                              ),
                    ),
                    Stream.runDrain,
                    Effect.forkScoped,
                );

                const snapshot = Atom.keepAlive(Atom.subscriptionRef(store.snapshot));
                const nav = Atom.keepAlive(Atom.make(initialNav));
                // Disarmed by the first key or the end of the initial read, whichever comes first; nothing re-arms it.
                const singleRunArmed = MutableRef.make(true);
                yield* Effect.acquireRelease(
                    Effect.sync(() =>
                        registry.subscribe(
                            snapshot,
                            (next) => {
                                registry.update(nav, (current) =>
                                    openArrivedTrace(resolvePrefixes(current, next), next),
                                );
                                if (MutableRef.get(singleRunArmed) && initialReadDone(next)) {
                                    MutableRef.set(singleRunArmed, false);
                                    registry.update(nav, (current) => openSingleRun(current, next));
                                }
                            },
                            { immediate: true },
                        ),
                    ),
                    (unsubscribe) => Effect.sync(unsubscribe),
                );

                const filter = settledFilter(nav);
                const bodyStat = Atom.family((sha256: string) => Atom.make(bodies.stat(sha256)));
                const trace = Atom.keepAlive(traceModelAtom(snapshot, nav, filter));
                return Atoms.of({
                    registry,
                    snapshot,
                    now,
                    nav,
                    panes: Atom.keepAlive(Atom.make(defaultPanes)),
                    list: Atom.keepAlive(listAtom(snapshot, nav, now, filter)),
                    trace,
                    bodyStats: Atom.keepAlive(bodyStatsAtom(trace, bodyStat)),
                    message,
                    keyPressed: () => MutableRef.set(singleRunArmed, false),
                    body: Atom.family((key: BodyKey) => Atom.make(bodies.read(key.sha256, key.bytes))),
                    bodyStat,
                });
            }),
        );
}
