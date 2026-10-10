import { Array as Arr, Option } from "effect";

import { detailsOf } from "./details.ts";
import { count, duration, plural, runLabel, shortId } from "./format.ts";
import { causeLine, cursorEntry, logCount, logLine, logsTitle } from "./logs.ts";
import { isLive } from "./marks.ts";
import { chunk, underlay } from "./Role.ts";
import { cutLine } from "./text.ts";
import { traceLayout } from "./traceLayout.ts";
import { hitOf, leftWidth, treeLeft } from "./treeLine.ts";
import { matchText } from "./treeSearch.ts";
import { axisSegments, Bar, barSegments, markersOf, scaleOf, startCell } from "./waterfall.ts";

import type { SpanId, Snapshot, Trace } from "../data/Snapshot.ts";
import type { Pane, TraceView } from "../nav/Screen.ts";
import type { TraceContext } from "../nav/ScreenStep.ts";
import type { DetailRow } from "./details.ts";
import type { Panes } from "./panes.ts";
import type { Line } from "./Role.ts";
import type { TraceLayout } from "./traceLayout.ts";
import type { TraceModel } from "./traceModel.ts";
import type { TreeEntry } from "./tree.ts";
import type { SpanKind, TreeFacts } from "./treeFacts.ts";
import type { Scale, Segment, Tone } from "./waterfall.ts";
import type { AsyncResult } from "effect/reactivity";

const CAUSE_SUFFIX = "#cause";

export type BodyStats = ReadonlyMap<string, AsyncResult.AsyncResult<Option.Option<number>>>;

export interface TraceEnv {
    readonly size: { readonly width: number; readonly height: number };
    readonly panes: Panes;
    readonly now: number;
    readonly snapshot: Snapshot;
    readonly bodyStats: BodyStats;
}

export interface TreePaneFrame {
    readonly title: string;
    /** The axis row: blank over the left part, then the ticks over the bar column. */
    readonly axis: ReadonlyArray<Segment>;
    readonly size: number;
    readonly selected: number;
    readonly keyAt: (index: number) => string;
    readonly left: (index: number, selected: boolean) => Line;
    readonly bar: (index: number) => ReadonlyArray<Segment>;
    /** What a click `column` cells from the row's left hits. */
    readonly hit: (key: string, column: number) => "mark" | "row";
}

export interface DetailsPaneFrame {
    readonly title: string;
    readonly rows: ReadonlyArray<DetailRow>;
    /** `detailsTop`, clamped to the content. */
    readonly top: number;
}

export interface LogsPaneFrame {
    readonly title: string;
    readonly size: number;
    readonly selected: number;
    readonly keyAt: (index: number) => string;
    readonly line: (index: number, selected: boolean) => Line;
    /** The log a row's key belongs to: a cause line belongs to the log above it. */
    readonly logOf: (key: string) => string;
}

export interface TraceFrame {
    readonly layout: TraceLayout;
    readonly focus: Pane;
    readonly header: Line;
    readonly tree: TreePaneFrame;
    readonly details: DetailsPaneFrame;
    readonly logs: LogsPaneFrame;
    /** The status bar's left text while the focused pane has a query: `/ payment · match 3/17`. */
    readonly query: Option.Option<string>;
    /** The input bar's right text. */
    readonly count: string;
}

const tones = {
    origin: "origin",
    propagated: "propagated",
    interrupted: "interrupted",
    ok: "success",
} satisfies Readonly<Record<SpanKind, Tone>>;

/** Running: following the file, the last record of the trace arrived in the last 5 s, and no root yet. */
const runningOf = (trace: Trace, env: TraceEnv): boolean =>
    Option.isNone(trace.root) && isLive(trace.lastArrivalAt, env.snapshot.status.phase, env.now);

const exitPart = (trace: Trace, running: boolean): Line =>
    Option.match(trace.rootExit, {
        onNone: () => [running ? chunk("running", "accent") : chunk("partial", "muted")],
        onSome: (exit) => {
            switch (exit) {
                case "Failure":
                    return [chunk("✗ Failure", "failure")];
                case "Interrupted":
                    return [chunk("⊘ Interrupted", "interrupted")];
                case "Success":
                    return [chunk("Success", "muted")];
            }
        },
    });

