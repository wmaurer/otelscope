import { Data, Option } from "effect";

import { back } from "../nav/Nav.ts";
import { clearQuery } from "../nav/Query.ts";
import { isShellAction } from "./Action.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Nav } from "../nav/Nav.ts";
import type { Action, ScreenAction } from "./Action.ts";
import type { Mode } from "./Bindings.ts";

export type Shell = Data.TaggedEnum<{
    Screen: {};
    Overlay: { readonly kind: "help" | "badLines"; readonly scroll: number };
    Input: {};
}>;
export const Shell = Data.taggedEnum<Shell>();

export const initialShell: Shell = Shell.Screen();

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

export type ShellEffect = Data.TaggedEnum<{
    Quit: {};
    Suspend: {};
    Say: { readonly text: string };
}>;
export const ShellEffect = Data.taggedEnum<ShellEffect>();

export interface ShellStep {
    readonly shell: Shell;
    /** The same Nav when the action did not change it. */
    readonly nav: Nav;
    readonly effects: ReadonlyArray<ShellEffect>;
    readonly forward: Option.Option<ScreenAction>;
}

const scrolled = (scroll: number, action: ScreenAction, extent: Extent): Option.Option<number> => {
    const last = Math.max(0, extent.total - extent.viewport);
    const clamp = (n: number) => Math.min(last, Math.max(0, n));
    switch (action._tag) {
        case "Move": {
            const by = {
                row: 1,
                halfPage: Math.max(1, Math.floor(extent.viewport / 2)),
                page: Math.max(1, extent.viewport),
            }[action.by];
            return Option.some(clamp(scroll + (action.dir === "next" ? by : -by)));
        }
        case "Jump":
            return Option.some(action.to === "start" ? 0 : last);
        default:
            return Option.none();
    }
};

export const stepShell = (shell: Shell, nav: Nav, snapshot: Snapshot, extent: Extent, action: Action): ShellStep => {
    const step = (next: Partial<ShellStep>): ShellStep => ({
        shell,
        nav,
        effects: [],
        forward: Option.none(),
        ...next,
    });
    if (!isShellAction(action)) {
        if (shell._tag === "Overlay") {
            return Option.match(scrolled(shell.scroll, action, extent), {
                onNone: () => step({}),
                onSome: (scroll) => step({ shell: Shell.Overlay({ kind: shell.kind, scroll }) }),
            });
        }
        return step({ forward: Option.some(action) });
    }
    switch (action._tag) {
        case "Quit":
            return step({ effects: [ShellEffect.Quit()] });
        case "Suspend":
            return step({ effects: [ShellEffect.Suspend()] });
        case "OpenHelp":
            return step({ shell: Shell.Overlay({ kind: "help", scroll: 0 }) });
        case "OpenBadLines":
            return snapshot.badLines.malformed + snapshot.badLines.legacy > 0
                ? step({ shell: Shell.Overlay({ kind: "badLines", scroll: 0 }) })
                : step({ effects: [ShellEffect.Say({ text: "no bad lines" })] });
        case "CloseOverlay":
        case "SubmitInput":
        case "CancelInput":
            return step({ shell: Shell.Screen() });
        case "ClearQuery":
            return step({ nav: clearQuery(nav) });
        case "Back":
            return step({ nav: back(nav) });
        case "OpenQuery":
            // The search input is not built yet, so `/` changes nothing for now.
            return step({});
    }
};
