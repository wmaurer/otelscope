import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { BINDINGS } from "../../src/keys/Bindings.ts";
import { dispatch, scopesFor } from "../../src/keys/Dispatch.ts";
import { normalize } from "../../src/keys/Key.ts";
import { body, bodySearching, press, runs, runsFiltered, trace, traces, tracesFiltered } from "../support/keys.ts";

import type { Mode } from "../../src/keys/Bindings.ts";
import type { Nav } from "../../src/nav/Nav.ts";

const row = (dir: "next" | "prev") => Action.Move({ by: "row", dir });

// The keymap is written out by hand, not read from the binding table, so a wrong table entry fails here.
const movement: ReadonlyArray<readonly [string, Action]> = [
    ["j", row("next")],
    ["k", row("prev")],
    ["up", row("prev")],
    ["down", row("next")],
    ["ctrl+d", Action.Move({ by: "halfPage", dir: "next" })],
    ["ctrl+u", Action.Move({ by: "halfPage", dir: "prev" })],
    ["pagedown", Action.Move({ by: "page", dir: "next" })],
    ["pageup", Action.Move({ by: "page", dir: "prev" })],
    ["g", Action.Jump({ to: "start" })],
    ["G", Action.Jump({ to: "end" })],
    ["home", Action.Jump({ to: "start" })],
    ["end", Action.Jump({ to: "end" })],
];

const global: ReadonlyArray<readonly [string, Action]> = [
    ["?", Action.OpenHelp()],
    ["!", Action.OpenBadLines()],
    ["q", Action.Quit()],
    ["ctrl+c", Action.Quit()],
    ["ctrl+z", Action.Suspend()],
];

const lists: ReadonlyArray<readonly [string, Action]> = [
    ["return", Action.Open()],
    ["space", Action.ToggleGroup()],
    ["/", Action.OpenQuery()],
    ["n", Action.NextProblem({ dir: "next" })],
    ["N", Action.NextProblem({ dir: "prev" })],
    ["S", Action.CycleSort()],
    ["r", Action.Reverse()],
];

const anyPane: ReadonlyArray<readonly [string, Action]> = [
    ["1", Action.FocusPane({ pane: "tree" })],
    ["2", Action.FocusPane({ pane: "details" })],
    ["3", Action.FocusPane({ pane: "logs" })],
    ["tab", Action.CyclePane({ dir: "next" })],
    ["shift+tab", Action.CyclePane({ dir: "prev" })],
    ["-", Action.ResizeSplit({ delta: -5 })],
    ["+", Action.ResizeSplit({ delta: 5 })],
    ["=", Action.ResizeSplit({ delta: 5 })],
    ["<", Action.ResizeNameColumn({ delta: -5 })],
    [">", Action.ResizeNameColumn({ delta: 5 })],
    ["s", Action.CycleLogScope()],
    ["b", Action.OpenBody()],
    ["e", Action.OpenEditor()],
];

const tree: ReadonlyArray<readonly [string, Action]> = [
    ["return", Action.ToggleFold()],
    ["space", Action.ToggleFold()],
    ["/", Action.OpenQuery()],
    ["h", Action.FoldOrParent()],
    ["left", Action.FoldOrParent()],
    ["l", Action.Unfold()],
    ["right", Action.Unfold()],
    ["n", Action.NextProblem({ dir: "next" })],
    ["N", Action.NextProblem({ dir: "prev" })],
    ["o", Action.GoToOrigin()],
    ["E", Action.ExpandAll()],
    ["C", Action.CollapseAll()],
];

