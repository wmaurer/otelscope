import { Data } from "effect";

import type { Pane } from "../nav/Screen.ts";
import type { EditOp } from "./Input.ts";

export type Dir = "next" | "prev";

type MoveBy = "row" | "halfPage" | "page";

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
    InsertText: { readonly text: string };
    EditInput: { readonly op: EditOp };
    RecallQuery: { readonly dir: "older" | "newer" };

    Move: { readonly by: MoveBy; readonly dir: Dir };
    Jump: { readonly to: "start" | "end" };

    Open: {};
    ToggleGroup: {};
    NextProblem: { readonly dir: Dir };
    CycleSort: {};
    Reverse: {};
    Pick: { readonly key: string };

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

export const moveRows = (by: MoveBy, viewport: number): number => {
    switch (by) {
        case "row":
            return 1;
        case "halfPage":
            return Math.max(1, Math.floor(viewport / 2));
        case "page":
            return Math.max(1, viewport);
    }
};

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
    "InsertText",
    "EditInput",
    "RecallQuery",
] as const;

export type ShellAction = Extract<Action, { readonly _tag: (typeof shellTags)[number] }>;
export type ScreenAction = Exclude<Action, ShellAction>;

const shellTagSet: ReadonlySet<string> = new Set(shellTags);

export const isShellAction = (action: Action): action is ShellAction => shellTagSet.has(action._tag);

const listTags = ["Move", "Jump", "Open", "ToggleGroup", "NextProblem", "CycleSort", "Reverse", "Pick"] as const;

export type ListAction = Extract<ScreenAction, { readonly _tag: (typeof listTags)[number] }>;

const listTagSet: ReadonlySet<string> = new Set(listTags);

export const isListAction = (action: ScreenAction): action is ListAction => listTagSet.has(action._tag);

/**
 * `Esc` on a screen: clear the focused query, else go back, else nothing. Only the binding table holds it, and
 * dispatch resolves it, so callers only ever see concrete actions.
 */
export interface Peel {
    readonly _tag: "Peel";
}
export const Peel: Peel = { _tag: "Peel" };

export type BindingAction = Action | Peel;
