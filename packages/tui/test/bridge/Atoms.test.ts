import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { TestClock } from "effect/testing";

import { Atoms, NOW_MILLIS } from "../../src/bridge/Atoms.ts";
import { Bodies, BodyMissing } from "../../src/data/Bodies.ts";
import { Index } from "../../src/data/Index.ts";
import { InputFile } from "../../src/data/InputFile.ts";
import { SpanStore } from "../../src/data/SpanStore.ts";
import { tempDir } from "../support/files.ts";
import { record } from "../support/records.ts";
import { indexed, status } from "../support/store.ts";

import type { Atom } from "effect/reactivity";

const sha = "a".repeat(64);

const bridge = Effect.gen(function* () {
    const dir = tempDir();
    mkdirSync(join(dir, "bodies"));
    writeFileSync(join(dir, "bodies", `${sha}.txt`), "the body");
    const ref = yield* SubscriptionRef.make(new Index().freeze(status));
    const layer = Atoms.layer.pipe(
        Layer.provide(Layer.succeed(SpanStore, SpanStore.of({ snapshot: ref }))),
        Layer.provide(Bodies.layer),
        Layer.provide(InputFile.layer({ file: join(dir, "spans.jsonl"), follow: true })),
        Layer.provide(NodeServices.layer),
    );
    const context = yield* Layer.build(layer);
    return { atoms: Context.get(context, Atoms), ref };
});

const valueOf = <A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>, done: (value: A) => boolean) =>
    AtomRegistry.toStream(registry, atom).pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow));

describe("Atoms", () => {
    it.effect("follows the store's snapshot", () =>
        Effect.gen(function* () {
            const { atoms, ref } = yield* bridge;
            const initial = yield* SubscriptionRef.get(ref);
            expect(atoms.registry.get(atoms.snapshot)).toBe(initial);

            const next = indexed([record({ span: "a" })]);
            yield* SubscriptionRef.set(ref, next);
            expect(yield* valueOf(atoms.registry, atoms.snapshot, (snapshot) => snapshot === next)).toBe(next);
        }),
    );

    it.effect("advances now with the clock every second", () =>
        Effect.gen(function* () {
            const { atoms } = yield* bridge;
            expect(atoms.registry.get(atoms.now)).toBe(0);
            yield* TestClock.adjust(NOW_MILLIS - 1);
            expect(atoms.registry.get(atoms.now), "not refreshed before a second has passed").toBe(0);
            yield* TestClock.adjust(1);
            expect(yield* valueOf(atoms.registry, atoms.now, (now) => now > 0)).toBe(NOW_MILLIS);
            yield* TestClock.adjust(NOW_MILLIS * 2);
            expect(yield* valueOf(atoms.registry, atoms.now, (now) => now > NOW_MILLIS)).toBe(NOW_MILLIS * 3);
        }),
    );

    it.effect("resolves a body and its stat, one atom per key", () =>
        Effect.gen(function* () {
            const { atoms } = yield* bridge;
            const body = atoms.body({ sha256: sha, bytes: 8 });
            expect(atoms.body({ sha256: sha, bytes: 8 }), "an equal key gives the same atom").toBe(body);

            const loaded = yield* valueOf(atoms.registry, body, AsyncResult.isSuccess);
            expect(AsyncResult.value(loaded)).toEqual(Option.some({ text: "the body", truncated: false, bytes: 8 }));

            const missing = yield* valueOf(
                atoms.registry,
                atoms.body({ sha256: "b".repeat(64), bytes: 1 }),
                AsyncResult.isFailure,
            );
            expect(AsyncResult.error(missing), "a missing body fails the atom with BodyMissing").toEqual(
                Option.some(expect.any(BodyMissing)),
            );

            const stat = yield* valueOf(atoms.registry, atoms.bodyStat(sha), AsyncResult.isSuccess);
            expect(AsyncResult.value(stat)).toEqual(Option.some(Option.some(8)));
        }),
    );
});
