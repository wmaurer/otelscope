import { Array as Arr, Data, Equal, HashSet, Option, Order, Record } from "effect";

import { TraceRow } from "../nav/Screen.ts";
import { traceMatches } from "../query/Match.ts";
import { parse } from "../query/Query.ts";
import { indexer } from "./list.ts";
import { isLive, isNotable, isProblem, traceState } from "./marks.ts";

import type { Run, RunId, Snapshot, Trace, TraceId } from "../data/Snapshot.ts";
import type { TracesView, TraceSort } from "../nav/Screen.ts";
import type { Query } from "../query/Query.ts";
import type { List } from "./list.ts";
import type { TraceState } from "./marks.ts";

/** Same-name groups, of root spans in the Traces list and of siblings in the trace tree, fold from this many on. */
export const GROUP_MIN = 20;
const CLOSED_SHOWN = 5;

export interface Item {
    readonly trace: Trace;
    readonly state: TraceState;
    /** Whether the trace matches the list's filter. */
    readonly matched: boolean;
    // What the list reads of the trace, copied off it when the item is made. The passes over every item of the run on
    // each publish then read only items, which lie together, and not the traces, which lie scattered on the heap.
    readonly id: TraceId;
    readonly key: string;
    readonly headName: string;
    readonly startMs: number;
    readonly durationMs: number;
    readonly spanCount: number;
    readonly failedSpans: number;
    readonly logs: number;
    readonly errorType: string | undefined;
}

/** The sums a group's heading shows, over its members. */
export interface GroupTotals {
    readonly spans: number;
    readonly failedTraces: number;
    readonly logs: number;
    /** The members' first errors, counted by type, in the order the types first appear among the sorted members. */
    readonly errors: ReadonlyMap<string, number>;
    readonly errorTotal: number;
    /** The members' durations, in no particular order: the heading reorders them to find the median. */
    readonly durations: Float64Array;
}

export interface Members {
    readonly items: ReadonlyArray<Item>;
    readonly totals: GroupTotals;
}

export interface Group {
    readonly name: string;
    readonly all: number;
    readonly members: ReadonlyArray<Item>;
    readonly totals: GroupTotals;
    readonly open: boolean;
    readonly shown: ReadonlyArray<Item>;
    readonly hidden: ReadonlyArray<Item>;
}

export type TraceListRow = Data.TaggedEnum<{
    Trace: { readonly key: string; readonly item: Item; readonly member: boolean };
    Heading: { readonly key: string; readonly group: Group };
    More: { readonly key: string; readonly group: Group };
}>;

export interface TraceList extends List<TraceListRow, TraceRow> {
    readonly run: Run;
    readonly groups: Readonly<Record<string, Group>>;
}

/** A record's own value: span names are user data, and `constructor` must not find `Object.prototype`'s. */
const own = <A>(record: Readonly<Record<string, A>>, key: string): A | undefined =>
    Object.hasOwn(record, key) ? record[key] : undefined;

const traceKey = (traceId: TraceId): string => `t:${traceId}`;
const headingKey = (name: string): string => `h:${name}`;
const moreKey = (name: string): string => `m:${name}`;

const rowKey = (row: TraceRow): string => {
    switch (row._tag) {
        case "Trace":
            return traceKey(row.traceId);
        case "Heading":
            return headingKey(row.name);
        case "More":
            return moreKey(row.name);
    }
};

const rowValue = (row: TraceListRow): TraceRow => {
    switch (row._tag) {
        case "Trace":
            return TraceRow.Trace({ traceId: row.item.trace.id });
        case "Heading":
            return TraceRow.Heading({ name: row.group.name });
        case "More":
            return TraceRow.More({ name: row.group.name });
    }
};

const orders = {
    duration: Order.flip(Order.mapInput(Order.Number, (item: Item) => item.durationMs)),
    failures: Order.combine(
        Order.flip(Order.mapInput(Order.Boolean, (item: Item) => item.state === "failed")),
        Order.flip(Order.mapInput(Order.Number, (item: Item) => item.failedSpans)),
    ),
    spans: Order.flip(Order.mapInput(Order.Number, (item: Item) => item.spanCount)),
} satisfies Readonly<Record<Exclude<TraceSort, "start">, Order.Order<Item>>>;

