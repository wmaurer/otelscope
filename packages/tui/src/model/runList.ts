import { Array as Arr, Option, Order } from "effect";

import { ranges } from "../query/Highlight.ts";
import { runMatches } from "../query/Match.ts";
import { parse } from "../query/Query.ts";
import { duration, serviceName, started } from "./format.ts";
import { indexer } from "./list.ts";
import { isLive, isProblemRun, runMarks } from "./marks.ts";
import { cell, countText, layout, row } from "./table.ts";

import type { Phase, Run, RunId, Snapshot } from "../data/Snapshot.ts";
import type { RunSort, RunsView } from "../nav/Screen.ts";
import type { Query } from "../query/Query.ts";
import type { List } from "./list.ts";
import type { Line } from "./Role.ts";
import type { Column, Placed } from "./table.ts";

interface RunRow {
    readonly key: RunId;
    readonly run: Run;
}

export type RunList = List<RunRow, RunId>;

const orders = {
    service: Order.mapInput(Order.String, (run: Run) => run.service),
    failures: Order.combine(
        Order.flip(Order.mapInput(Order.Number, (run: Run) => run.failedTraces)),
        Order.flip(Order.mapInput(Order.Number, (run: Run) => run.failedSpans)),
    ),
    duration: Order.flip(Order.mapInput(Order.Number, (run: Run) => run.lastEndMs - run.firstStartMs)),
} satisfies Readonly<Record<Exclude<RunSort, "newest">, Order.Order<Run>>>;

export const runList = (snapshot: Snapshot, view: Pick<RunsView, "sort" | "reverse">, filter: string): RunList => {
    const query = parse(filter);
    const all = Arr.getSomes(Arr.map(snapshot.runOrder, (id) => Option.fromUndefinedOr(snapshot.runs.get(id))));
    const matching = query.length === 0 ? all : Arr.filter(all, (run) => runMatches(query, run, snapshot.traces));
    const newestFirst = Arr.reverse(matching);
    const sorted = view.sort === "newest" ? newestFirst : Arr.sort(newestFirst, orders[view.sort]);
    const ordered = view.reverse ? Arr.reverse(sorted) : sorted;
    const rows = Arr.map(ordered, (run) => ({ key: run.id, run }));
    return {
        rows,
        selectionOf: (r) => r.run.id,
        keyOf: (id) => id,
        indexOf: indexer(rows),
        stops: Arr.getSomes(Arr.map(rows, (r, i) => (isProblemRun(r.run) ? Option.some(i) : Option.none()))),
        followIndex: rows.length === 0 ? -1 : view.reverse ? rows.length - 1 : 0,
        timeSort: view.sort === "newest",
        newestEnd: view.reverse ? "end" : "start",
        starts: Arr.map(matching, (run) => run.firstStartMs),
        filter,
        query,
        matched: matching.length,
        total: all.length,
    };
};

type RunColumn = "marks" | "service" | "started" | "duration" | "traces" | "failed" | "spans" | "logs" | "run";

export const RUN_COLUMNS: ReadonlyArray<Column<RunColumn>> = [
    { id: "marks", title: "", align: "left", width: { fixed: 2 } },
    { id: "service", title: "service", align: "left", width: { flex: 1, min: 14 } },
    { id: "started", title: "started", align: "left", width: { fixed: 16 } },
    { id: "duration", title: "duration", align: "right", width: { fixed: 9 } },
    { id: "traces", title: "traces", align: "right", width: { fixed: 7 } },
    { id: "failed", title: "failed", align: "right", width: { fixed: 7 } },
    { id: "spans", title: "spans", align: "right", width: { fixed: 8 } },
    { id: "logs", title: "logs", align: "right", width: { fixed: 7 } },
    { id: "run", title: "run", align: "left", width: { fixed: 28 } },
];

export const RUN_DROP_ORDER: ReadonlyArray<RunColumn> = ["run", "logs", "spans"];

export const runSortColumn = {
    newest: "started",
    service: "service",
    failures: "failed",
    duration: "duration",
} satisfies Readonly<Record<RunSort, RunColumn>>;

export const runLayout = (width: number): ReadonlyArray<Placed<RunColumn>> =>
    layout(RUN_COLUMNS, width, RUN_DROP_ORDER);

interface RunLineContext {
    readonly placed: ReadonlyArray<Placed<RunColumn>>;
    readonly phase: Phase;
    readonly now: number;
    readonly query: Query;
    readonly width: number;
}

const runCell = (run: Run, column: Placed<RunColumn>, context: RunLineContext, live: boolean): Line => {
    const { width, align } = column;
    switch (column.id) {
        case "marks":
            return runMarks(run, live);
        case "service":
            return run.service === ""
                ? cell(serviceName(run.service), width, align, "muted")
                : cell(run.service, width, align, "text", ranges(context.query, run.service));
        case "started":
            return cell(started(run.firstStartMs, context.now), width, align, "text");
        case "duration":
            return cell(duration(run.lastEndMs - run.firstStartMs, live), width, align, "text");
        case "traces":
            return cell(countText(run.traceIds.length), width, align, "text");
        case "failed":
            return run.failedTraces > 0
                ? cell(countText(run.failedTraces), width, align, "failure")
                : cell(run.failedSpans > 0 ? `(${countText(run.failedSpans)})` : "", width, align, "failurePropagated");
        case "spans":
            return cell(countText(run.spanCount), width, align, "text");
        case "logs":
            return cell(countText(run.logs), width, align, "text");
        case "run":
            return cell(run.id, width, align, "muted");
    }
};

export const runLine = (run: Run, context: RunLineContext, selected: boolean): Line => {
    const live = isLive(run.lastArrivalAt, context.phase, context.now);
    return row(
        Arr.map(context.placed, (column) => runCell(run, column, context, live)),
        context.width,
        selected,
    );
};
