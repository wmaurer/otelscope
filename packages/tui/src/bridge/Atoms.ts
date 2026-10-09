import { Clock, Context, Effect, Layer, type Option } from "effect";
import { type AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { Bodies, type BodyMissing, type BodyReadFailed, type BodyText } from "../data/Bodies.ts";
import { SpanStore } from "../data/SpanStore.ts";

import type { Snapshot } from "../data/Snapshot.ts";

export const NOW_MILLIS = 1000;

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
        readonly body: (key: BodyKey) => Atom.Atom<AsyncResult.AsyncResult<BodyText, BodyMissing | BodyReadFailed>>;
        readonly bodyStat: (sha256: string) => Atom.Atom<AsyncResult.AsyncResult<Option.Option<number>>>;
    }
>()("@wmaurer/otelscope/bridge/Atoms") {
    static readonly layer = Layer.effect(
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

            return Atoms.of({
                registry,
                snapshot: Atom.keepAlive(Atom.subscriptionRef(store.snapshot)),
                now,
                body: Atom.family((key: BodyKey) => Atom.make(bodies.read(key.sha256, key.bytes))),
                bodyStat: Atom.family((sha256: string) => Atom.make(bodies.stat(sha256))),
            });
        }),
    );
}
