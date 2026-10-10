import { top } from "../nav/Nav.ts";
import { parse } from "../query/Query.ts";
import { Action, Peel } from "./Action.ts";

import type { Nav } from "../nav/Nav.ts";
import type { Pane } from "../nav/Screen.ts";
import type { BindingAction, ListAction } from "./Action.ts";
import type { Key } from "./Key.ts";
import type { Array as Arr } from "effect";

/** What has the keyboard. Each overlay is its own mode, because each closes on its own key and ignores the other's. */
export type Mode = "screen" | "input" | "help" | "badLines";

export type Focus = "Runs" | "Traces" | `Trace.${Pane}` | "Body";

/**
 * `Trace` holds the keys of every Trace pane. `overlay` and `input` hold the keys of those modes, and `always` holds
 * the one key that acts in every mode.
 */
export type Scope = Focus | "Trace" | "movement" | "global" | "overlay" | "input" | "always";

export type HintScope = Focus | "overlay";

/** A condition read from the Nav alone. A binding whose guard fails does not exist for dispatch, hints or help. */
export type Guard = "treeSearch" | "noTreeSearch";

/** A condition that needs the Trace model. It gates only whether a hint shows, never what a key does. */
export type HintFact = "toOrigin";

export interface Hint {
    readonly label?: string;
    readonly rank: Partial<Readonly<Record<HintScope, number>>>;
    readonly when?: HintFact;
    /** Dropped last from a narrow status bar. */
    readonly sticky?: true;
}

export interface Binding {
    readonly scope: Scope;
    /** The first key is the one a hint shows. */
    readonly keys: Arr.NonEmptyReadonlyArray<Key>;
    readonly action: BindingAction;
    /** The help overlay's text. Adjacent bindings in a scope with the same text share one help row. */
    readonly label: string;
    readonly when?: Guard;
    readonly hint?: Hint;
}

export const focusOf = (nav: Nav): Focus => {
    const screen = top(nav);
    return screen._tag === "Trace" ? `Trace.${screen.view.pane}` : screen._tag;
};

export const holds = (guard: Guard, nav: Nav): boolean => {
    const screen = top(nav);
    // The same test as the status line's: a search counts once it has terms.
    const treeSearch = screen._tag === "Trace" && parse(screen.view.search).length > 0;
    return guard === "treeSearch" ? treeSearch : !treeSearch;
};

interface Extra {
    readonly when?: Guard;
    readonly hint?: Hint;
}

const bind = (
    scope: Scope,
    keys: Arr.NonEmptyReadonlyArray<Key>,
    action: BindingAction,
    label: string,
    extra: Extra = {},
): Binding => ({ scope, keys, action, label, ...extra });

const onLists = (
    keys: Arr.NonEmptyReadonlyArray<Key>,
    action: BindingAction,
    label: string,
    extra: Extra = {},
): ReadonlyArray<Binding> => [bind("Runs", keys, action, label, extra), bind("Traces", keys, action, label, extra)];

const lists = (
    keys: Arr.NonEmptyReadonlyArray<Key>,
    action: ListAction,
    label: string,
    extra: Extra = {},
): ReadonlyArray<Binding> => onLists(keys, action, label, extra);

const listRank = (rank: number) => ({ Runs: rank, Traces: rank });

