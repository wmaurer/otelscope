import { Array as Arr, Data, HashSet, Option, Order, Record } from "effect";

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
}

/** The sums a group's heading shows, over its members. */
export interface GroupTotals {
    readonly spans: number;
    readonly failedTraces: number;
    readonly logs: number;
    /** The members' first errors, counted by type, in the order the types first appear. */
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
    duration: Order.flip(Order.mapInput(Order.Number, (item: Item) => item.trace.endMs - item.trace.startMs)),
    failures: Order.combine(
        Order.flip(Order.mapInput(Order.Boolean, (item: Item) => item.state === "failed")),
        Order.flip(Order.mapInput(Order.Number, (item: Item) => item.trace.failedSpans)),
    ),
    spans: Order.flip(Order.mapInput(Order.Number, (item: Item) => item.trace.spanCount)),
} satisfies Readonly<Record<Exclude<TraceSort, "start">, Order.Order<Item>>>;

export interface Collected {
    readonly snapshot: Snapshot;
    readonly run: Run;
    readonly filter: string;
    readonly query: Query;
    readonly total: number;
    readonly matching: ReadonlyArray<Trace>;
    readonly sorted: ReadonlyArray<Item>;
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
}

const gathering = (size: number): Gathering => ({
    items: [],
    spans: 0,
    failedTraces: 0,
    logs: 0,
    errors: new Map(),
    errorTotal: 0,
    durations: new Float64Array(size),
});

const gather = (group: Gathering, item: Item): void => {
    const { trace } = item;
    group.durations[group.items.length] = trace.endMs - trace.startMs;
    group.items[group.items.length] = item;
    group.spans += trace.spanCount;
    group.failedTraces += item.state === "failed" ? 1 : 0;
    group.logs += trace.logs;
    if (Option.isSome(trace.firstError)) {
        const type = trace.firstError.value.type;
        group.errors.set(type, (group.errors.get(type) ?? 0) + 1);
        group.errorTotal += 1;
    }
};

/**
 * It runs over every trace of the run on each publish. So it walks them in plain loops, without an `Option` or a
 * closure per trace, and gathers each group's totals in the same pass. Neighbouring traces mostly share their root's
 * name, so it looks a name up again only when it changes.
 */
export const collect = (
    snapshot: Snapshot,
    runId: RunId,
    view: Pick<TracesView, "sort" | "reverse">,
    filter: string,
    liveAt: Option.Option<number>,
): Option.Option<Collected> =>
    Option.map(Option.fromUndefinedOr(snapshot.runs.get(runId)), (run) => {
        const query = parse(filter);
        const all: Array<Trace> = [];
        // oxlint-disable-next-line effect-native/imperative-collection-build -- counting in the same pass is the point.
        const counts = new Map<string, number>();
        let name: string | undefined;
        let named = 0;
        for (const id of run.traceIds) {
            const trace = snapshot.traces.get(id);
            if (trace !== undefined) {
                all[all.length] = trace;
                if (trace.headName === name) {
                    named += 1;
                } else {
                    if (name !== undefined) {
                        counts.set(name, (counts.get(name) ?? 0) + named);
                    }
                    name = trace.headName;
                    named = 1;
                }
            }
        }
        if (name !== undefined) {
            counts.set(name, (counts.get(name) ?? 0) + named);
        }
        const matching = query.length === 0 ? all : Arr.filter(all, (trace) => traceMatches(query, trace));
        const phase = snapshot.status.phase;
        const items = Arr.map(matching, (trace): Item => ({
            trace,
            state: traceState(trace, Option.isSome(liveAt) && isLive(trace.lastArrivalAt, phase, liveAt.value)),
        }));
        const ordered = view.sort === "start" ? items : Arr.sort(items, orders[view.sort]);
        const sorted = view.reverse ? Arr.reverse(ordered) : ordered;
        // oxlint-disable-next-line effect-native/imperative-collection-build -- grouping in the same pass is the point.
        const groups = new Map<string, Gathering>();
        let last: { readonly name: string; readonly group: Gathering | undefined } | undefined;
        for (const item of sorted) {
            const headName = item.trace.headName;
            if (last?.name !== headName) {
                const size = counts.get(headName) ?? 0;
                let group = groups.get(headName);
                if (group === undefined && size >= GROUP_MIN) {
                    group = gathering(size);
                    groups.set(headName, group);
                }
                last = { name: headName, group };
            }
            if (last.group !== undefined) {
                gather(last.group, item);
            }
        }
        return {
            snapshot,
            run,
            filter,
            query,
            total: all.length,
            matching,
            sorted,
            sizes: Object.fromEntries(counts),
            members: Object.fromEntries(
                Arr.map(Arr.fromIterable(groups), ([name, { items, durations, ...totals }]) => [
                    name,
                    { items, totals: { ...totals, durations: durations.subarray(0, items.length) } },
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
        if (item.trace === newest) {
            followIndex = rows.length;
        }
        rows[rows.length] = { _tag: "Trace", key: traceKey(item.trace.id), item, member };
    };
    let last: { readonly name: string; readonly group: Group | undefined } | undefined;
    for (const item of collected.sorted) {
        if (last?.name !== item.trace.headName) {
            last = { name: item.trace.headName, group: own(groups, item.trace.headName) };
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
        starts: Arr.map(collected.matching, (trace) => trace.startMs),
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
