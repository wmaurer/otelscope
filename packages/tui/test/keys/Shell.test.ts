import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { initialKeyState, initialShell, modeOf, Shell, ShellEffect, stepShell } from "../../src/keys/Shell.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { activeQuery } from "../../src/nav/Query.ts";
import { runs, runsFiltered, traces } from "../support/keys.ts";
import { listFor } from "../support/lists.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { EditOp } from "../../src/keys/Input.ts";
import type { Extent, KeyContext, KeyState } from "../../src/keys/Shell.ts";

const clean = indexed([]);
const withBadLines: Snapshot = { ...clean, badLines: { legacy: 2, malformed: 0, samples: [] } };
const extent: Extent = { total: 30, viewport: 10 };
const help = (scroll = 0) => Shell.Overlay({ kind: "help", scroll });
const at = (shell: Shell): KeyState => ({ ...initialKeyState, shell });
const twoRuns = indexed([record({ span: "a", run: "run-1" }), record({ span: "b", run: "run-2", startMs: 2000 })]);
const ctx = (nav: Nav.Nav, snapshot: Snapshot, overlay: Extent): KeyContext => ({
    nav,
    snapshot,
    overlay,
    list: listFor(nav, snapshot),
    listRows: 10,
});

describe("stepShell", () => {
    it("quits and suspends through effects, leaving the rest alone", () => {
        const quit = stepShell(initialKeyState, ctx(runs, clean, extent), Action.Quit());
        expect(quit).toEqual({ state: initialKeyState, nav: runs, effects: [ShellEffect.Quit()] });
        expect(stepShell(initialKeyState, ctx(runs, clean, extent), Action.Suspend()).effects).toEqual([
            ShellEffect.Suspend(),
        ]);
    });

    it("opens and closes the overlays", () => {
        expect(stepShell(initialKeyState, ctx(runs, clean, extent), Action.OpenHelp()).state.shell).toEqual(help());
        expect(stepShell(at(help(4)), ctx(runs, clean, extent), Action.CloseOverlay()).state.shell).toEqual(
            Shell.Screen(),
        );
        expect(stepShell(initialKeyState, ctx(runs, withBadLines, extent), Action.OpenBadLines()).state.shell).toEqual(
            Shell.Overlay({ kind: "badLines", scroll: 0 }),
        );
    });

    it("says there are no bad lines instead of opening an empty overlay", () => {
        const step = stepShell(initialKeyState, ctx(runs, clean, extent), Action.OpenBadLines());
        expect(step.state.shell).toEqual(initialShell);
        expect(step.effects).toEqual([ShellEffect.Say({ text: "no bad lines" })]);
    });

    it("goes back and clears the query on the stack", () => {
        expect(stepShell(initialKeyState, ctx(traces, clean, extent), Action.Back()).nav.stack).toEqual(
            Nav.initial.stack,
        );
        expect(
            Nav.top(stepShell(initialKeyState, ctx(runsFiltered, clean, extent), Action.ClearQuery()).nav),
        ).toMatchObject({ view: { filter: "" } });
        expect(stepShell(initialKeyState, ctx(runs, clean, extent), Action.OpenHelp()).nav, "the same Nav").toBe(runs);
    });

    it("scrolls an open overlay with the movement keys, within its lines", () => {
        const scroll = (from: number, action: Action) =>
            stepShell(at(help(from)), ctx(runs, clean, extent), action).state.shell;
        expect(scroll(0, Action.Move({ by: "row", dir: "next" }))).toEqual(help(1));
        expect(scroll(0, Action.Move({ by: "row", dir: "prev" }))).toEqual(help(0));
        expect(scroll(0, Action.Move({ by: "halfPage", dir: "next" }))).toEqual(help(5));
        expect(scroll(15, Action.Move({ by: "page", dir: "next" }))).toEqual(help(20));
        expect(scroll(0, Action.Jump({ to: "end" }))).toEqual(help(20));
        expect(scroll(12, Action.Jump({ to: "start" }))).toEqual(help(0));
        expect(
            stepShell(at(help()), ctx(runs, clean, { total: 3, viewport: 10 }), Action.Jump({ to: "end" })).state.shell,
        ).toEqual(help(0));
        expect(
            stepShell(at(help()), ctx(traces, twoRuns, extent), Action.Open()).nav,
            "no screen action under an overlay",
        ).toBe(traces);
    });

    it("hands screen actions to the top screen's reducer and says what it says", () => {
        const step = stepShell(initialKeyState, ctx(runs, twoRuns, extent), Action.Move({ by: "row", dir: "next" }));
        expect(Nav.top(step.nav)).toMatchObject({ view: { selected: Option.some("run-1") } });
        expect(step.state).toBe(initialKeyState);
        const none = stepShell(initialKeyState, ctx(runs, twoRuns, extent), Action.NextProblem({ dir: "next" }));
        expect(none.effects).toEqual([ShellEffect.Say({ text: "no problems" })]);
    });

    it("derives the dispatch mode from what is open", () => {
        expect(modeOf(initialShell)).toBe("screen");
        expect(modeOf(help())).toBe("help");
        expect(modeOf(Shell.Overlay({ kind: "badLines", scroll: 0 }))).toBe("badLines");
        expect(modeOf(Shell.Input({ cursor: 0, original: "", recall: Option.none() }))).toBe("input");
    });
});

