import { join } from "node:path";

import { RegistryContext } from "@effect/atom-react";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { testRender } from "@opentui/react/test-utils";
import { Array as Arr, Context, Effect, Exit, Layer, Option, Scope, SubscriptionRef } from "effect";
import { act } from "react";

import { Atoms } from "../../src/bridge/Atoms.ts";
import { SEARCH_DEBOUNCE_MILLIS } from "../../src/bridge/Lists.ts";
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

const serviceRecords = [
    record({ span: "a", run: "run-1", trace: "t1", service: "shop-api", startMs: 1000 }),
    record({ span: "b", run: "run-2", trace: "t2", service: "billing", startMs: 2000 }),
    record({ span: "c", run: "run-3", trace: "t3", service: "agent", startMs: 3000 }),
];
const services = indexed(serviceRecords);

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
    const click = async (x: number, y: number) => {
        await act(() => setup.mockMouse.click(x, y));
        return frame();
    };
    const drag = async (from: number, to: number) => {
        await act(() => setup.mockMouse.drag(10, from, 10, to));
        return frame();
    };
    const wheel = async (x: number, y: number, direction: "up" | "down") => {
        await act(() => setup.mockMouse.scroll(x, y, direction));
        return frame();
    };
    const enter = async () => {
        act(() => setup.mockInput.pressEnter());
        return frame();
    };
    const type = async (text: string) => {
        await act(() => setup.mockInput.typeText(text));
        return frame();
    };
    const settle = async () => {
        await act(() => Effect.runPromise(Effect.sleep(SEARCH_DEBOUNCE_MILLIS + 50)));
        return frame();
    };
    const publish = async (next: Snapshot) => {
        await act(() => Effect.runPromise(SubscriptionRef.set(ref, next)));
        return frame();
    };
    return {
        atoms,
        ref,
        click,
        drag,
        wheel,
        enter,
        type,
        settle,
        publish,
        quits: () => quits,
        suspends: () => suspends,
        frame,
        press,
        escape,
        stop,
    };
};

const lineIndex = (frame: string, text: string): number =>
    Option.getOrElse(
        Arr.findFirstIndex(frame.split("\n"), (row) => row.includes(text)),
        () => -1,
    );

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

    it("narrows a list as a query is typed, keeps it on Enter and clears it on Esc", async () => {
        const app = await start(Nav.initial, services);
        try {
            await app.press("/");
            await app.type("shop");
            const narrowed = await app.settle();
            expect(narrowed).toContain("shop-api");
            expect(narrowed).not.toContain("billing");
            expect(line(narrowed, height - 1)).toMatch(/^\/ shop▏ +1 of 3 runs$/);
            const kept = await app.enter();
            expect(line(kept, height - 1)).toMatch(/^\/ shop · 1 of 3 /);
            expect(kept).not.toContain("billing");
            const cleared = await app.escape();
            expect(cleared).toContain("billing");
            expect(line(cleared, height - 1)).toMatch(/^⏎ open/);
        } finally {
            await app.stop();
        }
    });

    it("selects a clicked row, and opens it on a second click", async () => {
        const app = await start(Nav.initial, services);
        try {
            const before = await app.frame();
            const billingRow = lineIndex(before, "billing");
            await app.click(10, billingRow);
            expect(line(await app.press("j"), 0), "the click selected billing, so j moved past it").toBe("Runs");
            await app.press("k");
            const opened = await app.click(10, billingRow);
            expect(line(opened, 0)).toMatch(/^Runs › billing · /);
        } finally {
            await app.stop();
        }
    });

    it("picks nothing when a press is released over another row", async () => {
        const app = await start(Nav.initial, services);
        try {
            const before = await app.frame();
            await app.drag(lineIndex(before, "agent"), lineIndex(before, "billing"));
            expect(line(await app.enter(), 0)).toMatch(/^Runs › agent · /);
        } finally {
            await app.stop();
        }
    });

    it("scrolls with the wheel without moving the selection, and a key snaps back", async () => {
        const many = indexed(
            Array.from({ length: 40 }, (_, i) =>
                record({ span: `s${i}`, run: `run-${i}`, service: `svc-${i}`, trace: `t${i}`, startMs: 1000 + i }),
            ),
        );
        const app = await start(Nav.initial, many);
        try {
            const top = line(await app.frame(), 2);
            expect(top).toContain("svc-39");
            const scrolled = await app.wheel(10, 5, "down");
            expect(line(scrolled, 2)).toContain("svc-36");
            expect(scrolled).not.toContain("svc-39");
            const snapped = await app.press("j");
            expect(line(snapped, 2), "j moved the selection to svc-38, back in view").toContain("svc-39");
        } finally {
            await app.stop();
        }
    });

    it("keeps the selected run on its screen line when newer runs arrive above it", async () => {
        const runsOf = (count: number) =>
            Array.from({ length: count }, (_, i) =>
                record({ span: `s${i}`, run: `run-${i}`, service: `svc-${i}`, trace: `t${i}`, startMs: 1000 + i }),
            );
        const app = await start(Nav.initial, indexed(runsOf(40)));
        try {
            await app.press("G");
            const before = await app.press("u", { ctrl: true });
            const row = lineIndex(before, "svc-8 ");
            expect(row, "half a page up a scrolled window").toBe(10);
            const after = await app.publish(indexed(runsOf(42)));
            expect(lineIndex(after, "svc-8 ")).toBe(row);
            expect(line(after, height - 1)).toMatch(/↑ 2 new/);
            const moved = await app.press("j");
            expect(lineIndex(moved, "svc-7 "), "the selection held").toBe(row + 1);
        } finally {
            await app.stop();
        }
    });
});
