import { Data } from "effect";

import type { Snapshot } from "../data/Snapshot.ts";
import type { EditTarget } from "../editor.ts";
import type { Panes } from "../model/panes.ts";
import type { ScreenList } from "../model/screenList.ts";
import type { TraceLayout } from "../model/traceLayout.ts";
import type { TraceModel } from "../model/traceModel.ts";
import type { Nav } from "./Nav.ts";
import type { Option } from "effect";

/** What a key does besides changing the Nav. The app shell applies each one; the steps only return them. */
export type ShellEffect = Data.TaggedEnum<{
    Quit: {};
    Suspend: {};
    Say: { readonly text: string };
    SetPanes: { readonly panes: Panes };
    Edit: { readonly target: EditTarget };
}>;
export const ShellEffect = Data.taggedEnum<ShellEffect>();

/** What the Trace screen's keys read: the same model, panes and layout its frame draws. */
export interface TraceContext {
    readonly model: TraceModel;
    readonly panes: Panes;
    readonly layout: TraceLayout;
    /** Rows in the details pane's content, for clamping its scroll. */
    readonly detailsLines: number;
}

export interface StepContext {
    readonly snapshot: Snapshot;
    readonly list: ScreenList;
    readonly listRows: number;
    /** Some on a Trace screen whose trace is present. */
    readonly trace: Option.Option<TraceContext>;
}

export interface ScreenStep {
    readonly nav: Nav;
    readonly effects: ReadonlyArray<ShellEffect>;
}

export const stepTo = (nav: Nav): ScreenStep => ({ nav, effects: [] });

export const said = (nav: Nav, text: string): ScreenStep => ({ nav, effects: [ShellEffect.Say({ text })] });
