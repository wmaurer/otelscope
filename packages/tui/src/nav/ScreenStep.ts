import { Data } from "effect";

import type { Snapshot } from "../data/Snapshot.ts";
import type { EditTarget } from "../editor.ts";
import type { Panes } from "../model/panes.ts";
import type { ScreenList } from "../model/screenList.ts";
import type { Nav } from "./Nav.ts";

/** What a key does besides changing the Nav. The app shell applies each one; the steps only return them. */
export type ShellEffect = Data.TaggedEnum<{
    Quit: {};
    Suspend: {};
    Say: { readonly text: string };
    SetPanes: { readonly panes: Panes };
    Edit: { readonly target: EditTarget };
}>;
export const ShellEffect = Data.taggedEnum<ShellEffect>();

export interface StepContext {
    readonly snapshot: Snapshot;
    readonly list: ScreenList;
    readonly listRows: number;
}

export interface ScreenStep {
    readonly nav: Nav;
    readonly effects: ReadonlyArray<ShellEffect>;
}

export const stepTo = (nav: Nav): ScreenStep => ({ nav, effects: [] });

export const said = (nav: Nav, text: string): ScreenStep => ({ nav, effects: [ShellEffect.Say({ text })] });
