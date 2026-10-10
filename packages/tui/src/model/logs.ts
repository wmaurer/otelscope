import { Array as Arr, Data, Option, Order, pipe, Predicate, Schema } from "effect";

import { ranges } from "../query/Highlight.ts";
import { logMatches } from "../query/Match.ts";
import { parse } from "../query/Query.ts";
import { count, offset, plural, valueText } from "./format.ts";
import { LOG_LEVEL, levelOf, levelRole } from "./levels.ts";
import { chunk, highlighted } from "./Role.ts";
import { cut, cutLine } from "./text.ts";

import type { SpanId } from "../data/Snapshot.ts";
import type { LogCursor, LogScope } from "../nav/Screen.ts";
import type { LogLine } from "../query/Match.ts";
import type { Query } from "../query/Query.ts";
import type { Line, Role } from "./Role.ts";
import type { TreeEntry } from "./tree.ts";
import type { TreeFacts } from "./treeFacts.ts";
import type { AttributeValue, JsonlSpanEvent, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export interface LogEntry extends LogLine {
    readonly key: LogCursor;
    readonly spanId: SpanId;
    readonly eventIndex: number;
    /** The span's position in tree order. */
    readonly position: number;
    /** `span.startMs + offsetMs`. */
    readonly atMs: number;
    /** The first line of `effect.cause`. */
    readonly cause: Option.Option<string>;
}

/** All logs of the trace, memoized per `TreeFacts`. */
export interface TraceLogs {
    /** By atMs, then position, then eventIndex. */
    readonly all: ReadonlyArray<LogEntry>;
    /** The logs of the spans at positions [from, to), in the same order. */
    readonly range: (from: number, to: number) => ReadonlyArray<LogEntry>;
}

const FIBER_ID = "effect.fiberId";
const CAUSE = "effect.cause";

const jsonValues = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Json)));

/** A multi-value log (a name that parses as a JSON array) reads as one line, its elements separated by spaces. */
const messageOf = (name: string): string =>
    name.startsWith("[")
        ? Option.match(jsonValues(name), {
              onNone: () => name,
              onSome: (values) =>
                  Arr.join(
                      Arr.map(values, (value) => (Predicate.isString(value) ? value : JSON.stringify(value))),
                      " ",
                  ),
          })
        : name;

const fiberOf = (value: AttributeValue | undefined): string =>
    Predicate.isNumber(value) || (Predicate.isString(value) && value !== "") ? `#${value}` : "";

const causeOf = (value: AttributeValue | undefined): Option.Option<string> =>
    Predicate.isString(value) && value !== "" ? Arr.head(value.split("\n")) : Option.none();

const entryOf = (
    span: JsonlSpanRecord,
    position: number,
    event: JsonlSpanEvent,
    eventIndex: number,
): Option.Option<LogEntry> =>
    Option.map(levelOf(event.attrs), (level) => ({
        key: `${span.span}:${eventIndex}`,
        spanId: span.span,
        eventIndex,
        position,
        atMs: span.startMs + event.offsetMs,
        message: messageOf(event.name),
        level,
        fiber: fiberOf(event.attrs[FIBER_ID]),
        spanName: span.name,
        annotations: pipe(
            Object.entries(event.attrs),
            Arr.filter(([key]) => key !== LOG_LEVEL && key !== FIBER_ID && key !== CAUSE),
            Arr.map(([key, value]) => [key, valueText(value)] as const),
        ),
        exit: span.exit,
        cause: causeOf(event.attrs[CAUSE]),
    }));

interface SortKey {
    readonly atMs: number;
    readonly position: number;
    readonly eventIndex: number;
}

const byTime: Order.Order<SortKey> = Order.combine(
    Order.mapInput(Order.Number, (log: SortKey) => log.atMs),
    Order.combine(
        Order.mapInput(Order.Number, (log: SortKey) => log.position),
        Order.mapInput(Order.Number, (log: SortKey) => log.eventIndex),
    ),
);