/** `POST /orders  5643b831  ✗ Failure  1.24s  84 spans · 3 failed · 23 logs`, and the runs when there are several. */
const headerLine = (trace: Trace, env: TraceEnv, running: boolean): Line => {
    const gap = chunk("  ", "text");
    const runs = Arr.getSomes(Arr.map(trace.runs, (id) => Option.fromUndefinedOr(env.snapshot.runs.get(id))));
    return cutLine(
        [
            chunk(trace.headName, "text", true),
            gap,
            chunk(shortId(trace.id), "muted"),
            gap,
            ...exitPart(trace, running),
            gap,
            chunk(duration(trace.endMs - trace.startMs, running), "text"),
            gap,
            chunk(`${plural(trace.spanCount, "span")} · `, "muted"),
            chunk(`${count(trace.failedSpans)} failed`, trace.failedSpans > 0 ? "failure" : "muted"),
            chunk(` · ${plural(trace.logs, "log")}`, "muted"),
            ...(runs.length > 1
                ? [
                      gap,
                      chunk(
                          `runs: ${Arr.join(
                              Arr.map(runs, (run) => runLabel(run, env.now)),
                              ", ",
                          )}`,
                          "muted",
                      ),
                  ]
                : []),
        ],
        env.size.width,
    );
};

/** Each span's bar start cell after its ancestors' floors, memoized for one frame. */
const startCells = (facts: TreeFacts, scale: Scale): ((spanId: SpanId | null) => number) => {
    // oxlint-disable-next-line effect-native/imperative-collection-build -- a memo for one frame: filling it is the design.
    const known = new Map<SpanId, number>();
    return (spanId) => {
        if (spanId === null) {
            return 0;
        }
        const lineage = facts.lineage(spanId);
        let floor = 0;
        for (let i = lineage.length - 1; i >= 0; i--) {
            const id = lineage[i] ?? "";
            const cached = known.get(id);
            if (cached !== undefined) {
                floor = cached;
                continue;
            }
            const span = facts.trace.spans.get(id);
            floor = span === undefined ? floor : Math.max(floor, startCell(scale, span.startMs));
            known.set(id, floor);
        }
        return floor;
    };
};

const barOf = (entry: TreeEntry, facts: TreeFacts): Bar => {
    switch (entry._tag) {
        case "Span": {
            const span = facts.trace.spans.get(entry.spanId);
            return span === undefined
                ? Bar.None()
                : Bar.Span({
                      startMs: span.startMs,
                      ms: span.ms,
                      tone: tones[facts.kind(entry.spanId)],
                      markers: markersOf(span),
                  });
        }
        case "Group":
            return Bar.Envelope({ startMs: entry.group.startMs, endMs: entry.group.endMs });
        case "Missing":
            return Bar.None();
    }
};

const parentOf = (entry: TreeEntry, facts: TreeFacts): SpanId | null => {
    switch (entry._tag) {
        case "Span":
            return facts.trace.spans.get(entry.spanId)?.parent ?? null;
        case "Group":
            return entry.group.parent;
        case "Missing":
            return null;
    }
};

interface DetailsMemo {
    readonly facts: TreeFacts;
    readonly key: string;
    readonly width: number;
    readonly bodyStats: BodyStats;
    readonly snapshot: Snapshot;
    readonly rows: ReadonlyArray<DetailRow>;
}

let detailsMemo: DetailsMemo | undefined;