export interface Collected {
    readonly snapshot: Snapshot;
    readonly run: Run;
    readonly filter: string;
    readonly query: Query;
    readonly liveAt: Option.Option<number>;
    readonly total: number;
    /** Every trace of the run, in the run's order. */
    readonly all: ReadonlyArray<Item>;
    readonly matching: ReadonlyArray<Item>;
    readonly sorted: ReadonlyArray<Item>;
    /** The matching traces' starts, in `matching` order. */
    readonly starts: ReadonlyArray<number>;
    readonly sizes: Readonly<Record<string, number>>;
    readonly members: Readonly<Record<string, Members>>;
    readonly sort: TraceSort;
    readonly reverse: boolean;
}

interface Gathering {
    readonly items: Array<Item>;
    spans: number;
    failedTraces: number;
    logs: number;
    readonly errors: Map<string, number>;
    errorTotal: number;
    readonly durations: Float64Array;
    count: number;
}

const gathering = (size: number): Gathering => ({
    items: [],
    spans: 0,
    failedTraces: 0,
    logs: 0,
    errors: new Map(),
    errorTotal: 0,
    durations: new Float64Array(size),
    count: 0,
});

/** Adds a member's numbers, which do not depend on the order of the members. */
const total = (group: Gathering, item: Item): void => {
    group.durations[group.count] = item.durationMs;
    group.count += 1;
    group.spans += item.spanCount;
    group.failedTraces += item.state === "failed" ? 1 : 0;
    group.logs += item.logs;
};

/** Adds a member in sort order: the heading's most common error goes to the type shown first on a tie. */
const addMember = (group: Gathering, item: Item): void => {
    group.items[group.items.length] = item;
    if (item.errorType !== undefined) {
        group.errors.set(item.errorType, (group.errors.get(item.errorType) ?? 0) + 1);
        group.errorTotal += 1;
    }
};

const itemOf = (trace: Trace, query: Query, live: boolean): Item => ({
    trace,
    state: traceState(trace, live),
    matched: query.length === 0 || traceMatches(query, trace),
    id: trace.id,
    key: traceKey(trace.id),
    headName: trace.headName,
    startMs: trace.startMs,
    durationMs: trace.endMs - trace.startMs,
    spanCount: trace.spanCount,
    failedSpans: trace.failedSpans,
    logs: trace.logs,
    errorType: Option.isSome(trace.firstError) ? trace.firstError.value.type : undefined,
});

interface Kept {
    readonly items: ReadonlyArray<Item>;
    /** The traces whose items cannot be kept. */
    readonly changed: ReadonlySet<TraceId>;
    /** Whether liveness may differ, which decides whether a trace without a root is running or partial. */
    readonly restate: boolean;
}

const unchanged: ReadonlySet<TraceId> = new Set();

const nothingKept: Kept = { items: [], changed: unchanged, restate: false };

/** The items of `previous` that hold for `snapshot`: those of the traces that did not change since. */
const keptOf = (
    previous: Option.Option<Collected>,
    snapshot: Snapshot,
    filter: string,
    liveAt: Option.Option<number>,
): Kept =>
    Option.getOrElse(
        Option.flatMap(previous, (before): Option.Option<Kept> => {
            if (before.filter !== filter) {
                return Option.none();
            }
            const { since, traces } = snapshot.changed;
            const changed =
                before.snapshot.traces === snapshot.traces
                    ? Option.some(unchanged)
                    : since <= before.snapshot.version && before.snapshot.version < snapshot.version
                      ? Option.some(traces)
                      : Option.none();
            return Option.map(changed, (changed) => ({
                items: before.all,
                changed,
                restate: !Equal.equals(before.liveAt, liveAt) || before.snapshot.status.phase !== snapshot.status.phase,
            }));
        }),
        () => nothingKept,
    );