const buildLogs = (facts: TreeFacts): TraceLogs => {
    const { ids } = facts.order();
    // A CSR table: the logs of the span at position p are byPosition[starts[p], starts[p + 1]).
    const byPosition: Array<LogEntry> = [];
    const starts: Array<number> = [];
    for (let position = 0; position < ids.length; position++) {
        starts[position] = byPosition.length;
        const span = facts.trace.spans.get(ids[position] ?? "");
        if (span === undefined) {
            continue;
        }
        for (let i = 0; i < span.events.length; i++) {
            const event = span.events[i];
            const entry = event === undefined ? Option.none() : entryOf(span, position, event, i);
            if (entry._tag === "Some") {
                byPosition[byPosition.length] = entry.value;
            }
        }
    }
    starts[ids.length] = byPosition.length;
    const all = Arr.sort(byPosition, byTime);
    const startOf = (position: number) => starts[Math.max(0, Math.min(position, ids.length))] ?? 0;
    return {
        all,
        range: (from, to) =>
            from <= 0 && to >= ids.length ? all : Arr.sort(byPosition.slice(startOf(from), startOf(to)), byTime),
    };
};

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const logsCache = new WeakMap<TreeFacts, TraceLogs>();

export const logsOf = (facts: TreeFacts): TraceLogs => {
    const cached = logsCache.get(facts);
    if (cached !== undefined) {
        return cached;
    }
    const logs = buildLogs(facts);
    logsCache.set(facts, logs);
    return logs;
};

/** The logs of several spans: each one's own, or each one's subtree. */
const logsOfSpans = (
    facts: TreeFacts,
    spans: ReadonlyArray<SpanId>,
    scope: "span" | "subtree",
): ReadonlyArray<LogEntry> => {
    const order = facts.order();
    const logs = logsOf(facts);
    const positions = Arr.filter(
        Arr.map(spans, (id) => order.position(id)),
        (position) => position >= 0,
    );
    if (positions.length === 0) {
        return [];
    }
    if (scope === "subtree") {
        // Siblings sit together with their subtrees in tree order, so their subtrees cover one range.
        const from = Arr.reduce(positions, Infinity, (low, position) => Math.min(low, position));
        const to = Arr.reduce(positions, -Infinity, (high, position) => Math.max(high, order.end(position)));
        return logs.range(from, to);
    }
    return Arr.sort(
        Arr.flatMap(positions, (position) => logs.range(position, position + 1)),
        byTime,
    );
};

/** The logs in scope for the selected row (06); None → all. */
export const scopedLogs = (
    facts: TreeFacts,
    entry: Option.Option<TreeEntry>,
    scope: LogScope,
): ReadonlyArray<LogEntry> => {
    if (scope === "trace" || entry._tag === "None") {
        return logsOf(facts).all;
    }
    const row = entry.value;
    switch (row._tag) {
        case "Span":
            return logsOfSpans(facts, [row.spanId], scope);
        case "Group":
            return logsOfSpans(facts, row.group.members, scope);
        case "Missing":
            return logsOfSpans(facts, facts.trace.children.get(row.parentId) ?? [], scope);
    }
};

export type LogRow = Data.TaggedEnum<{
    Entry: { readonly key: string; readonly entry: LogEntry };
    /** The `↳` line under an entry with a cause; never the cursor. */
    Cause: { readonly key: string; readonly entry: LogEntry };
}>;
export const LogRow = Data.taggedEnum<LogRow>();

export interface LogList {
    readonly scope: LogScope;
    readonly filter: string;
    readonly query: Query;
    /** In scope, before the filter. */
    readonly inScope: number;
    /** After the filter, in time order. */
    readonly entries: ReadonlyArray<LogEntry>;
    readonly rows: ReadonlyArray<LogRow>;
    /** Row index of each entry's Entry row. */
    readonly entryRow: ReadonlyArray<number>;
    /** The entry index of a log's key, -1 when it is filtered out, out of scope or not a log's key. */
    readonly entryIndex: (key: string) => number;
}

/** Where the log with this key sorts, looked up in the trace. None when the trace has no such log. */
const sortKeyOf = (facts: TreeFacts, cursor: string): Option.Option<SortKey> => {
    const colon = cursor.lastIndexOf(":");
    const spanId = cursor.slice(0, colon);
    const eventIndex = Number(cursor.slice(colon + 1));
    const span = facts.trace.spans.get(spanId);
    const event = span?.events[eventIndex];
    return span === undefined || event === undefined
        ? Option.none()
        : Option.some({ atMs: span.startMs + event.offsetMs, position: facts.order().position(spanId), eventIndex });
};

/** The index of the first entry that sorts at or after `key`. */
const lowerBound = (entries: ReadonlyArray<LogEntry>, key: SortKey): number => {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        const at = entries[middle];
        if (at !== undefined && byTime(at, key) < 0) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
};

