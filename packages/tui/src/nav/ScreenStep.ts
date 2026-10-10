import { Data } from "effect";

import type { Snapshot } from "../data/Snapshot.ts";
import type { EditTarget } from "../editor.ts";
import type { BodyModel } from "../model/bodyModel.ts";
import type { BodyRows } from "../model/bodyRows.ts";
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
    /** `done` is what the status line says when the terminal accepts the copy. */
    Copy: { readonly text: string; readonly done: string };
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

/** What the Body screen's keys read: the same rows and viewport its frame draws. */
export interface BodyContext {
    readonly model: BodyModel;
    readonly rows: BodyRows;
    readonly viewport: number;
    readonly width: number;
}

export interface StepContext {
    readonly snapshot: Snapshot;
    readonly list: ScreenList;
    readonly listRows: number;
    /** Some on a Trace screen whose trace is present. */
    readonly trace: Option.Option<TraceContext>;
    /** Some on a Body screen whose body is on its span. */
    readonly body: Option.Option<BodyContext>;
}

export interface ScreenStep {
    readonly nav: Nav;
    readonly effects: ReadonlyArray<ShellEffect>;
}

export const stepTo = (nav: Nav): ScreenStep => ({ nav, effects: [] });

export const said = (nav: Nav, text: string): ScreenStep => ({ nav, effects: [ShellEffect.Say({ text })] });
