import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";

import { SpanSource } from "../../src/data/SpanSource.ts";
import { SpanStore } from "../../src/data/SpanStore.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { mount } from "../support/app.tsx";

import type { Atom } from "effect/reactivity";

const file = fileURLToPath(new URL("../fixtures/sample/spans.jsonl", import.meta.url));

const width = 120;
const height = 40;

/** A little after the sample's last record ends, at 14:09:36.230. */
const now = Date.parse("2026-10-06T14:10:00Z");

const snapshotPath = (name: string) => `__snapshots__/Golden/${name}.txt`;

const line = (frame: string, index: number) => frame.split("\n")[index]?.trimEnd() ?? "";

describe("the sample through the real data layer", () => {
    it("drills from Runs down to a body, one frame per screen, and walks back on Esc", async () => {
        const app = await mount({
            file,
            follow: false,
            store: SpanStore.layer.pipe(Layer.provide(SpanSource.layer)),
            nav: Nav.initial,
            width,
            height,
            now,
        });
        const until = <A,>(atom: Atom.Atom<A>, reached: (value: A) => boolean) =>
            app.after(
                AtomRegistry.toStream(app.atoms.registry, atom).pipe(
                    Stream.filter(reached),
                    Stream.runHead,
                    Effect.timeout("5 seconds"),
                ),
            );
        const repeat = async (key: string, times: number) => {
            for (let i = 0; i < times; i += 1) {
                await app.press(key);
            }
        };
        try {
            const runs = await until(app.atoms.snapshot, (snapshot) => snapshot.status.phase === "done");
            await expect(runs).toMatchFileSnapshot(snapshotPath("runs"));

            await app.press("G");
            const traces = await app.enter();
            expect(line(traces, 0), "G selected the oldest run").toBe("Runs › shop-api · 14:03:27");
            await expect(traces).toMatchFileSnapshot(snapshotPath("traces"));

            await repeat("k", 4);
            const trace = await app.enter();
            expect(line(trace, 0), "four rows up from the newest trace").toBe(
                "Runs › shop-api · 14:03:27 › POST /orders 1a654e13",
            );
            await expect(trace).toMatchFileSnapshot(snapshotPath("trace"));

            await repeat("j", 5);
            await app.press("b");
            const body = await until(app.atoms.bodyModel, (model) =>
                Option.exists(model, (shown) => shown.content._tag !== "Loading"),
            );
            expect(line(body, 0), "five rows down from the failure origin, to email.send").toBe(
                "Runs › shop-api · 14:03:27 › POST /orders 1a654e13 › email",
            );
            await expect(body).toMatchFileSnapshot(snapshotPath("body"));

            expect(line(await app.escape(), 0)).toBe("Runs › shop-api · 14:03:27 › POST /orders 1a654e13");
            expect(line(await app.escape(), 0)).toBe("Runs › shop-api · 14:03:27");
            expect(line(await app.escape(), 0)).toBe("Runs");
            expect(line(await app.escape(), 0), "Esc on the bare Runs screen does nothing").toBe("Runs");
            expect(app.quits()).toBe(0);
        } finally {
            await app.stop();
        }
    });
});
