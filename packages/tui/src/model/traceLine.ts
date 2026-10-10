import { Array as Arr, Option, Order, Record } from "effect";

import { ranges, shift } from "../query/Highlight.ts";
import { count, duration, offset } from "./format.ts";
import { traceMark } from "./marks.ts";
import { cell, countText, layout, row } from "./table.ts";

import type { Run, Trace } from "../data/Snapshot.ts";
import type { TraceSort } from "../nav/Screen.ts";
import type { Query } from "../query/Query.ts";
import type { TraceState } from "./marks.ts";
import type { Line, Role } from "./Role.ts";
import type { Column, Placed } from "./table.ts";
import type { Group, Item, TraceListRow } from "./traceList.ts";

const MORE_ORDER: ReadonlyArray<TraceState> = ["failed", "interrupted", "running", "recovered", "partial", "ok"];

export const moreText = (hidden: ReadonlyArray<Item>): string => {
    const counts = Arr.getSomes(
        Arr.map(MORE_ORDER, (state) => {
            const n = Arr.reduce(hidden, 0, (sum, item) => (item.state === state ? sum + 1 : sum));
            return n === 0 ? Option.none() : Option.some(`${count(n)} ${state}`);
        }),
    );
    return `⋯ ${Arr.join(
        Arr.map(counts, (part, i) => (i === 0 ? part.replace(" ", " more ") : part)),
        " · ",
    )}`;
};

interface HeadingStats {
    readonly firstStartMs: number;
    readonly p50Ms: number;
    readonly spans: number;
    readonly failedTraces: number;
    readonly logs: number;
    readonly error: string;
}

const statsCache = new WeakMap<Group, HeadingStats>();

const commonError = (members: ReadonlyArray<Item>): string => {
    const errors = Arr.getSomes(Arr.map(members, (item) => item.trace.firstError));
    const byType = Arr.groupBy(errors, (error) => error.type);
    const top = Arr.reduce(Record.toEntries(byType), Option.none<readonly [string, number]>(), (best, [type, list]) =>
        Option.exists(best, ([, n]) => n >= list.length) ? best : Option.some([type, list.length] as const),
    );
    return Option.match(top, {
        onNone: () => "",
        onSome: ([type, n]) => {
            const others = errors.length - n;
            return others === 0
                ? `${count(n)}× ${type}`
                : `${count(n)}× ${type} · ${count(others)} other error${others === 1 ? "" : "s"}`;
        },
    });
};

export const headingStats = (group: Group): HeadingStats => {
    const cached = statsCache.get(group);
    if (cached !== undefined) {
        return cached;
    }
    const durations = Arr.sort(
        Arr.map(group.members, (item) => item.trace.endMs - item.trace.startMs),
        Order.Number,
    );
    const stats: HeadingStats = {
        firstStartMs: group.members[0]?.trace.startMs ?? 0,
        p50Ms: durations[Math.floor((durations.length - 1) / 2)] ?? 0,
        spans: Arr.reduce(group.members, 0, (sum, item) => sum + item.trace.spanCount),
        failedTraces: Arr.reduce(group.members, 0, (sum, item) => (item.state === "failed" ? sum + 1 : sum)),
        logs: Arr.reduce(group.members, 0, (sum, item) => sum + item.trace.logs),
        error: commonError(group.members),
    };
    statsCache.set(group, stats);
    return stats;
};

type TraceColumn = "marks" | "root" | "started" | "duration" | "spans" | "failed" | "logs" | "error";

const TRACE_COLUMNS: ReadonlyArray<Column<TraceColumn>> = [
    { id: "marks", title: "", align: "left", width: { fixed: 2 } },
    { id: "root", title: "root span", align: "left", width: { flex: 3, min: 24 } },
    { id: "started", title: "started", align: "right", width: { fixed: 9 } },
    { id: "duration", title: "duration", align: "right", width: { fixed: 9 } },
    { id: "spans", title: "spans", align: "right", width: { fixed: 7 } },
    { id: "failed", title: "failed", align: "right", width: { fixed: 7 } },
    { id: "logs", title: "logs", align: "right", width: { fixed: 6 } },
    { id: "error", title: "error", align: "left", width: { flex: 2, min: 16 } },
];

