import { Data, Option } from "effect";

import { back } from "../nav/Nav.ts";
import { activeQuery, clearQuery, setQuery, submitQuery, typeQuery } from "../nav/Query.ts";
import { ShellEffect } from "../nav/ScreenStep.ts";
import { stepScreen } from "../nav/Step.ts";
import { isShellAction, moveRows } from "./Action.ts";
import { edit, insert, recall, remember } from "./Input.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Nav } from "../nav/Nav.ts";
import type { StepContext } from "../nav/ScreenStep.ts";
import type { Action, ScreenAction } from "./Action.ts";
import type { Mode } from "./Bindings.ts";
import type { History, LineEdit, Recall } from "./Input.ts";

export type Shell = Data.TaggedEnum<{
    Screen: {};
    Overlay: { readonly kind: "help" | "badLines"; readonly scroll: number };
    Input: { readonly cursor: number; readonly original: string; readonly recall: Option.Option<Recall> };
}>;
export const Shell = Data.taggedEnum<Shell>();

export const initialShell: Shell = Shell.Screen();

export interface KeyState {
    readonly shell: Shell;
    readonly history: History;
}

export const initialKeyState: KeyState = { shell: initialShell, history: [] };

export const modeOf = (shell: Shell): Mode =>
    Shell.$match(shell, {
        Screen: (): Mode => "screen",
        Overlay: ({ kind }): Mode => kind,
        Input: (): Mode => "input",
    });

export interface Extent {
    readonly total: number;
    readonly viewport: number;
}

export interface KeyContext extends StepContext {
    readonly nav: Nav;
    readonly overlay: Extent;
}

export interface ShellStep {
    readonly state: KeyState;
    /** The same Nav when the action did not change it. */
    readonly nav: Nav;
    readonly effects: ReadonlyArray<ShellEffect>;
}

const scrolled = (scroll: number, action: ScreenAction, extent: Extent): Option.Option<number> => {
    const last = Math.max(0, extent.total - extent.viewport);
    const clamp = (n: number) => Math.min(last, Math.max(0, n));
    switch (action._tag) {
        case "Move": {
            const by = moveRows(action.by, extent.viewport);
            return Option.some(clamp(scroll + (action.dir === "next" ? by : -by)));
        }
        case "Jump":
            return Option.some(action.to === "start" ? 0 : last);
        default:
            return Option.none();
    }
};

const editInput = (
    state: KeyState,
    nav: Nav,
    snapshot: Snapshot,
    input: Extract<Shell, { readonly _tag: "Input" }>,
    change: (line: LineEdit) => LineEdit,
): Pick<ShellStep, "state" | "nav"> => {
    const text = activeQuery(nav);
    const line = change({ text, cursor: Math.min(input.cursor, text.length) });
    return {
        state: { ...state, shell: Shell.Input({ ...input, cursor: line.cursor }) },
        nav: typeQuery(nav, line.text, snapshot),
    };
};

export const stepShell = (state: KeyState, context: KeyContext, action: Action): ShellStep => {
    const { shell } = state;
    const { nav, snapshot } = context;
    const step = (next: Partial<ShellStep>): ShellStep => ({
        state,
        nav,
        effects: [],
        ...next,
    });
    const withShell = (next: Shell): KeyState => ({ ...state, shell: next });
    if (!isShellAction(action)) {
        if (shell._tag === "Overlay") {
            return Option.match(scrolled(shell.scroll, action, context.overlay), {
                onNone: () => step({}),
                onSome: (scroll) => step({ state: withShell(Shell.Overlay({ kind: shell.kind, scroll })) }),
            });
        }
        if (shell._tag === "Input") {
            return step({});
        }
        return step(stepScreen(nav, context, action));
    }
    switch (action._tag) {
        case "Quit":
            return step({ effects: [ShellEffect.Quit()] });
        case "Suspend":
            return step({ effects: [ShellEffect.Suspend()] });
        case "OpenHelp":
            return step({ state: withShell(Shell.Overlay({ kind: "help", scroll: 0 })) });
        case "OpenBadLines":
            return snapshot.badLines.malformed + snapshot.badLines.legacy > 0
                ? step({ state: withShell(Shell.Overlay({ kind: "badLines", scroll: 0 })) })
                : step({ effects: [ShellEffect.Say({ text: "no bad lines" })] });
        case "CloseOverlay":
            return step({ state: withShell(Shell.Screen()) });
        case "ClearQuery":
            return step({ nav: clearQuery(nav) });
        case "Back":
            return step({ nav: back(nav) });
        case "OpenQuery": {
            const original = activeQuery(nav);
            return step({
                state: withShell(Shell.Input({ cursor: original.length, original, recall: Option.none() })),
            });
        }
        case "SubmitInput": {
            const text = activeQuery(nav);
            const kept = text.trim() === "" ? "" : text;
            return step({
                state: { shell: Shell.Screen(), history: remember(state.history, kept) },
                nav: submitQuery(setQuery(nav, kept), context),
            });
        }
        case "CancelInput":
            return shell._tag === "Input"
                ? step({ state: withShell(Shell.Screen()), nav: setQuery(nav, shell.original) })
                : step({ state: withShell(Shell.Screen()) });
        case "InsertText":
            return shell._tag === "Input"
                ? step(editInput(state, nav, snapshot, shell, (line) => insert(line, action.text)))
                : step({});
        case "EditInput":
            return shell._tag === "Input"
                ? step(editInput(state, nav, snapshot, shell, (line) => edit(line, action.op)))
                : step({});
        case "RecallQuery": {
            if (shell._tag !== "Input") {
                return step({});
            }
            const recalled = recall(state.history, activeQuery(nav), shell.recall, action.dir);
            return step({
                state: withShell(Shell.Input({ ...shell, cursor: recalled.text.length, recall: recalled.recall })),
                nav: typeQuery(nav, recalled.text, snapshot),
            });
        }
    }
};