export const logList = (
    facts: TreeFacts,
    entry: Option.Option<TreeEntry>,
    scope: LogScope,
    filter: string,
): LogList => {
    const query = parse(filter);
    const scoped = scopedLogs(facts, entry, scope);
    const entries = query.length === 0 ? scoped : Arr.filter(scoped, (log) => logMatches(query, log));
    const rows: Array<LogRow> = [];
    const entryRow: Array<number> = [];
    for (const log of entries) {
        entryRow[entryRow.length] = rows.length;
        rows[rows.length] = LogRow.Entry({ key: log.key, entry: log });
        if (log.cause._tag === "Some") {
            rows[rows.length] = LogRow.Cause({ key: `${log.key}#cause`, entry: log });
        }
    }
    return {
        scope,
        filter,
        query,
        inScope: scoped.length,
        entries,
        rows,
        entryRow,
        entryIndex: (key) =>
            Option.match(sortKeyOf(facts, key), {
                onNone: () => -1,
                onSome: (sortKey) => {
                    const at = lowerBound(entries, sortKey);
                    return entries[at]?.key === key ? at : -1;
                },
            }),
    };
};

/** The cursor's entry; else the first entry at or after the cursor log's time; else the last; -1 when empty. */
export const cursorEntry = (list: LogList, facts: TreeFacts, cursor: Option.Option<LogCursor>): number => {
    if (list.entries.length === 0) {
        return -1;
    }
    if (cursor._tag === "None") {
        return 0;
    }
    const last = list.entries.length - 1;
    return Option.match(sortKeyOf(facts, cursor.value), {
        onNone: () => last,
        onSome: (key) => Math.min(lowerBound(list.entries, key), last),
    });
};

const OFFSET_CELLS = 8;
const LEVEL_CELLS = 5;
const FIBER_CELLS = 4;
const SPAN_CELLS = 20;
const GAP = "  ";
/** Where the message starts: offset, level, fiber and span name, each followed by a gap. */
const MESSAGE_AT = OFFSET_CELLS + LEVEL_CELLS + FIBER_CELLS + SPAN_CELLS + 4 * GAP.length;

const marked = (text: string, role: Role, query: Query, bold = false): Line =>
    highlighted(text, role, ranges(query, text), bold);

export const logLine = (entry: LogEntry, query: Query, traceStartMs: number, width: number): Line =>
    cutLine(
        [
            chunk(offset(entry.atMs - traceStartMs).padStart(OFFSET_CELLS), "muted"),
            chunk(GAP, "text"),
            ...marked(entry.level, levelRole[entry.level], query, entry.level === "FATAL"),
            chunk(`${" ".repeat(LEVEL_CELLS - entry.level.length)}${GAP}`, "text"),
            ...marked(entry.fiber, "muted", query),
            chunk(`${" ".repeat(Math.max(0, FIBER_CELLS - entry.fiber.length))}${GAP}`, "text"),
            ...marked(cut(entry.spanName, SPAN_CELLS).padEnd(SPAN_CELLS), "text", query),
            chunk(GAP, "text"),
            ...marked(entry.message, "text", query),
            ...Arr.flatMap(entry.annotations, ([key, value], i) => [
                chunk(i === 0 ? GAP : " ", "text"),
                ...marked(`${key}=${value}`, "muted", query),
            ]),
        ],
        width,
    );

/** A typed error's cause line: its type, a colon and an empty message. */
const TYPE_ONLY = /^[^\s:]+:$/;

/** The `↳` line: the cause's first line, aligned under the message. */
export const causeLine = (entry: LogEntry, width: number): Line => {
    const cause = Option.getOrElse(entry.cause, () => "").trimEnd();
    const text = TYPE_ONLY.test(cause) ? `${cause} (no message)` : cause;
    return cutLine([chunk(" ".repeat(MESSAGE_AT), "text"), chunk(`↳ ${text}`, "failure")], width);
};

/** The pane title: `3 Logs · 12 · subtree`, or with a filter `3 Logs · 3 of 12 · subtree`. */
export const logsTitle = (list: LogList): string =>
    list.query.length === 0
        ? `3 Logs · ${count(list.inScope)} · ${list.scope}`
        : `3 Logs · ${count(list.entries.length)} of ${count(list.inScope)} · ${list.scope}`;

/** The input bar's count while editing the filter: `3 of 12 logs`. */
export const logCount = (list: LogList): string => `${count(list.entries.length)} of ${plural(list.inScope, "log")}`;
