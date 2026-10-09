import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { initialShell, modeOf, Shell, ShellEffect, stepShell } from "../../src/keys/Shell.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { runs, runsFiltered, traces } from "../support/keys.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { Extent } from "../../src/keys/Shell.ts";

const clean = indexed([]);
const withBadLines: Snapshot = { ...clean, badLines: { legacy: 2, malformed: 0, samples: [] } };
const extent: Extent = { total: 30, viewport: 10 };
const help = (scroll = 0) => Shell.Overlay({ kind: "help", scroll });

describe("stepShell", () => {
    it("quits and suspends through effects, leaving the rest alone", () => {
        const quit = stepShell(initialShell, runs, clean, extent, Action.Quit());
        expect(quit).toEqual({ shell: initialShell, nav: runs, effects: [ShellEffect.Quit()], forward: Option.none() });
        expect(stepShell(initialShell, runs, clean, extent, Action.Suspend()).effects).toEqual([ShellEffect.Suspend()]);
    });

    it("opens and closes the overlays", () => {
        expect(stepShell(initialShell, runs, clean, extent, Action.OpenHelp()).shell).toEqual(help());
        expect(stepShell(help(4), runs, clean, extent, Action.CloseOverlay()).shell).toEqual(Shell.Screen());
        expect(stepShell(initialShell, runs, withBadLines, extent, Action.OpenBadLines()).shell).toEqual(
            Shell.Overlay({ kind: "badLines", scroll: 0 }),
        );
    });

    it("says there are no bad lines instead of opening an empty overlay", () => {
        const step = stepShell(initialShell, runs, clean, extent, Action.OpenBadLines());
        expect(step.shell).toEqual(initialShell);
        expect(step.effects).toEqual([ShellEffect.Say({ text: "no bad lines" })]);
    });

    it("goes back and clears the query on the stack", () => {
        expect(stepShell(initialShell, traces, clean, extent, Action.Back()).nav.stack).toEqual(Nav.initial.stack);
        expect(Nav.top(stepShell(initialShell, runsFiltered, clean, extent, Action.ClearQuery()).nav)).toMatchObject({
            view: { filter: "" },
        });
        expect(stepShell(initialShell, runs, clean, extent, Action.OpenHelp()).nav, "the same Nav").toBe(runs);
    });

    it("scrolls an open overlay with the movement keys, within its lines", () => {
        const scroll = (from: number, action: Action) => stepShell(help(from), runs, clean, extent, action).shell;
        expect(scroll(0, Action.Move({ by: "row", dir: "next" }))).toEqual(help(1));
        expect(scroll(0, Action.Move({ by: "row", dir: "prev" }))).toEqual(help(0));
        expect(scroll(0, Action.Move({ by: "halfPage", dir: "next" }))).toEqual(help(5));
        expect(scroll(15, Action.Move({ by: "page", dir: "next" }))).toEqual(help(20));
        expect(scroll(0, Action.Jump({ to: "end" }))).toEqual(help(20));
        expect(scroll(12, Action.Jump({ to: "start" }))).toEqual(help(0));
        expect(stepShell(help(), runs, clean, { total: 3, viewport: 10 }, Action.Jump({ to: "end" })).shell).toEqual(
            help(0),
        );
        expect(
            stepShell(help(), runs, clean, extent, Action.Open()).forward,
            "no screen action under an overlay",
        ).toEqual(Option.none());
    });

    it("hands screen actions to the screens", () => {
        const step = stepShell(initialShell, runs, clean, extent, Action.Move({ by: "row", dir: "next" }));
        expect(step.forward).toEqual(Option.some(Action.Move({ by: "row", dir: "next" })));
        expect(step.shell).toBe(initialShell);
    });

    it("closes the input on Enter and Esc", () => {
        expect(stepShell(Shell.Input(), runs, clean, extent, Action.SubmitInput()).shell).toEqual(Shell.Screen());
        expect(stepShell(Shell.Input(), runs, clean, extent, Action.CancelInput()).shell).toEqual(Shell.Screen());
    });

    it("derives the dispatch mode from what is open", () => {
        expect(modeOf(initialShell)).toBe("screen");
        expect(modeOf(help())).toBe("help");
        expect(modeOf(Shell.Overlay({ kind: "badLines", scroll: 0 }))).toBe("badLines");
        expect(modeOf(Shell.Input())).toBe("input");
    });
});
