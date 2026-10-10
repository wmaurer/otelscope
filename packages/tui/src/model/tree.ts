import { Array as Arr, Data, HashSet, Option } from "effect";

import { TreeRow } from "../nav/Screen.ts";

import type { SpanId } from "../data/Snapshot.ts";
import type { GroupKey, TraceView } from "../nav/Screen.ts";
import type { Group, Sibling, TreeFacts } from "./treeFacts.ts";

export type Fold = "open" | "folded" | "leaf";

/**
 * The guides above a row: one entry per ancestor level, innermost first, saying whether that level's line continues
 * below (`│ `) or has ended (`  `). Shared by every row under the same ancestor.
 */
export interface Rails {
    readonly more: boolean;
    readonly up: Rails | undefined;
}

export type TreeEntry = Data.TaggedEnum<{
    Span: {
        readonly key: string;
        readonly spanId: SpanId;
        /** 0 for top-level spans and for a missing parent's row; a group's members sit one deeper than its row. */
        readonly depth: number;
        readonly rails: Rails | undefined;
        /** The last row among its siblings: `└ ` rather than `├ `. */
        readonly last: boolean;
        readonly fold: Fold;
    };
    Group: {
        readonly key: string;
        readonly group: Group;
        readonly depth: number;
        readonly rails: Rails | undefined;
        readonly last: boolean;
        readonly open: boolean;
        /** The members drawn beneath the row: all of them when open; problems and pinned members when closed. */
        readonly shown: ReadonlyArray<SpanId>;
    };
    Missing: {
        readonly key: string;
        readonly parentId: SpanId;
        readonly fold: Fold;
    };
}>;
export const TreeEntry = Data.taggedEnum<TreeEntry>();

/** Everything the rows depend on besides the trace. Compared structurally, so moving the cursor rebuilds nothing. */
export interface Visibility {
    readonly folded: HashSet.HashSet<SpanId>;
    readonly openGroups: HashSet.HashSet<GroupKey>;
    /** Spans on the stored selection's lineage that sit in closed groups without being problems. */
    readonly pins: ReadonlyArray<SpanId>;
}

export interface Tree {
    readonly rows: ReadonlyArray<TreeEntry>;
    /** -1 when no row has the key. */
    readonly indexOf: (key: string) => number;
}

export const spanKey = (spanId: SpanId): string => `s:${spanId}`;
export const groupRowKey = (key: GroupKey): string => `g:${key}`;
export const missingKey = (parentId: SpanId): string => `m:${parentId}`;

export const rowKey = (row: TreeRow): string =>
    TreeRow.$match(row, {
        Span: ({ spanId }) => spanKey(spanId),
        Group: ({ key }) => groupRowKey(key),
        Missing: ({ parentId }) => missingKey(parentId),
    });

export const rowOf = (entry: TreeEntry): TreeRow =>
    TreeEntry.$match(entry, {
        Span: ({ spanId }) => TreeRow.Span({ spanId }),
        Group: ({ group }) => TreeRow.Group({ key: group.key }),
        Missing: ({ parentId }) => TreeRow.Missing({ parentId }),
    });

export const pinsOf = (facts: TreeFacts, view: Pick<TraceView, "selected" | "openGroups">): ReadonlyArray<SpanId> =>
    Option.match(view.selected, {
        onNone: () => [],
        onSome: (row) =>
            row._tag !== "Span"
                ? []
                : Arr.filter(facts.lineage(row.spanId), (id) =>
                      Option.exists(
                          facts.groupOf(id),
                          (group) => !HashSet.has(view.openGroups, group.key) && !group.problems.has(id),
                      ),
                  ),
    });

export const visibilityOf = (facts: TreeFacts, view: TraceView): Visibility => ({
    folded: view.folded,
    openGroups: view.openGroups,
    pins: pinsOf(facts, view),
});

const foldOf = (facts: TreeFacts, visibility: Visibility, id: SpanId): Fold =>
    !facts.hasChildren(id) ? "leaf" : HashSet.has(visibility.folded, id) ? "folded" : "open";

interface Pending {
    readonly item: Sibling;
    readonly depth: number;
    readonly rails: Rails | undefined;
    readonly last: boolean;
}

const one = (spanId: SpanId): Sibling => ({ _tag: "One", spanId });