/**
 * Every trace of the run as an item, in the run's order. A trace that did not change keeps its item, which spares
 * reading it again: the traces that did not change keep their order, so one pass over the run and the kept items in step
 * pairs them up.
 */
const itemsOf = (
    snapshot: Snapshot,
    run: Run,
    query: Query,
    liveAt: Option.Option<number>,
    { items: old, changed, restate }: Kept,
): ReadonlyArray<Item> => {
    const phase = snapshot.status.phase;
    const live = (trace: Trace): boolean => Option.isSome(liveAt) && isLive(trace.lastArrivalAt, phase, liveAt.value);
    const items: Array<Item> = [];
    let next = 0;
    for (const id of run.traceIds) {
        if (!changed.has(id)) {
            while (next < old.length && old[next]?.id !== id) {
                next += 1;
            }
            const item = old[next];
            if (item !== undefined) {
                next += 1;
                const state =
                    restate && (item.state === "running" || item.state === "partial")
                        ? traceState(item.trace, live(item.trace))
                        : item.state;
                items[items.length] = state === item.state ? item : { ...item, state };
                continue;
            }
        }
        const trace = snapshot.traces.get(id);
        if (trace !== undefined) {
            items[items.length] = itemOf(trace, query, live(trace));
        }
    }
    return items;
};

/**
 * It runs over every trace of the run on each publish. So it keeps the items of the traces that did not change since
 * `previous` was collected, reads each changed trace once, and lays out the rest from the items alone. Neighbouring
 * traces mostly share their root's name, so it looks a name up again only when it changes.
 */
export const collect = (
    snapshot: Snapshot,
    runId: RunId,
    view: Pick<TracesView, "sort" | "reverse">,
    filter: string,
    liveAt: Option.Option<number>,
    previous: Option.Option<Collected>,
): Option.Option<Collected> =>
    Option.map(Option.fromUndefinedOr(snapshot.runs.get(runId)), (run) => {
        const query = parse(filter);
        const all = itemsOf(snapshot, run, query, liveAt, keptOf(previous, snapshot, filter, liveAt));
        // oxlint-disable-next-line effect-native/imperative-collection-build -- counting in the same pass is the point.
        const counts = new Map<string, number>();
        let name: string | undefined;
        let named = 0;
        for (const item of all) {
            if (item.headName === name) {
                named += 1;
            } else {
                if (name !== undefined) {
                    counts.set(name, (counts.get(name) ?? 0) + named);
                }
                name = item.headName;
                named = 1;
            }
        }
        if (name !== undefined) {
            counts.set(name, (counts.get(name) ?? 0) + named);
        }
        const matching = query.length === 0 ? all : Arr.filter(all, (item) => item.matched);

        const starts: Array<number> = [];
        // oxlint-disable-next-line effect-native/imperative-collection-build -- grouping in the same pass is the point.
        const groups = new Map<string, Gathering>();
        let last: { readonly name: string; readonly group: Gathering | undefined } | undefined;
        for (const item of matching) {
            starts[starts.length] = item.startMs;
            if (last?.name !== item.headName) {
                const size = counts.get(item.headName) ?? 0;
                let group = groups.get(item.headName);
                if (group === undefined && size >= GROUP_MIN) {
                    group = gathering(size);
                    groups.set(item.headName, group);
                }
                last = { name: item.headName, group };
            }
            if (last.group !== undefined) {
                total(last.group, item);
            }
        }

        const ordered = view.sort === "start" ? matching : Arr.sort(matching, orders[view.sort]);
        const sorted = view.reverse ? Arr.reverse(ordered) : ordered;
        let current: { readonly name: string; readonly group: Gathering | undefined } | undefined;
        for (const item of sorted) {
            if (current?.name !== item.headName) {
                current = { name: item.headName, group: groups.get(item.headName) };
            }
            if (current.group !== undefined) {
                addMember(current.group, item);
            }
        }
        return {
            snapshot,
            run,
            filter,
            query,
            liveAt,
            total: all.length,
            all,
            matching,
            sorted,
            starts,
            sizes: Object.fromEntries(counts),
            members: Object.fromEntries(
                Arr.map(Arr.fromIterable(groups), ([groupName, { items: members, durations, count, ...totals }]) => [
                    groupName,
                    { items: members, totals: { ...totals, durations: durations.subarray(0, count) } },
                ]),
            ),
            sort: view.sort,
            reverse: view.reverse,
        };
    });