const bodyKeys: ReadonlyArray<readonly [string, Action]> = [
    ["/", Action.OpenQuery()],
    ["space", Action.Move({ by: "page", dir: "next" })],
    ["h", Action.Sideways({ dir: "prev" })],
    ["left", Action.Sideways({ dir: "prev" })],
    ["l", Action.Sideways({ dir: "next" })],
    ["right", Action.Sideways({ dir: "next" })],
    ["tab", Action.CycleBody({ dir: "next" })],
    ["shift+tab", Action.CycleBody({ dir: "prev" })],
    ["r", Action.ToggleRaw()],
    ["w", Action.ToggleWrap()],
    ["n", Action.NextMatch({ dir: "next" })],
    ["N", Action.NextMatch({ dir: "prev" })],
    ["y", Action.Copy()],
    ["e", Action.OpenEditor()],
];

const expectKeys = (mode: Mode, nav: Nav, keys: ReadonlyArray<readonly [string, Action | undefined]>) =>
    Arr.forEach(keys, ([key, action]) =>
        expect(dispatch(mode, nav, press(key)), `${key} in ${mode} mode`).toEqual(Option.fromUndefinedOr(action)),
    );

describe("dispatch", () => {
    it("runs every v1 key in its scope", () => {
        Arr.forEach([runs, traces], (nav) => expectKeys("screen", nav, [...lists, ...movement, ...global]));
        expectKeys("screen", trace("tree"), [...tree, ...anyPane, ...movement, ...global]);
        expectKeys("screen", trace("details"), [["/", Action.OpenQuery()], ...anyPane, ...movement, ...global]);
        expectKeys("screen", trace("logs"), [
            ["return", Action.GoToLogSpan()],
            ["/", Action.OpenQuery()],
            ...anyPane,
            ...movement,
            ...global,
        ]);
        expectKeys("screen", body, [...bodyKeys, ...movement, ...global]);
    });

    it("moves between matches instead of problems while a tree search is active", () => {
        expectKeys("screen", trace("tree", { search: "boom" }), [
            ["n", Action.NextMatch({ dir: "next" })],
            ["N", Action.NextMatch({ dir: "prev" })],
        ]);
    });

    it("ignores keys bound only on other screens and keys bound nowhere", () => {
        expectKeys("screen", runs, [
            ["e", undefined],
            ["b", undefined],
            ["s", undefined],
            ["y", undefined],
            ["1", undefined],
            ["x", undefined],
            ["backspace", undefined],
        ]);
        expectKeys("screen", trace("details"), [
            ["return", undefined],
            ["o", undefined],
            ["S", undefined],
            ["y", undefined],
        ]);
        expectKeys("screen", trace("logs"), [["n", undefined]]);
    });

    it("looks up the focused pane, then the screen, then movement, then global keys", () => {
        expect(scopesFor("screen", trace("logs"))).toEqual(["Trace.logs", "Trace", "movement", "global", "always"]);
        expect(scopesFor("screen", runs)).toEqual(["Runs", "movement", "global", "always"]);
        expect(scopesFor("screen", body)).toEqual(["Body", "movement", "global", "always"]);
    });

    it("peels one layer with Esc: the focused query, then the screen", () => {
        expect(dispatch("screen", runs, press("escape")), "nothing on the bare Runs screen").toEqual(Option.none());
        expect(dispatch("screen", runsFiltered, press("escape"))).toEqual(Option.some(Action.ClearQuery()));
        expect(dispatch("screen", traces, press("escape"))).toEqual(Option.some(Action.Back()));
        expect(dispatch("screen", tracesFiltered, press("escape"))).toEqual(Option.some(Action.ClearQuery()));
        expect(dispatch("screen", trace("logs", { logFilter: "warn" }), press("escape"))).toEqual(
            Option.some(Action.ClearQuery()),
        );
        expect(
            dispatch("screen", trace("logs", { search: "boom" }), press("escape")),
            "the tree search is not the logs pane's query",
        ).toEqual(Option.some(Action.Back()));
        expect(dispatch("screen", bodySearching, press("escape"))).toEqual(Option.some(Action.ClearQuery()));
        expect(dispatch("screen", body, press("escape"))).toEqual(Option.some(Action.Back()));
    });

    it("lets only movement, its own key, Esc, q and Ctrl-c act in an overlay", () => {
        const close = Action.CloseOverlay();
        expectKeys("help", trace("tree"), [
            ["?", close],
            ["escape", close],
            ["q", close],
            ["!", undefined],
            ["j", row("next")],
            ["G", Action.Jump({ to: "end" })],
            ["ctrl+d", Action.Move({ by: "halfPage", dir: "next" })],
            ["ctrl+c", Action.Quit()],
            ["ctrl+z", undefined],
            ["/", undefined],
            ["return", undefined],
            ["b", undefined],
        ]);
        expectKeys("badLines", runsFiltered, [
            ["!", close],
            ["escape", close],
            ["q", close],
            ["?", undefined],
            ["k", row("prev")],
        ]);
    });

    it("leaves every key but the input's own to an open input, as text", () => {
        expectKeys("input", runs, [
            ["return", Action.SubmitInput()],
            ["escape", Action.CancelInput()],
            ["ctrl+c", Action.Quit()],
            ["left", Action.EditInput({ op: "left" })],
            ["right", Action.EditInput({ op: "right" })],
            ["ctrl+a", Action.EditInput({ op: "home" })],
            ["ctrl+e", Action.EditInput({ op: "end" })],
            ["backspace", Action.EditInput({ op: "backspace" })],
            ["ctrl+w", Action.EditInput({ op: "deleteWord" })],
            ["ctrl+u", Action.EditInput({ op: "deleteToStart" })],
            ["up", Action.RecallQuery({ dir: "older" })],
            ["down", Action.RecallQuery({ dir: "newer" })],
            ["q", Action.InsertText({ text: "q" })],
            ["j", Action.InsertText({ text: "j" })],
            ["/", Action.InsertText({ text: "/" })],
            ["?", Action.InsertText({ text: "?" })],
            ["G", Action.InsertText({ text: "G" })],
            ["space", Action.InsertText({ text: " " })],
            ["ctrl+z", undefined],
            ["tab", undefined],
            ["home", undefined],
        ]);
    });

    it("types the printable characters of a pasted sequence", () => {
        expect(
            dispatch("input", runs, { name: "", sequence: "pay\nment", ctrl: false, meta: false, shift: false }),
        ).toEqual(Option.some(Action.InsertText({ text: "payment" })));
    });

    it("never needs the order of the table to decide between two bindings of one key", () => {
        const clashes = Arr.filter(BINDINGS, (a) =>
            Arr.some(
                BINDINGS,
                (b) =>
                    a !== b &&
                    a.scope === b.scope &&
                    Arr.some(a.keys, (key) => Arr.contains(b.keys, key)) &&
                    !(
                        (a.when === "treeSearch" && b.when === "noTreeSearch") ||
                        (a.when === "noTreeSearch" && b.when === "treeSearch")
                    ),
            ),
        );
        expect(clashes).toEqual([]);
    });
});

describe("normalize", () => {
    it("matches printable keys on the character received", () => {
        expect(normalize(press("G"))).toBe("G");
        expect(normalize({ name: "/", sequence: "?", ctrl: false, meta: false, shift: true }), "a shifted /").toBe("?");
        expect(normalize({ name: "1", sequence: "+", ctrl: false, meta: false, shift: true }), "Swiss-German +").toBe(
            "+",
        );
        expect(normalize({ name: "linefeed", sequence: "\n", ctrl: false, meta: false, shift: false })).toBe("return");
    });

    it("never reads an Alt chord as the bare key", () => {
        const altQ = { name: "q", sequence: "\u001bq", ctrl: false, meta: true, shift: false };
        expect(dispatch("screen", runs, altQ)).toEqual(Option.none());
    });

    it("never types a chord with Meta held", () => {
        const metaX = { name: "x", sequence: "x", ctrl: false, meta: true, shift: false };
        expect(dispatch("input", runs, metaX)).toEqual(Option.none());
    });
});
