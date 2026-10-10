import { Array as Arr, Option } from "effect";

import { GROUP_MIN } from "./traceList.ts";

import type { SpanId, Trace } from "../data/Snapshot.ts";
import type { GroupKey } from "../nav/Screen.ts";

/** Same-name siblings folded under one row. */
export interface Group {
    readonly key: GroupKey;
    readonly parent: SpanId | null;
    readonly name: string;
    /** In start order: index + 1 is the `#217` of the group summary. */
    readonly members: ReadonlyArray<SpanId>;
    /** Members whose own exit is a failure or an interruption. A closed group always shows these. */
    readonly problems: ReadonlySet<SpanId>;
    /** The members' envelope. */
    readonly startMs: number;
    readonly endMs: number;
    readonly failed: number;
    readonly interrupted: number;
}

export type Sibling =
    | { readonly _tag: "One"; readonly spanId: SpanId }
    | { readonly _tag: "Group"; readonly group: Group };

export type SpanKind = "origin" | "propagated" | "interrupted" | "ok";

/**
 * Tree order, grouping-aware: siblings in start order, except that a group's members (each with its subtree) sit
 * together at the place of the first member. That is the order rows are drawn in, so every subtree and every group
 * covers one range of positions.
 */
export interface TreeOrder {
    readonly ids: ReadonlyArray<SpanId>;
    /** -1 for a span not in the trace. */
    readonly position: (spanId: SpanId) => number;
    /** The exclusive end of the subtree starting at `position`. */
    readonly end: (position: number) => number;
    /** Sorted positions of failure origins and interrupted spans: the stops of `n`/`N`. */
    readonly problems: ReadonlyArray<number>;
    /** Sorted positions of failure origins. */
    readonly origins: ReadonlyArray<number>;
}

/** Everything about a trace's tree that depends on the trace alone, computed at most once per `Trace` object. */
export interface TreeFacts {
    readonly trace: Trace;
    /** Display order of `parent`'s children: `null` is the top level, a missing parent's id its orphans. */
    readonly siblings: (parent: SpanId | null) => ReadonlyArray<Sibling>;
    readonly groupOf: (spanId: SpanId) => Option.Option<Group>;
    readonly group: (key: GroupKey) => Option.Option<Group>;
    readonly groups: () => ReadonlyArray<Group>;
    readonly order: () => TreeOrder;
    /** The span, then each ancestor present in the trace, up to a top-level span or the one below a missing parent. */
    readonly lineage: (spanId: SpanId) => ReadonlyArray<SpanId>;
    readonly kind: (spanId: SpanId) => SpanKind;
    readonly hasChildren: (spanId: SpanId) => boolean;
    readonly spanNames: () => ReadonlySet<string>;
}

export const groupKey = (parent: SpanId | null, name: string): GroupKey => `${parent ?? ""}|${name}`;

const parentOfKey = (key: GroupKey): SpanId | null => {
    const parent = key.slice(0, key.indexOf("|"));
    return parent === "" ? null : parent;
};

const nameOfKey = (key: GroupKey): string => key.slice(key.indexOf("|") + 1);

interface SiblingList {
    readonly items: ReadonlyArray<Sibling>;
    readonly groups: ReadonlyMap<string, Group>;
}

export const NO_CHILDREN: ReadonlyArray<SpanId> = [];

/**
 * By the identity of a `children` array. The index replaces a parent's array only when that parent gains a child, and
 * records never change, so a publish regroups only the parents it touched.
 */
// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const siblingCache = new WeakMap<ReadonlyArray<SpanId>, SiblingList>();

const buildGroup = (trace: Trace, parent: SpanId | null, name: string, members: ReadonlyArray<SpanId>): Group => {
    let startMs = Infinity;
    let endMs = -Infinity;
    let failed = 0;
    let interrupted = 0;
    const problems: Array<SpanId> = [];
    for (const id of members) {
        const span = trace.spans.get(id);
        if (span === undefined) {
            continue;
        }
        startMs = Math.min(startMs, span.startMs);
        endMs = Math.max(endMs, span.startMs + span.ms);
        if (span.exit === "Failure") {
            failed += 1;
            problems[problems.length] = id;
        } else if (span.exit === "Interrupted") {
            interrupted += 1;
            problems[problems.length] = id;
        }
    }
    return {
        key: groupKey(parent, name),
        parent,
        name,
        members,
        problems: new Set(problems),
        startMs,
        endMs,
        failed,
        interrupted,
    };
};

const siblingList = (trace: Trace, parent: SpanId | null): SiblingList => {
    const children = trace.children.get(parent) ?? NO_CHILDREN;
    const cached = siblingCache.get(children);
    if (cached !== undefined) {
        return cached;
    }
    const nameOf = (id: SpanId) => trace.spans.get(id)?.name ?? "";
    const byName = Arr.groupBy(children, nameOf);
    const grouped = (name: string): ReadonlyArray<SpanId> | undefined => {
        const members = Object.hasOwn(byName, name) ? byName[name] : undefined;
        return members !== undefined && members.length >= GROUP_MIN ? members : undefined;
    };
    const groups = new Map(
        Arr.getSomes(
            Arr.map(Object.keys(byName), (name) =>
                Option.map(
                    Option.fromUndefinedOr(grouped(name)),
                    (members) => [name, buildGroup(trace, parent, name, members)] as const,
                ),
            ),
        ),
    );
    const items = Arr.getSomes(
        Arr.map(children, (id): Option.Option<Sibling> => {
            const group = groups.get(nameOf(id));
            if (group === undefined) {
                return Option.some({ _tag: "One", spanId: id });
            }
            return group.members[0] === id ? Option.some({ _tag: "Group", group }) : Option.none();
        }),
    );
    const list = { items, groups };
    siblingCache.set(children, list);
    return list;
};