/** The details rows, rebuilt only when the row, the width, the body stats or the snapshot changed. */
const detailRows = (model: TraceModel, width: number, env: TraceEnv): ReadonlyArray<DetailRow> =>
    Option.match(model.entry, {
        onNone: () => [],
        onSome: (entry) => {
            const memo = detailsMemo;
            if (
                memo !== undefined &&
                memo.facts === model.facts &&
                memo.key === entry.key &&
                memo.width === width &&
                memo.bodyStats === env.bodyStats &&
                memo.snapshot === env.snapshot
            ) {
                return memo.rows;
            }
            const rows = detailsOf(entry, {
                facts: model.facts,
                snapshot: env.snapshot,
                now: env.now,
                bodyStats: env.bodyStats,
                width,
            });
            detailsMemo = {
                facts: model.facts,
                key: entry.key,
                width,
                bodyStats: env.bodyStats,
                snapshot: env.snapshot,
                rows,
            };
            return rows;
        },
    });

export const traceFrame = (model: TraceModel, view: TraceView, env: TraceEnv): TraceFrame => {
    const { facts, tree, logs, search } = model;
    const { trace } = facts;
    const layout = traceLayout(env.size, env.panes);
    const running = runningOf(trace, env);
    const scale = scaleOf(trace.startMs, trace.endMs, running, layout.barWidth);
    const floors = startCells(facts, scale);
    const lineEnv = { facts, search, nameColumn: layout.nameColumn };
    const leftCells = leftWidth(layout.nameColumn);
    const details = detailRows(model, layout.detailsWidth, env);
    const cursor = cursorEntry(logs, facts, view.logCursor);
    const matches = matchText(search, facts, model.entry);
    const onLogs = view.pane === "logs";
    const rowAt = (index: number) => logs.rows[index];
    return {
        layout,
        focus: view.pane,
        header: headerLine(trace, env, running),
        tree: {
            title: "1 Tree",
            axis: Arr.map(axisSegments(scale), (segment) => ({ ...segment, x: segment.x + leftCells })),
            size: tree.rows.length,
            selected: model.index,
            keyAt: (index) => tree.rows[index]?.key ?? "",
            left: (index, selected) => {
                const entry = tree.rows[index];
                return entry === undefined ? [] : treeLeft(entry, lineEnv, selected);
            },
            bar: (index) => {
                const entry = tree.rows[index];
                if (entry === undefined) {
                    return [];
                }
                const bar = barOf(entry, facts);
                return barSegments(scale, bar, floors(parentOf(entry, facts)));
            },
            hit: (key, column) => {
                const entry = tree.rows[tree.indexOf(key)];
                return entry === undefined ? "row" : hitOf(entry, column);
            },
        },
        details: {
            title: "2 Details",
            rows: details,
            top: Math.max(0, Math.min(view.detailsTop, details.length - layout.detailsRows)),
        },
        logs: {
            title: logsTitle(logs),
            size: logs.rows.length,
            selected: logs.entryRow[cursor] ?? -1,
            keyAt: (index) => rowAt(index)?.key ?? "",
            line: (index, selected) => {
                const row = rowAt(index);
                if (row === undefined) {
                    return [];
                }
                const line =
                    row._tag === "Entry"
                        ? logLine(row.entry, logs.query, trace.startMs, layout.logsWidth)
                        : causeLine(row.entry, layout.logsWidth);
                return selected || (row._tag === "Cause" && logs.entryRow[cursor] === index - 1)
                    ? underlay(line, "selectionBg")
                    : line;
            },
            logOf: (key) => (key.endsWith(CAUSE_SUFFIX) ? key.slice(0, -CAUSE_SUFFIX.length) : key),
        },
        query: onLogs
            ? view.logFilter === ""
                ? Option.none()
                : Option.some(`/ ${view.logFilter} · ${logCount(logs)}`)
            : Option.map(matches, (text) => `/ ${view.search} · ${text}`),
        count: onLogs ? logCount(logs) : Option.getOrElse(matches, () => ""),
    };
};

/** What the Trace keys need from the frame: the same model and layout the screen draws. */
export const traceContext = (model: TraceModel, env: TraceEnv): TraceContext => {
    const layout = traceLayout(env.size, env.panes);
    return {
        model,
        panes: env.panes,
        layout,
        detailsLines: detailRows(model, layout.detailsWidth, env).length,
    };
};
