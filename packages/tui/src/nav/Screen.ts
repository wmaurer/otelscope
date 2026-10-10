import { Data, HashSet, Option } from "effect";

import type { RunId, SpanId, TraceId } from "../data/Snapshot.ts";

/** The parent span id (or "" at the top level), then the span name. */
export type GroupKey = `${SpanId}|${string}`;

/** A log by its span and its index in that span's events. */
export type LogCursor = `${SpanId}:${number}`;

export type TraceRow = Data.TaggedEnum<{
    Trace: { readonly traceId: TraceId };
    Heading: { readonly name: string };
    More: { readonly name: string };
}>;
export const TraceRow = Data.taggedEnum<TraceRow>();

export type TreeRow = Data.TaggedEnum<{
    Span: { readonly spanId: SpanId };
    Group: { readonly key: GroupKey };
    Missing: { readonly parentId: SpanId };
}>;
export const TreeRow = Data.taggedEnum<TreeRow>();

export type RunSort = "newest" | "service" | "failures" | "duration";
export type TraceSort = "start" | "duration" | "failures" | "spans";
export type Pane = "tree" | "details" | "logs";
export type LogScope = "span" | "subtree" | "trace";

export interface RunsView {
    /** None while the list follows the newest run. */
    readonly selected: Option.Option<RunId>;
    readonly filter: string;
    readonly sort: RunSort;
    readonly reverse: boolean;
    readonly newerThan: Option.Option<number>;
}

export interface TracesView {
    readonly selected: Option.Option<TraceRow>;
    readonly filter: string;
    readonly sort: TraceSort;
    readonly reverse: boolean;
    /** Root span names. */
    readonly openGroups: HashSet.HashSet<string>;
    readonly newerThan: Option.Option<number>;
}

export interface TraceView {
    /** None until the opening selection is computed. */
    readonly selected: Option.Option<TreeRow>;
    readonly folded: HashSet.HashSet<SpanId>;
    readonly openGroups: HashSet.HashSet<GroupKey>;
    readonly pane: Pane;
    readonly logScope: LogScope;
    readonly search: string;
    readonly logFilter: string;
    readonly logCursor: Option.Option<LogCursor>;
    readonly detailsTop: number;
}

export interface BodyView {
    readonly topLine: number;
    readonly leftCol: number;
    readonly wrap: boolean;
    readonly raw: boolean;
    readonly search: string;
}

export const defaultRunsView: RunsView = {
    selected: Option.none(),
    filter: "",
    sort: "newest",
    reverse: false,
    newerThan: Option.none(),
};

export const defaultTracesView: TracesView = {
    selected: Option.none(),
    filter: "",
    sort: "start",
    reverse: false,
    openGroups: HashSet.empty(),
    newerThan: Option.none(),
};

export const defaultTraceView: TraceView = {
    selected: Option.none(),
    folded: HashSet.empty(),
    openGroups: HashSet.empty(),
    pane: "tree",
    logScope: "subtree",
    search: "",
    logFilter: "",
    logCursor: Option.none(),
    detailsTop: 0,
};

export const defaultBodyView: BodyView = { topLine: 0, leftCol: 0, wrap: true, raw: false, search: "" };

export type Screen = Data.TaggedEnum<{
    Runs: { readonly view: RunsView };
    Traces: { readonly runId: RunId; readonly idIsPrefix: boolean; readonly view: TracesView };
    Trace: {
        readonly traceId: TraceId;
        readonly idIsPrefix: boolean;
        /** Which run's list the trace was opened from. */
        readonly viaRun: Option.Option<RunId>;
        readonly view: TraceView;
    };
    Body: { readonly traceId: TraceId; readonly spanId: SpanId; readonly prefix: string; readonly view: BodyView };
}>;
export const Screen = Data.taggedEnum<Screen>();

export type ScreenTag = Screen["_tag"];
export type ScreenOf<T extends ScreenTag> = Extract<Screen, { readonly _tag: T }>;
interface Views {
    readonly Runs: RunsView;
    readonly Traces: TracesView;
    readonly Trace: TraceView;
    readonly Body: BodyView;
}
export type ViewOf<T extends ScreenTag> = Views[T];
export type RunsScreen = ScreenOf<"Runs">;

export const tracesFor = (runId: RunId, runs: RunsView): ScreenOf<"Traces"> =>
    Screen.Traces({ runId, idIsPrefix: false, view: { ...defaultTracesView, filter: runs.filter } });

export interface Opening {
    readonly selected: TreeRow;
    readonly openGroups: HashSet.HashSet<GroupKey>;
}

/** Traces ⏎. The Traces filter seeds the tree search once; `opening` is None when the trace is not loaded yet. */
export const traceFor = (
    traceId: TraceId,
    viaRun: Option.Option<RunId>,
    traces: TracesView,
    opening: Option.Option<Opening>,
): ScreenOf<"Trace"> =>
    Screen.Trace({
        traceId,
        idIsPrefix: false,
        viaRun,
        view: {
            ...defaultTraceView,
            selected: Option.map(opening, (o) => o.selected),
            openGroups: Option.match(opening, { onNone: HashSet.empty<GroupKey>, onSome: (o) => o.openGroups }),
            search: traces.filter,
        },
    });

export const bodyFor = (traceId: TraceId, spanId: SpanId, prefix: string): ScreenOf<"Body"> =>
    Screen.Body({ traceId, spanId, prefix, view: defaultBodyView });