const TRACE_DROP_ORDER: ReadonlyArray<TraceColumn> = ["logs", "spans"];

export const traceSortColumn = {
    start: "started",
    duration: "duration",
    failures: "failed",
    spans: "spans",
} satisfies Readonly<Record<TraceSort, TraceColumn>>;

export const traceLayout = (width: number): ReadonlyArray<Placed<TraceColumn>> =>
    layout(TRACE_COLUMNS, width, TRACE_DROP_ORDER);

interface TraceLineContext {
    readonly placed: ReadonlyArray<Placed<TraceColumn>>;
    readonly run: Run;
    readonly query: Query;
    readonly filtered: boolean;
    readonly width: number;
}

const errorText = (trace: Trace): string =>
    Option.match(trace.firstError, {
        onNone: () => "",
        onSome: ({ type, message }) => (message === "" ? type : `${type}: ${message}`),
    });

const failureRole = (failed: boolean): Role => (failed ? "failure" : "failurePropagated");

const traceCell = (item: Item, member: boolean, column: Placed<TraceColumn>, context: TraceLineContext): Line => {
    const { trace, state } = item;
    const { width, align } = column;
    switch (column.id) {
        case "marks":
            return [traceMark(state), { text: " ", role: "text" }];
        case "root": {
            const indent = member ? "  " : "";
            const highlights = shift(ranges(context.query, trace.headName), indent.length);
            return state === "partial"
                ? cell(`${indent}${trace.headName} (partial)`, width, align, "muted", highlights)
                : cell(`${indent}${trace.headName}`, width, align, "text", highlights);
        }
        case "started":
            return cell(offset(trace.startMs - context.run.firstStartMs), width, align, "text");
        case "duration":
            return cell(duration(trace.endMs - trace.startMs, state === "running"), width, align, "text");
        case "spans":
            return cell(countText(trace.spanCount), width, align, "text");
        case "failed":
            return cell(countText(trace.failedSpans), width, align, failureRole(state === "failed"));
        case "logs":
            return cell(countText(trace.logs), width, align, "text");
        case "error": {
            const text = errorText(trace);
            return cell(text, width, align, failureRole(state === "failed"), ranges(context.query, text));
        }
    }
};

const headingCell = (group: Group, column: Placed<TraceColumn>, context: TraceLineContext): Line => {
    const stats = headingStats(group);
    const { width, align } = column;
    switch (column.id) {
        case "marks":
            return cell("", width, align, "text");
        case "root": {
            const prefix = `${group.open ? "▾" : "▸"} `;
            const of = context.filtered ? ` (of ${count(group.all)})` : "";
            return cell(
                `${prefix}${group.name} ×${count(group.members.length)}${of}`,
                width,
                align,
                "text",
                shift(ranges(context.query, group.name), prefix.length),
            );
        }
        case "started":
            return cell(offset(stats.firstStartMs - context.run.firstStartMs), width, align, "text");
        case "duration":
            return cell(duration(stats.p50Ms), width, align, "text");
        case "spans":
            return cell(countText(stats.spans), width, align, "text");
        case "failed":
            return cell(countText(stats.failedTraces), width, align, "failure");
        case "logs":
            return cell(countText(stats.logs), width, align, "text");
        case "error":
            return cell(
                stats.error,
                width,
                align,
                failureRole(stats.failedTraces > 0),
                ranges(context.query, stats.error),
            );
    }
};

export const traceLine = (listRow: TraceListRow, context: TraceLineContext, selected: boolean): Line => {
    switch (listRow._tag) {
        case "Trace":
            return row(
                Arr.map(context.placed, (column) => traceCell(listRow.item, listRow.member, column, context)),
                context.width,
                selected,
            );
        case "Heading":
            return row(
                Arr.map(context.placed, (column) => headingCell(listRow.group, column, context)),
                context.width,
                selected,
            );
        case "More": {
            const [marks, ...rest] = context.placed;
            const span = Arr.reduce(rest, 0, (sum, column) => sum + column.width + 1) - 1;
            return row(
                [
                    cell("", marks?.width ?? 0, "left", "text"),
                    cell(`  ${moreText(listRow.group.hidden)}`, span, "left", "muted"),
                ],
                context.width,
                selected,
            );
        }
    }
};
