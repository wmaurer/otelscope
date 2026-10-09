import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { TestClock } from "effect/testing";

import { Atoms, MESSAGE_MILLIS, NOW_MILLIS } from "../../src/bridge/Atoms.ts";
import { Bodies, BodyMissing } from "../../src/data/Bodies.ts";
import { Index } from "../../src/data/Index.ts";
import { InputFile } from "../../src/data/InputFile.ts";
import { SpanStore } from "../../src/data/SpanStore.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultTracesView, Screen } from "../../src/nav/Screen.ts";
import { initialNav } from "../../src/nav/Seed.ts";
import { tempDir } from "../support/files.ts";
import { record } from "../support/records.ts";
import { indexed, status } from "../support/store.ts";

import type { Phase, Snapshot } from "../../src/data/Snapshot.ts";
import type { Atom } from "effect/reactivity";

const sha = "a".repeat(64);

const bridge = Effect.fnUntraced(function* (nav: Nav.Nav = Nav.initial, first: Snapshot = new Index().freeze(status)) {
    const dir = tempDir();
    mkdirSync(join(dir, "bodies"));
    writeFileSync(join(dir, "bodies", `${sha}.txt`), "the body");
    const ref = yield* SubscriptionRef.make(first);
    const layer = Atoms.layer(nav).pipe(
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
            const { atoms, ref } = yield* bridge();
            const initial = yield* SubscriptionRef.get(ref);
            expect(atoms.registry.get(atoms.snapshot)).toBe(initial);

            const next = indexed([record({ span: "a" })]);
            yield* SubscriptionRef.set(ref, next);
            expect(yield* valueOf(atoms.registry, atoms.snapshot, (snapshot) => snapshot === next)).toBe(next);
        }),
    );

    it.effect("advances now with the clock every second", () =>
        Effect.gen(function* () {
            const { atoms } = yield* bridge();
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
            const { atoms } = yield* bridge();
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

    it.effect("shows a message for exactly 5 s, and a new message restarts the wait", () =>
        Effect.gen(function* () {
            const { atoms } = yield* bridge();
            const shown = () => atoms.registry.get(atoms.message);
            const say = (text: string) =>
                Effect.andThen(
                    Effect.sync(() => atoms.registry.set(atoms.message, Option.some(text))),
                    Effect.yieldNow,
                );
            yield* say("no bad lines");
            yield* TestClock.adjust(MESSAGE_MILLIS - 1);
            expect(shown()).toEqual(Option.some("no bad lines"));
            yield* TestClock.adjust(1);
            expect(shown(), "gone at 5 s").toEqual(Option.none());

            yield* say("no bad lines");
            yield* TestClock.adjust(3000);
            yield* say("no bad lines");
            yield* TestClock.adjust(MESSAGE_MILLIS - 1);
            expect(shown(), "the same text again restarts the wait").toEqual(Option.some("no bad lines"));
            yield* TestClock.adjust(1);
            expect(shown()).toEqual(Option.none());
        }),
    );

    it.effect("resolves a seeded prefix on the snapshot that makes it unique, and never again", () =>
        Effect.gen(function* () {
            const { atoms, ref } = yield* bridge(initialNav({ run: Option.none(), trace: Option.some("9f3c") }));
            const top = () => Nav.top(atoms.registry.get(atoms.nav));

            yield* SubscriptionRef.set(
                ref,
                indexed([record({ span: "a", trace: "9f3c-a" }), record({ span: "b", trace: "9f3c-b" })]),
            );
            expect(top(), "ambiguous").toMatchObject({ traceId: "9f3c", idIsPrefix: true });

            yield* SubscriptionRef.set(ref, indexed([record({ span: "a", trace: "9f3c-a" })]));
            expect(top()).toMatchObject({ traceId: "9f3c-a", idIsPrefix: false });

            yield* SubscriptionRef.set(ref, indexed([record({ span: "c", trace: "9f3c-c" })]));
            expect(top(), "a later file does not move it").toMatchObject({ traceId: "9f3c-a", idIsPrefix: false });
        }),
    );

    const atPhase = (snapshot: Snapshot, phase: Phase): Snapshot => ({
        ...snapshot,
        status: { ...snapshot.status, phase },
    });
    const oneRun = indexed([record({ span: "a", run: "run-1" })]);
    const loading = atPhase(new Index().freeze(status), "loading");
    const tracesOfRun1 = Screen.Traces({ runId: "run-1", idIsPrefix: false, view: defaultTracesView });

    it.effect("opens a one-run file on its traces at the end of the initial read, once", () =>
        Effect.gen(function* () {
            const { atoms, ref } = yield* bridge(Nav.initial, loading);
            const stack = () => atoms.registry.get(atoms.nav).stack;

            yield* SubscriptionRef.set(ref, atPhase(oneRun, "loading"));
            expect(stack(), "not while the first slice is read").toEqual(Nav.initial.stack);

            yield* SubscriptionRef.set(ref, atPhase(oneRun, "following"));
            expect(stack()).toEqual([Nav.initial.stack[0], tracesOfRun1]);

            atoms.registry.set(atoms.nav, Nav.initial);
            yield* SubscriptionRef.set(ref, atPhase(indexed([record({ span: "b", run: "run-1" })]), "following"));
            expect(stack(), "only at the first settled snapshot").toEqual(Nav.initial.stack);
        }),
    );

    it.effect("leaves a one-run file on Runs once a key has been pressed", () =>
        Effect.gen(function* () {
            const { atoms, ref } = yield* bridge(Nav.initial, loading);
            atoms.keyPressed();
            yield* SubscriptionRef.set(ref, atPhase(oneRun, "done"));
            expect(atoms.registry.get(atoms.nav)).toBe(Nav.initial);
        }),
    );

    it.effect("does not open a file whose first settled snapshot holds several runs", () =>
        Effect.gen(function* () {
            const { atoms, ref } = yield* bridge(Nav.initial, loading);
            const two = indexed([record({ span: "a", run: "run-1" }), record({ span: "b", run: "run-2" })]);
            yield* SubscriptionRef.set(ref, atPhase(two, "following"));
            yield* SubscriptionRef.set(ref, atPhase(oneRun, "following"));
            expect(atoms.registry.get(atoms.nav)).toBe(Nav.initial);
        }),
    );
});