/** Each sibling's spans in display order: a group stands for all its members. */
const spread = (items: ReadonlyArray<Sibling>): ReadonlyArray<SpanId> =>
    Arr.flatMap(items, (item) => (item._tag === "One" ? [item.spanId] : item.group.members));

const buildOrder = (facts: TreeFacts): TreeOrder => {
    const { trace } = facts;
    const ids: Array<SpanId> = [];
    const parents: Array<number> = [];
    const problems: Array<number> = [];
    const origins: Array<number> = [];
    // Spans still to visit, each with its parent's position.
    const pending: Array<SpanId> = [];
    const pendingParents: Array<number> = [];
    let top = 0;
    const pushAll = (spans: ReadonlyArray<SpanId>, parent: number) => {
        for (let i = spans.length - 1; i >= 0; i--) {
            pending[top] = spans[i] ?? "";
            pendingParents[top] = parent;
            top += 1;
        }
    };
    pushAll(
        [
            ...spread(facts.siblings(null)),
            ...Arr.flatMap(trace.missingParents, (parent) => spread(facts.siblings(parent))),
        ],
        -1,
    );
    while (top > 0) {
        top -= 1;
        const id = pending[top] ?? "";
        const position = ids.length;
        ids[position] = id;
        parents[position] = pendingParents[top] ?? -1;
        const kind = facts.kind(id);
        if (kind === "origin" || kind === "interrupted") {
            problems[problems.length] = position;
        }
        if (kind === "origin") {
            origins[origins.length] = position;
        }
        pushAll(spread(facts.siblings(id)), position);
    }
    // Children sit after their parent, so summing sizes from the back sees every child before its parent.
    const sizes: Array<number> = Arr.makeBy(ids.length, () => 1);
    for (let position = ids.length - 1; position > 0; position--) {
        const parent = parents[position] ?? -1;
        if (parent >= 0) {
            sizes[parent] = (sizes[parent] ?? 1) + (sizes[position] ?? 1);
        }
    }
    const positions = new Map(Arr.map(ids, (id, i) => [id, i] as const));
    return {
        ids,
        position: (spanId) => positions.get(spanId) ?? -1,
        end: (position) => position + (sizes[position] ?? 1),
        problems,
        origins,
    };
};

class Facts implements TreeFacts {
    readonly trace: Trace;
    private readonly kinds = new Map<SpanId, SpanKind>();
    private memoOrder: TreeOrder | undefined;
    private memoNames: ReadonlySet<string> | undefined;

    constructor(trace: Trace) {
        this.trace = trace;
    }

    readonly siblings = (parent: SpanId | null): ReadonlyArray<Sibling> => siblingList(this.trace, parent).items;

    readonly groupOf = (spanId: SpanId): Option.Option<Group> => {
        const span = this.trace.spans.get(spanId);
        return span === undefined
            ? Option.none()
            : Option.fromUndefinedOr(siblingList(this.trace, span.parent).groups.get(span.name));
    };

    readonly group = (key: GroupKey): Option.Option<Group> =>
        Option.fromUndefinedOr(siblingList(this.trace, parentOfKey(key)).groups.get(nameOfKey(key)));

    readonly groups = (): ReadonlyArray<Group> =>
        Arr.flatMap(Array.from(this.trace.children.keys()), (parent) =>
            Array.from(siblingList(this.trace, parent).groups.values()),
        );

    readonly order = (): TreeOrder => (this.memoOrder ??= buildOrder(this));

    readonly lineage = (spanId: SpanId): ReadonlyArray<SpanId> => {
        const chain: Array<SpanId> = [];
        for (let at = this.trace.spans.get(spanId); at !== undefined;) {
            chain[chain.length] = at.span;
            at = at.parent === null ? undefined : this.trace.spans.get(at.parent);
        }
        return chain;
    };

    readonly kind = (spanId: SpanId): SpanKind => {
        const known = this.kinds.get(spanId);
        if (known !== undefined) {
            return known;
        }
        const exit = this.trace.spans.get(spanId)?.exit;
        const kind: SpanKind =
            exit === "Interrupted"
                ? "interrupted"
                : exit !== "Failure"
                  ? "ok"
                  : Arr.some(
                          this.trace.children.get(spanId) ?? NO_CHILDREN,
                          (child) => this.trace.spans.get(child)?.exit === "Failure",
                      )
                    ? "propagated"
                    : "origin";
        this.kinds.set(spanId, kind);
        return kind;
    };

    readonly hasChildren = (spanId: SpanId): boolean => (this.trace.children.get(spanId)?.length ?? 0) > 0;

    readonly spanNames = (): ReadonlySet<string> =>
        (this.memoNames ??= new Set(Arr.map(Array.from(this.trace.spans.values()), (span) => span.name)));
}

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const factsCache = new WeakMap<Trace, TreeFacts>();

export const factsOf = (trace: Trace): TreeFacts => {
    const cached = factsCache.get(trace);
    if (cached !== undefined) {
        return cached;
    }
    const facts = new Facts(trace);
    factsCache.set(trace, facts);
    return facts;
};