const run = (actions: ReadonlyArray<Action>, nav: Nav.Nav = runs, state: KeyState = initialKeyState) =>
    Arr.reduce(actions, { state, nav }, (current, action) => {
        const step = stepShell(current.state, ctx(current.nav, clean, extent), action);
        return { state: step.state, nav: step.nav };
    });
const type = (text: string) => Action.InsertText({ text });
const editOp = (op: EditOp) => Action.EditInput({ op });

describe("the / input", () => {
    it("opens prefilled with the active query, cursor at the end, and filters as text is typed", () => {
        const opened = run([Action.OpenQuery()], runsFiltered);
        expect(opened.state.shell).toEqual(Shell.Input({ cursor: 4, original: "shop", recall: Option.none() }));
        const typed = run([Action.OpenQuery(), type("-api")], runsFiltered);
        expect(activeQuery(typed.nav)).toBe("shop-api");
    });

    it("edits at the cursor", () => {
        const edited = run([Action.OpenQuery(), type("card declined"), editOp("left"), editOp("left"), type("X")]);
        expect(activeQuery(edited.nav)).toBe("card declinXed");
        expect(activeQuery(run([Action.OpenQuery(), type("card declined"), editOp("deleteWord")]).nav)).toBe("card ");
        expect(activeQuery(run([Action.OpenQuery(), type("ab cd"), editOp("left"), editOp("deleteToStart")]).nav)).toBe(
            "d",
        );
        expect(
            activeQuery(run([Action.OpenQuery(), type("ab"), editOp("home"), editOp("backspace"), type("x")]).nav),
        ).toBe("xab");
    });

    it("keeps the query on ⏎ and remembers it; an empty query clears and is not remembered", () => {
        const kept = run([Action.OpenQuery(), type("pay"), Action.SubmitInput()]);
        expect(kept.state).toEqual({ shell: Shell.Screen(), history: ["pay"] });
        expect(activeQuery(kept.nav)).toBe("pay");
        const cleared = run(
            [Action.OpenQuery(), editOp("deleteToStart"), type("  "), Action.SubmitInput()],
            runsFiltered,
        );
        expect(activeQuery(cleared.nav)).toBe("");
        expect(cleared.state.history).toEqual([]);
    });

    it("restores the query from before / on Esc", () => {
        const cancelled = run([Action.OpenQuery(), type("-api"), Action.CancelInput()], runsFiltered);
        expect(cancelled.nav).toEqual(runsFiltered);
        expect(cancelled.state.shell).toEqual(Shell.Screen());
    });

    it("recalls earlier queries, newest first, and restores what was typed", () => {
        const withHistory: KeyState = { ...initialKeyState, history: ["pay", "shop"] };
        const older = run([Action.OpenQuery(), type("x"), Action.RecallQuery({ dir: "older" })], runs, withHistory);
        expect(activeQuery(older.nav)).toBe("pay");
        const oldest = run(
            [Action.RecallQuery({ dir: "older" }), Action.RecallQuery({ dir: "older" })],
            older.nav,
            older.state,
        );
        expect(activeQuery(oldest.nav), "stops at the oldest").toBe("shop");
        const back = run(
            [Action.RecallQuery({ dir: "newer" }), Action.RecallQuery({ dir: "newer" })],
            oldest.nav,
            oldest.state,
        );
        expect(activeQuery(back.nav)).toBe("x");
        expect(back.state.shell).toMatchObject({ cursor: 1, recall: Option.none() });
    });

    it("ignores screen actions while the input is open", () => {
        const open = run([Action.OpenQuery()]);
        const step = stepShell(open.state, ctx(open.nav, twoRuns, extent), Action.Move({ by: "row", dir: "next" }));
        expect(step.nav).toBe(open.nav);
    });
});