/** The visible rows, depth first. An explicit stack keeps a 41-level trace off the call stack. */
export const flatten = (facts: TreeFacts, visibility: Visibility): Tree => {
    const rows: Array<TreeEntry> = [];
    const pins = new Set(visibility.pins);
    const stack: Array<Pending> = [];
    let top = 0;
    const pushAll = (items: ReadonlyArray<Sibling>, depth: number, rails: Rails | undefined) => {
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item !== undefined) {
                stack[top++] = { item, depth, rails, last: i === items.length - 1 };
            }
        }
    };
    /** The rails of a row's children: none below a top-level row, whose own level draws no guide. */
    const below = ({ depth, rails, last }: Pending): Rails | undefined =>
        depth === 0 ? undefined : { more: !last, up: rails };
    const emit = (pending: Pending) => {
        const { item, depth, rails, last } = pending;
        if (item._tag === "Group") {
            const { group } = item;
            const open = HashSet.has(visibility.openGroups, group.key);
            const shown = open
                ? group.members
                : Arr.filter(group.members, (member) => group.problems.has(member) || pins.has(member));
            rows[rows.length] = TreeEntry.Group({
                key: groupRowKey(group.key),
                group,
                depth,
                rails,
                last,
                open,
                shown,
            });
            pushAll(Arr.map(shown, one), depth + 1, below(pending));
            return;
        }
        const id = item.spanId;
        const fold = foldOf(facts, visibility, id);
        rows[rows.length] = TreeEntry.Span({ key: spanKey(id), spanId: id, depth, rails, last, fold });
        if (fold === "open") {
            pushAll(facts.siblings(id), depth + 1, below(pending));
        }
    };
    const drain = () => {
        while (top > 0) {
            const pending = stack[--top];
            if (pending !== undefined) {
                emit(pending);
            }
        }
    };
    pushAll(facts.siblings(null), 0, undefined);
    drain();
    for (const parentId of facts.trace.missingParents) {
        const fold: Fold = HashSet.has(visibility.folded, parentId) ? "folded" : "open";
        rows[rows.length] = TreeEntry.Missing({ key: missingKey(parentId), parentId, fold });
        if (fold === "open") {
            pushAll(facts.siblings(parentId), 1, undefined);
            drain();
        }
    }
    const index = new Map(Arr.map(rows, (row, i) => [row.key, i] as const));
    return { rows, indexOf: (key) => index.get(key) ?? -1 };
};

const spanStandIn = (tree: Tree, facts: TreeFacts, spanId: SpanId): number => {
    const chain = facts.lineage(spanId);
    for (const id of chain) {
        const at = tree.indexOf(spanKey(id));
        if (at >= 0) {
            return at;
        }
        const groupRow = Option.match(facts.groupOf(id), {
            onNone: () => -1,
            onSome: (group) => tree.indexOf(groupRowKey(group.key)),
        });
        if (groupRow >= 0) {
            return groupRow;
        }
    }
    const parent = Option.flatMapNullishOr(Arr.last(chain), (id) => facts.trace.spans.get(id)?.parent);
    return Option.match(parent, { onNone: () => -1, onSome: (id) => tree.indexOf(missingKey(id)) });
};

/** The row standing for a missing parent's id: the span once it arrived, else its placeholder row. */
const parentStandIn = (tree: Tree, facts: TreeFacts, parent: SpanId | null): number => {
    if (parent === null) {
        return -1;
    }
    return facts.trace.spans.has(parent) ? spanStandIn(tree, facts, parent) : tree.indexOf(missingKey(parent));
};

const standIn = (tree: Tree, facts: TreeFacts, row: TreeRow): number =>
    TreeRow.$match(row, {
        Span: ({ spanId }) => spanStandIn(tree, facts, spanId),
        Group: ({ key }) => {
            const at = tree.indexOf(groupRowKey(key));
            return at >= 0
                ? at
                : Option.match(facts.group(key), {
                      onNone: () => -1,
                      onSome: (group) => parentStandIn(tree, facts, group.parent),
                  });
        },
        Missing: ({ parentId }) => {
            const at = tree.indexOf(missingKey(parentId));
            return at >= 0 ? at : parentStandIn(tree, facts, parentId);
        },
    });

/**
 * The index of the row the stored selection shows as. A hidden span shows as its nearest visible ancestor (or the
 * closed group row standing for it), a missing parent that arrived as that span, and anything gone as the first row.
 * The stored selection itself is never rewritten. -1 only for an empty tree.
 */
export const shownIndex = (tree: Tree, facts: TreeFacts, selected: Option.Option<TreeRow>): number =>
    tree.rows.length === 0
        ? -1
        : Option.match(selected, { onNone: () => 0, onSome: (row) => Math.max(0, standIn(tree, facts, row)) });

const containerOf = (facts: TreeFacts, parent: SpanId | null): Option.Option<TreeRow> => {
    if (parent === null) {
        return Option.none();
    }
    return Option.some(
        facts.trace.spans.has(parent) ? TreeRow.Span({ spanId: parent }) : TreeRow.Missing({ parentId: parent }),
    );
};

/** `h` past the fold: a member's group row, else the parent span or missing-parent row. None at the top level. */
export const parentRow = (facts: TreeFacts, entry: TreeEntry): Option.Option<TreeRow> =>
    TreeEntry.$match(entry, {
        Span: ({ spanId }) =>
            Option.match(facts.groupOf(spanId), {
                onSome: (group) => Option.some(TreeRow.Group({ key: group.key })),
                onNone: () => containerOf(facts, facts.trace.spans.get(spanId)?.parent ?? null),
            }),
        Group: ({ group }) => containerOf(facts, group.parent),
        Missing: () => Option.none(),
    });

/**
 * Where a row sits in tree order, for "next after" and "at or after": a span's position, or half a step before the
 * first span a group or missing-parent row stands for. -1 when there is no selection.
 */
export const anchorOf = (facts: TreeFacts, row: Option.Option<TreeRow>): number => {
    const { position } = facts.order();
    const before = (first: SpanId | undefined) => (first === undefined ? -1 : position(first) - 0.5);
    return Option.match(row, {
        onNone: () => -1,
        onSome: TreeRow.$match({
            Span: ({ spanId }) => position(spanId),
            Group: ({ key }) => before(Option.getOrUndefined(facts.group(key))?.members[0]),
            Missing: ({ parentId }) => {
                const first = facts.siblings(parentId)[0];
                return before(first?._tag === "Group" ? first.group.members[0] : first?.spanId);
            },
        }),
    });
};