const notableShown = (members: ReadonlyArray<Item>): ReadonlySet<Item> =>
    new Set(
        Arr.take(
            Arr.filter(members, (item) => isNotable(item.state)),
            CLOSED_SHOWN,
        ),
    );

const groupOf = (
    collected: Collected,
    name: string,
    { items: members, totals }: Members,
    open: boolean,
    pinned: Option.Option<TraceId>,
): Group => {
    if (open) {
        return { name, all: own(collected.sizes, name) ?? 0, members, totals, open, shown: [], hidden: [] };
    }
    const notable = notableShown(members);
    const shown = Arr.filter(members, (item) => notable.has(item) || Option.contains(pinned, item.trace.id));
    const isShown = new Set(shown);
    return {
        name,
        all: own(collected.sizes, name) ?? 0,
        members,
        totals,
        open,
        shown,
        hidden: Arr.filter(members, (item) => !isShown.has(item)),
    };
};

export const traceList = (
    collected: Collected,
    openGroups: HashSet.HashSet<string>,
    pinned: Option.Option<TraceId>,
): TraceList => {
    const groups = Record.map(collected.members, (members, name) =>
        groupOf(collected, name, members, HashSet.has(openGroups, name), pinned),
    );
    const newest = collected.matching[collected.matching.length - 1];
    const rows: Array<TraceListRow> = [];
    const stops: Array<number> = [];
    let followIndex = -1;
    const addTrace = (item: Item, member: boolean) => {
        if (isProblem(item.state)) {
            stops[stops.length] = rows.length;
        }
        if (item === newest) {
            followIndex = rows.length;
        }
        rows[rows.length] = { _tag: "Trace", key: item.key, item, member };
    };
    let last: { readonly name: string; readonly group: Group | undefined } | undefined;
    for (const item of collected.sorted) {
        if (last?.name !== item.headName) {
            last = { name: item.headName, group: own(groups, item.headName) };
        }
        const group = last.group;
        if (group === undefined) {
            addTrace(item, false);
        } else if (group.members[0] === item) {
            if (newest?.headName === group.name) {
                followIndex = rows.length;
            }
            rows[rows.length] = { _tag: "Heading", key: headingKey(group.name), group };
            for (const member of group.open ? group.members : group.shown) {
                addTrace(member, true);
            }
            if (group.hidden.length > 0) {
                if (Arr.some(group.hidden, (hidden) => isProblem(hidden.state))) {
                    stops[stops.length] = rows.length;
                }
                rows[rows.length] = { _tag: "More", key: moreKey(group.name), group };
            }
        }
    }
    return {
        rows,
        selectionOf: rowValue,
        keyOf: rowKey,
        indexOf: indexer(rows),
        stops,
        followIndex,
        timeSort: collected.sort === "start",
        newestEnd: collected.reverse ? "start" : "end",
        starts: collected.starts,
        filter: collected.filter,
        query: collected.query,
        matched: collected.matching.length,
        total: collected.total,
        run: collected.run,
        groups,
    };
};

export const pinnedBy = (
    collected: Collected,
    openGroups: HashSet.HashSet<string>,
    selected: Option.Option<TraceRow>,
): Option.Option<TraceId> =>
    Option.flatMap(selected, (row) => {
        if (row._tag !== "Trace") {
            return Option.none();
        }
        const trace = collected.snapshot.traces.get(row.traceId);
        if (trace === undefined || HashSet.has(openGroups, trace.headName)) {
            return Option.none();
        }
        const members = own(collected.members, trace.headName)?.items;
        if (members === undefined) {
            return Option.none();
        }
        const member = Arr.findFirst(members, (item) => item.trace === trace);
        return Option.isSome(member) && !notableShown(members).has(member.value)
            ? Option.some(row.traceId)
            : Option.none();
    });
