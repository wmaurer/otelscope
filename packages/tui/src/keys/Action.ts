import { Data } from "effect";

import type { Pane } from "../nav/Screen.ts";

export type Dir = "next" | "prev";

export type Action = Data.TaggedEnum<{
    Quit: {};
    Suspend: {};
    OpenHelp: {};
    OpenBadLines: {};
    CloseOverlay: {};
    ClearQuery: {};
    Back: {};
    OpenQuery: {};
    SubmitInput: {};
    CancelInput: {};

    Move: { readonly by: "row" | "halfPage" | "page"; readonly dir: Dir };
    Jump: { readonly to: "start" | "end" };

    Open: {};
    ToggleGroup: {};
    NextProblem: { readonly dir: Dir };
    CycleSort: {};
    Reverse: {};

    FocusPane: { readonly pane: Pane };
    CyclePane: { readonly dir: Dir };
    ResizeSplit: { readonly delta: number };
    ResizeNameColumn: { readonly delta: number };
    CycleLogScope: {};
    OpenBody: {};
    OpenEditor: {};

    ToggleFold: {};
    FoldOrParent: {};
    Unfold: {};
    NextMatch: { readonly dir: Dir };
    GoToOrigin: {};
    ExpandAll: {};
    CollapseAll: {};

    GoToLogSpan: {};

    Sideways: { readonly dir: Dir };
    CycleBody: { readonly dir: Dir };
    ToggleRaw: {};
    ToggleWrap: {};
    Copy: {};
}>;
export const Action = Data.taggedEnum<Action>();

const shellTags = [
    "Quit",
    "Suspend",
    "OpenHelp",
    "OpenBadLines",
    "CloseOverlay",
    "ClearQuery",
    "Back",
    "OpenQuery",
    "SubmitInput",
    "CancelInput",
] as const;

export type ShellAction = Extract<Action, { readonly _tag: (typeof shellTags)[number] }>;
export type ScreenAction = Exclude<Action, ShellAction>;

const shellTagSet: ReadonlySet<string> = new Set(shellTags);

export const isShellAction = (action: Action): action is ShellAction => shellTagSet.has(action._tag);

/**
 * `Esc` on a screen: clear the focused query, else go back, else nothing. Only the binding table holds it, and
 * dispatch resolves it, so callers only ever see concrete actions.
 */
export interface Peel {
    readonly _tag: "Peel";
}
export const Peel: Peel = { _tag: "Peel" };

export type BindingAction = Action | Peel;
