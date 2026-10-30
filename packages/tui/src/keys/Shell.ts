import { Data, Match, Option, Predicate } from "effect";

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
    return Match.value(action).pipe(
        Match.tags({
            Move: ({ by, dir }) => {
                const rows = moveRows(by, extent.viewport);
                return Option.some(clamp(scroll + (dir === "next" ? rows : -rows)));
            },
            Jump: ({ to }) => Option.some(to === "start" ? 0 : last),
        }),
        Match.orElse(() => Option.none()),
    );
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
        if (Predicate.isTagged(shell, "Overlay")) {
            return Option.match(scrolled(shell.scroll, action, context.overlay), {
                onNone: () => step({}),
                onSome: (scroll) => step({ state: withShell(Shell.Overlay({ kind: shell.kind, scroll })) }),
            });
        }
        if (Predicate.isTagged(shell, "Input")) {
            return step({});
        }
        return step(stepScreen(nav, context, action));
    }
    return Match.valueTags(action, {
        Quit: () => step({ effects: [ShellEffect.Quit()] }),
        Suspend: () => step({ effects: [ShellEffect.Suspend()] }),
        OpenHelp: () => step({ state: withShell(Shell.Overlay({ kind: "help", scroll: 0 })) }),
        OpenBadLines: () =>
            snapshot.badLines.malformed + snapshot.badLines.legacy > 0
                ? step({ state: withShell(Shell.Overlay({ kind: "badLines", scroll: 0 })) })
                : step({ effects: [ShellEffect.Say({ text: "no bad lines" })] }),
        CloseOverlay: () => step({ state: withShell(Shell.Screen()) }),
        ClearQuery: () => step({ nav: clearQuery(nav) }),
        Back: () => step({ nav: back(nav) }),
        OpenQuery: () => {
            const original = activeQuery(nav);
            return step({
                state: withShell(Shell.Input({ cursor: original.length, original, recall: Option.none() })),
            });
        },
        SubmitInput: () => {
            const text = activeQuery(nav);
            const kept = text.trim() === "" ? "" : text;
            return step({
                state: { shell: Shell.Screen(), history: remember(state.history, kept) },
                nav: submitQuery(setQuery(nav, kept), context),
            });
        },
        CancelInput: () =>
            Predicate.isTagged(shell, "Input")
                ? step({ state: withShell(Shell.Screen()), nav: setQuery(nav, shell.original) })
                : step({ state: withShell(Shell.Screen()) }),
        InsertText: ({ text }) =>
            Predicate.isTagged(shell, "Input")
                ? step(editInput(state, nav, snapshot, shell, (line) => insert(line, text)))
                : step({}),
        EditInput: ({ op }) =>
            Predicate.isTagged(shell, "Input")
                ? step(editInput(state, nav, snapshot, shell, (line) => edit(line, op)))
                : step({}),
        RecallQuery: ({ dir }) => {
            if (!Predicate.isTagged(shell, "Input")) {
                return step({});
            }
            const recalled = recall(state.history, activeQuery(nav), shell.recall, dir);
            return step({
                state: withShell(Shell.Input({ ...shell, cursor: recalled.text.length, recall: recalled.recall })),
                nav: typeQuery(nav, recalled.text, snapshot),
            });
        },
    });
};
