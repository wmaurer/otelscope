import { Array as Arr, Equal, HashSet, Option } from "effect";

import { groupsToOpen } from "../model/opening.ts";
import { parentRow } from "../model/tree.ts";
import { TreeRow } from "./Screen.ts";

import type { SpanId } from "../data/Snapshot.ts";
import type { Dir } from "../keys/Action.ts";
import type { TreeEntry } from "../model/tree.ts";
import type { TreeFacts } from "../model/treeFacts.ts";
import type { GroupKey, LogScope, Pane, TraceView } from "./Screen.ts";

/** Selects a row. The details pane scrolls back to the top only when the row changed. */
export const selectRow = (view: TraceView, row: TreeRow): TraceView =>
    Option.exists(view.selected, (stored) => Equal.equals(stored, row))
        ? view
        : { ...view, selected: Option.some(row), detailsTop: 0 };

const toggled = <A>(set: HashSet.HashSet<A>, value: A): HashSet.HashSet<A> =>
    HashSet.has(set, value) ? HashSet.remove(set, value) : HashSet.add(set, value);

/**
 * Selects a span and makes it visible: unfolds its ancestors (and its missing parent's row) and, when `openGroups` is
 * set, opens the groups that would otherwise hide it. Without it, closed groups keep showing it as a pinned member.
 */
export const reveal = (view: TraceView, facts: TreeFacts, spanId: SpanId, openGroups: boolean): TraceView => {
    const lineage = facts.lineage(spanId);
    const missingParent = Option.flatMapNullishOr(Arr.last(lineage), (top) => facts.trace.spans.get(top)?.parent);
    const ancestors = [...Arr.drop(lineage, 1), ...Option.toArray(missingParent)];
    const folded = Arr.reduce(ancestors, view.folded, (set, id) => HashSet.remove(set, id));
    const opened = openGroups
        ? Arr.reduce(groupsToOpen(facts, spanId), view.openGroups, (set, key) => HashSet.add(set, key))
        : view.openGroups;
    const unchanged = Equal.equals(folded, view.folded) && Equal.equals(opened, view.openGroups);
    return selectRow(unchanged ? view : { ...view, folded, openGroups: opened }, TreeRow.Span({ spanId }));
};

/** ⏎ and Space: fold or unfold a row with children, open or close a group row; a leaf stays as it is. */
export const toggleAt = (view: TraceView, entry: TreeEntry): TraceView => {
    switch (entry._tag) {
        case "Span":
            return entry.fold === "leaf" ? view : { ...view, folded: toggled(view.folded, entry.spanId) };
        case "Missing":
            return { ...view, folded: toggled(view.folded, entry.parentId) };
        case "Group":
            return { ...view, openGroups: toggled(view.openGroups, entry.group.key) };
    }
};

const isExpanded = (entry: TreeEntry): boolean => (entry._tag === "Group" ? entry.open : entry.fold === "open");

/** `h`: fold an expanded row (closing an open group), else go to the parent row. */
export const foldOrParent = (view: TraceView, facts: TreeFacts, entry: TreeEntry): TraceView =>
    isExpanded(entry)
        ? toggleAt(view, entry)
        : Option.match(parentRow(facts, entry), {
              onNone: () => view,
              onSome: (row) => selectRow(view, row),
          });

/** `l`: unfold a folded row, or open a closed group. */
export const unfold = (view: TraceView, entry: TreeEntry): TraceView =>
    entry._tag === "Group"
        ? entry.open
            ? view
            : toggleAt(view, entry)
        : entry.fold === "folded"
          ? toggleAt(view, entry)
          : view;

/** `E`: nothing folded, every group open. */
export const expandAll = (view: TraceView, facts: TreeFacts): TraceView => ({
    ...view,
    folded: HashSet.empty(),
    openGroups: HashSet.fromIterable(Arr.map(facts.groups(), (group): GroupKey => group.key)),
});

/**
 * `C`: fold every child of the root and every other top-level span (and every orphan) that has children, and close
 * every group. The selection is left alone: a span hidden by the folds shows as its folded ancestor.
 */
export const collapseAll = (view: TraceView, facts: TreeFacts): TraceView => {
    const { trace } = facts;
    const [root, ...others] = trace.topLevel;
    const candidates = [
        ...(root === undefined ? [] : (trace.children.get(root) ?? [])),
        ...others,
        ...Arr.flatMap(trace.missingParents, (parent) => trace.children.get(parent) ?? []),
    ];
    return {
        ...view,
        folded: HashSet.fromIterable(Arr.filter(candidates, facts.hasChildren)),
        openGroups: HashSet.empty(),
    };
};

const scopes: ReadonlyArray<LogScope> = ["span", "subtree", "trace"];
const panes: ReadonlyArray<Pane> = ["tree", "details", "logs"];

const cycle = <A>(all: ReadonlyArray<A>, current: A, dir: Dir): A => {
    const at = Option.getOrElse(
        Arr.findFirstIndex(all, (item) => item === current),
        () => 0,
    );
    const next = (at + (dir === "next" ? 1 : all.length - 1)) % all.length;
    return all[next] ?? current;
};

export const nextScope = (scope: LogScope): LogScope => cycle(scopes, scope, "next");

export const cyclePane = (pane: Pane, dir: Dir): Pane => cycle(panes, pane, dir);

/** Scrolls the details pane, within `[0, maxTop]`. */
export const scrollDetails = (view: TraceView, rows: number, maxTop: number): TraceView => {
    const top = Math.max(0, Math.min(Math.max(0, maxTop), view.detailsTop + rows));
    return top === view.detailsTop ? view : { ...view, detailsTop: top };
};