/** The whole v1 keymap. Dispatch, the hint line and the help overlay all read this table and nothing else. */
export const BINDINGS: ReadonlyArray<Binding> = [
    bind("global", ["escape"], Peel, "close, clear the query, or go back"),
    bind("global", ["?"], Action.OpenHelp(), "help", {
        hint: {
            rank: {
                Runs: 99,
                Traces: 99,
                "Trace.tree": 99,
                "Trace.details": 99,
                "Trace.logs": 99,
                Body: 99,
            },
            sticky: true,
        },
    }),
    bind("global", ["!"], Action.OpenBadLines(), "bad lines"),
    bind("global", ["q"], Action.Quit(), "quit"),
    bind("global", ["ctrl+z"], Action.Suspend(), "suspend to the shell"),
    bind("always", ["ctrl+c"], Action.Quit(), "quit from anywhere"),

    bind("overlay", ["escape", "q"], Action.CloseOverlay(), "close", { hint: { rank: { overlay: 1 } } }),

    bind("input", ["return"], Action.SubmitInput(), "keep the query"),
    bind("input", ["escape"], Action.CancelInput(), "restore the query"),
    bind("input", ["left"], Action.EditInput({ op: "left" }), "cursor left"),
    bind("input", ["right"], Action.EditInput({ op: "right" }), "cursor right"),
    bind("input", ["ctrl+a"], Action.EditInput({ op: "home" }), "start of the line"),
    bind("input", ["ctrl+e"], Action.EditInput({ op: "end" }), "end of the line"),
    bind("input", ["backspace"], Action.EditInput({ op: "backspace" }), "delete a character"),
    bind("input", ["ctrl+w"], Action.EditInput({ op: "deleteWord" }), "delete a word"),
    bind("input", ["ctrl+u"], Action.EditInput({ op: "deleteToStart" }), "delete to the start"),
    bind("input", ["up"], Action.RecallQuery({ dir: "older" }), "older query"),
    bind("input", ["down"], Action.RecallQuery({ dir: "newer" }), "newer query"),

    bind("movement", ["j"], Action.Move({ by: "row", dir: "next" }), "row"),
    bind("movement", ["k"], Action.Move({ by: "row", dir: "prev" }), "row"),
    bind("movement", ["up"], Action.Move({ by: "row", dir: "prev" }), "row"),
    bind("movement", ["down"], Action.Move({ by: "row", dir: "next" }), "row"),
    bind("movement", ["ctrl+d"], Action.Move({ by: "halfPage", dir: "next" }), "half page"),
    bind("movement", ["ctrl+u"], Action.Move({ by: "halfPage", dir: "prev" }), "half page"),
    bind("movement", ["pagedown"], Action.Move({ by: "page", dir: "next" }), "page"),
    bind("movement", ["pageup"], Action.Move({ by: "page", dir: "prev" }), "page"),
    bind("movement", ["g"], Action.Jump({ to: "start" }), "ends"),
    bind("movement", ["G"], Action.Jump({ to: "end" }), "ends"),
    bind("movement", ["home"], Action.Jump({ to: "start" }), "ends"),
    bind("movement", ["end"], Action.Jump({ to: "end" }), "ends"),

    ...lists(["return"], Action.Open(), "open, or toggle a group", { hint: { label: "open", rank: listRank(1) } }),
    ...lists(["space"], Action.ToggleGroup(), "toggle a group"),
    ...onLists(["/"], Action.OpenQuery(), "filter", { hint: { rank: listRank(2) } }),
    ...lists(["n"], Action.NextProblem({ dir: "next" }), "problem", { hint: { rank: listRank(3) } }),
    ...lists(["N"], Action.NextProblem({ dir: "prev" }), "problem"),
    ...lists(["S"], Action.CycleSort(), "sort", { hint: { rank: listRank(4) } }),
    ...lists(["r"], Action.Reverse(), "reverse"),

    bind("Trace", ["1"], Action.FocusPane({ pane: "tree" }), "focus tree", {
        hint: { label: "tree", rank: { "Trace.details": 3 } },
    }),
    bind("Trace", ["2"], Action.FocusPane({ pane: "details" }), "focus details"),
    bind("Trace", ["3"], Action.FocusPane({ pane: "logs" }), "focus logs"),
    bind("Trace", ["tab"], Action.CyclePane({ dir: "next" }), "cycle panes"),
    bind("Trace", ["shift+tab"], Action.CyclePane({ dir: "prev" }), "cycle panes"),
    bind("Trace", ["-"], Action.ResizeSplit({ delta: -5 }), "split"),
    bind("Trace", ["+", "="], Action.ResizeSplit({ delta: 5 }), "split"),
    bind("Trace", ["<"], Action.ResizeNameColumn({ delta: -5 }), "name column"),
    bind("Trace", [">"], Action.ResizeNameColumn({ delta: 5 }), "name column"),
    bind("Trace", ["s"], Action.CycleLogScope(), "log scope", { hint: { label: "scope", rank: { "Trace.logs": 3 } } }),
    bind("Trace", ["b"], Action.OpenBody(), "body", { hint: { rank: { "Trace.tree": 4, "Trace.details": 1 } } }),
    bind("Trace", ["e"], Action.OpenEditor(), "open the source location in the editor", {
        hint: { label: "editor", rank: { "Trace.details": 2 } },
    }),

    bind("Trace.tree", ["return", "space"], Action.ToggleFold(), "fold, or toggle a group", {
        hint: { label: "fold", rank: { "Trace.tree": 1 } },
    }),
    bind("Trace.tree", ["/"], Action.OpenQuery(), "search", { hint: { rank: { "Trace.tree": 2 } } }),
    bind("Trace.tree", ["n"], Action.NextMatch({ dir: "next" }), "match", {
        when: "treeSearch",
        hint: { rank: { "Trace.tree": 3 } },
    }),
    bind("Trace.tree", ["N"], Action.NextMatch({ dir: "prev" }), "match", { when: "treeSearch" }),
    bind("Trace.tree", ["n"], Action.NextProblem({ dir: "next" }), "problem", {
        when: "noTreeSearch",
        hint: { rank: { "Trace.tree": 3 } },
    }),
    bind("Trace.tree", ["N"], Action.NextProblem({ dir: "prev" }), "problem", { when: "noTreeSearch" }),
    bind("Trace.tree", ["o"], Action.GoToOrigin(), "go to the failure origin", {
        hint: { label: "origin", rank: { "Trace.tree": 5 }, when: "toOrigin" },
    }),
    bind("Trace.tree", ["h", "left"], Action.FoldOrParent(), "fold, or go to the parent"),
    bind("Trace.tree", ["l", "right"], Action.Unfold(), "unfold"),
    bind("Trace.tree", ["E"], Action.ExpandAll(), "expand all"),
    bind("Trace.tree", ["C"], Action.CollapseAll(), "collapse all"),

    bind("Trace.details", ["/"], Action.OpenQuery(), "search"),

    bind("Trace.logs", ["return"], Action.GoToLogSpan(), "go to the log's span", {
        hint: { label: "go to span", rank: { "Trace.logs": 1 } },
    }),
    bind("Trace.logs", ["/"], Action.OpenQuery(), "filter", { hint: { rank: { "Trace.logs": 2 } } }),

    bind("Body", ["/"], Action.OpenQuery(), "search", { hint: { rank: { Body: 1 } } }),
    bind("Body", ["space"], Action.Move({ by: "page", dir: "next" }), "page"),
    bind("Body", ["h", "left"], Action.Sideways({ dir: "prev" }), "sideways"),
    bind("Body", ["l", "right"], Action.Sideways({ dir: "next" }), "sideways"),
    bind("Body", ["tab"], Action.CycleBody({ dir: "next" }), "body"),
    bind("Body", ["shift+tab"], Action.CycleBody({ dir: "prev" }), "body"),
    bind("Body", ["r"], Action.ToggleRaw(), "raw", { hint: { rank: { Body: 2 } } }),
    bind("Body", ["w"], Action.ToggleWrap(), "wrap", { hint: { rank: { Body: 3 } } }),
    bind("Body", ["n"], Action.NextMatch({ dir: "next" }), "match"),
    bind("Body", ["N"], Action.NextMatch({ dir: "prev" }), "match"),
    bind("Body", ["y"], Action.Copy(), "copy", { hint: { rank: { Body: 4 } } }),
    bind("Body", ["e"], Action.OpenEditor(), "open the body file in the editor"),
];
