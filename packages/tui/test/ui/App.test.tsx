import { join } from "node:path";

import { RegistryContext } from "@effect/atom-react";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { testRender } from "@opentui/react/test-utils";
import { Context, Effect, Exit, Layer, Option, Scope, SubscriptionRef } from "effect";
import { act } from "react";

import { Atoms } from "../../src/bridge/Atoms.ts";
import { Bodies } from "../../src/data/Bodies.ts";
import { InputFile } from "../../src/data/InputFile.ts";
import { SpanStore } from "../../src/data/SpanStore.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { initialNav } from "../../src/nav/Seed.ts";
import { App } from "../../src/ui/App.tsx";
import { tempDir } from "../support/files.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";

const width = 100;
const height = 20;

const twoRuns = indexed([record({ span: "a", run: "run-1" }), record({ span: "b", run: "run-2" })]);

const start = async (nav: Nav.Nav = Nav.initial, first: Snapshot = twoRuns) => {
    const dir = tempDir();
    const file = join(dir, "spans.jsonl");
    const scope = Scope.makeUnsafe();
    const ref = Effect.runSync(SubscriptionRef.make(first));
    const context = await Effect.runPromise(
        Layer.buildWithScope(
            Atoms.layer(nav).pipe(
                Layer.provide(Layer.succeed(SpanStore, SpanStore.of({ snapshot: ref }))),
                Layer.provide(Bodies.layer),
                Layer.provide(InputFile.layer({ file, follow: true })),
                Layer.provide(NodeServices.layer),
            ),
            scope,
        ),
    );
    const atoms = Context.get(context, Atoms);
    let quits = 0;
    let suspends = 0;
    const setup = await testRender(
        <RegistryContext.Provider value={atoms.registry}>
            <App atoms={atoms} file={file} onQuit={() => (quits += 1)} onSuspend={() => (suspends += 1)} />
        </RegistryContext.Provider>,
        { width, height },
    );
    const frame = async () => {
        await setup.renderOnce();
        return setup.captureCharFrame();
    };
    const press = async (key: string, modifiers?: { readonly ctrl?: boolean }) => {
        act(() => setup.mockInput.pressKey(key, modifiers));
        return frame();
    };
    const escape = async () => {
        act(() => setup.mockInput.pressEscape());
        // A lone ESC byte could start an escape sequence, so the input parser waits 20 ms before it reports the key.
        await act(() => Effect.runPromise(Effect.sleep(50)));
        return frame();
    };
    const stop = async () => {
        // The renderer unmounts the React root when it is destroyed, and React wants that inside act().
        act(() => setup.renderer.destroy());
        await Effect.runPromise(Scope.close(scope, Exit.void));
    };
    return {
        atoms,
        ref,
        quits: () => quits,
        suspends: () => suspends,
        frame,
        press,
        escape,
        stop,
    };
};

const line = (frame: string, index: number) => frame.split("\n")[index]?.trimEnd() ?? "";

describe("App", () => {
    it("quits on q and Ctrl-c, and on nothing else", async () => {
        const app = await start();
        try {
            await app.press("x");
            expect(app.quits()).toBe(0);
            await app.press("q");
            expect(app.quits()).toBe(1);
            await app.press("c", { ctrl: true });
            expect(app.quits()).toBe(2);
            await app.press("z", { ctrl: true });
            expect(app.suspends()).toBe(1);
        } finally {
            await app.stop();
        }
    });

    it("opens help on ?, scrolls it, and closes it on q without quitting", async () => {
        const app = await start();
        try {
            const open = await app.press("?");
            expect(open).toContain("Help · Runs");
            expect(line(open, height - 1)).toMatch(/^Esc close/);
            expect(open).toMatch(/│ Runs +│/);
            expect(open).not.toContain("Mouse:");
            expect(await app.press("j"), "one row down").not.toMatch(/│ Runs +│/);
            expect(await app.press("G"), "to the end").toContain("Mouse:");
            const closed = await app.press("q");
            expect(closed).not.toContain("Help · Runs");
            expect(app.quits()).toBe(0);
            expect(line(closed, height - 1)).toMatch(/^⏎ open/);

            await app.press("?");
            await app.press("!");
            expect(await app.frame(), "the other overlay's key does nothing").toContain("Help · Runs");
            await app.press("c", { ctrl: true });
            expect(app.quits(), "Ctrl-c quits from an overlay").toBe(1);
        } finally {
            await app.stop();
        }
    });

    it("says there are no bad lines instead of opening an empty overlay", async () => {
        const app = await start();
        try {
            const said = await app.press("!");
            expect(line(said, height - 1)).toMatch(/^no bad lines +spans\.jsonl/);
            expect(said).not.toContain("Bad lines");
        } finally {
            await app.stop();
        }
    });

    it("walks back from a seeded run to the run list", async () => {
        const app = await start(initialNav({ run: Option.some("run-1"), trace: Option.none() }));
        try {
            expect(line(await app.frame(), 0)).toMatch(/^Runs › api · /);
            expect(line(await app.escape(), 0)).toBe("Runs");
            expect(line(await app.escape(), 0), "Esc on the bare Runs screen does nothing").toBe("Runs");
            expect(app.quits()).toBe(0);
        } finally {
            await app.stop();
        }
    });

    it("shows a live update in the status bar", async () => {
        const app = await start();
        try {
            expect(line(await app.frame(), height - 1)).toMatch(/2 runs · 2 spans$/);
            await act(() =>
                Effect.runPromise(
                    SubscriptionRef.set(
                        app.ref,
                        indexed([
                            record({ span: "a", run: "run-1" }),
                            record({ span: "b", run: "run-2" }),
                            record({ span: "c", run: "run-3" }),
                        ]),
                    ),
                ),
            );
            expect(line(await app.frame(), height - 1)).toMatch(/3 runs · 3 spans$/);
        } finally {
            await app.stop();
        }
    });
});
