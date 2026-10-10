import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet, Option, Order } from "effect";

import { flatten, visibilityOf } from "../../src/model/tree.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { defaultTraceView, TreeRow } from "../../src/nav/Screen.ts";
import {
    collapseAll,
    cyclePane,
    expandAll,
    foldOrParent,
    nextScope,
    reveal,
    scrollDetails,
    selectRow,
    toggleAt,
    unfold,
} from "../../src/nav/TraceView.ts";
import { siblings, span, traceOf } from "../support/traces.ts";

import type { GroupKey, TraceView } from "../../src/nav/Screen.ts";

const trace = traceOf([
    span("root", null, 0),
    span("a", "root", 1),
    span("a1", "a", 2),
    span("leaf", "root", 3),
    ...siblings("row", "root", "import.row", 20, 10, (i) => ({ exit: i === 4 ? "Failure" : "Success" })),
    span("deep", "row-007", 40),
    span("deeper", "deep", 41),
    span("second", null, 50),
    span("second-child", "second", 51),
    span("lost", "absent", 60),
    span("lost-child", "lost", 61),
]);
const facts = factsOf(trace);

const rowsOf = (view: TraceView) => flatten(facts, visibilityOf(facts, view));
const entryFor = (view: TraceView, key: string) => {
    const tree = rowsOf(view);
    const entry = tree.rows[tree.indexOf(key)];
    if (entry === undefined) {
        throw new Error(`no row ${key}`);
    }
    return entry;
};
const members = <A extends string>(set: HashSet.HashSet<A>): ReadonlyArray<string> =>
    Arr.sort(Arr.fromIterable(set), Order.String);
const keys = (view: TraceView) => Arr.map(rowsOf(view).rows, (row) => row.key);
const select = (spanId: string): TraceView => ({
    ...defaultTraceView,
    selected: Option.some(TreeRow.Span({ spanId })),
});

describe("selectRow", () => {
    it("returns the same view for the same row, and scrolls details back up for another", () => {
        const view = { ...select("a"), detailsTop: 7 };
        expect(selectRow(view, TreeRow.Span({ spanId: "a" }))).toBe(view);
        expect(selectRow(view, TreeRow.Span({ spanId: "leaf" })).detailsTop).toBe(0);
    });
});

describe("toggleAt, foldOrParent and unfold", () => {
    it("folds and unfolds a span with children, and leaves a leaf alone", () => {
        const view = select("a");
        const folded = toggleAt(view, entryFor(view, "s:a"));
        expect(keys(folded)).not.toContain("s:a1");
        expect(toggleAt(folded, entryFor(folded, "s:a"))).toEqual(view);
        expect(toggleAt(view, entryFor(view, "s:leaf"))).toBe(view);
    });

    it("opens and closes a group row", () => {
        const view = select("root");
        const opened = toggleAt(view, entryFor(view, "g:root|import.row"));
        expect(keys(opened)).toContain("s:row-000");
        expect(keys(toggleAt(opened, entryFor(opened, "g:root|import.row")))).not.toContain("s:row-000");
    });

    it("h folds an expanded row, else moves to the parent row or the member's group row", () => {
        const view = select("a");
        expect(keys(foldOrParent(view, facts, entryFor(view, "s:a")))).not.toContain("s:a1");
        const onLeaf = select("a1");
        expect(foldOrParent(onLeaf, facts, entryFor(onLeaf, "s:a1")).selected).toEqual(
            Option.some(TreeRow.Span({ spanId: "a" })),
        );
        const onMember = select("row-004");
        expect(foldOrParent(onMember, facts, entryFor(onMember, "s:row-004")).selected).toEqual(
            Option.some(TreeRow.Group({ key: "root|import.row" })),
        );
        const onOrphan = { ...select("lost"), folded: HashSet.make("lost") };
        expect(foldOrParent(onOrphan, facts, entryFor(onOrphan, "s:lost")).selected).toEqual(
            Option.some(TreeRow.Missing({ parentId: "absent" })),
        );
    });

    it("l unfolds a folded row and opens a closed group, and does nothing otherwise", () => {
        const folded = { ...select("a"), folded: HashSet.make("a") };
        expect(members(unfold(folded, entryFor(folded, "s:a")).folded)).toEqual([]);
        const view = select("root");
        expect(unfold(view, entryFor(view, "s:a"))).toBe(view);
        expect(members(unfold(view, entryFor(view, "g:root|import.row")).openGroups)).toEqual(["root|import.row"]);
    });
});

describe("expandAll and collapseAll", () => {
    it("E clears every fold and opens every group", () => {
        const view = { ...select("root"), folded: HashSet.make("a", "root") };
        const expanded = expandAll(view, facts);
        expect(members(expanded.folded)).toEqual([]);
        expect(members(expanded.openGroups)).toEqual(["root|import.row"]);
    });

    it("C folds the root's children, other top-level spans and orphans that have children, and closes groups", () => {
        const view = { ...select("deeper"), openGroups: HashSet.make<[GroupKey]>("root|import.row") };
        const collapsed = collapseAll(view, facts);
        expect(members(collapsed.folded)).toEqual(["a", "lost", "row-007", "second"]);
        expect(members(collapsed.openGroups)).toEqual([]);
        expect(collapsed.selected, "the selection is not rewritten").toEqual(view.selected);
        expect(keys(collapsed)).toEqual([
            "s:root",
            "s:a",
            "s:leaf",
            "g:root|import.row",
            "s:row-004",
            "s:row-007",
            "s:second",
            "m:absent",
            "s:lost",
        ]);
    });
});

describe("reveal", () => {
    it("unfolds the ancestors and selects the span", () => {
        const view = { ...select("root"), folded: HashSet.make("root", "a", "leaf") };
        const revealed = reveal(view, facts, "a1", false);
        expect(members(revealed.folded)).toEqual(["leaf"]);
        expect(revealed.selected).toEqual(Option.some(TreeRow.Span({ spanId: "a1" })));
        expect(keys(revealed)).toContain("s:a1");
    });

    it("opens the groups hiding a span only when asked, and never for a failed member", () => {
        const view = select("root");
        expect(members(reveal(view, facts, "deeper", true).openGroups)).toEqual(["root|import.row"]);
        const pinned = reveal(view, facts, "deeper", false);
        expect(members(pinned.openGroups)).toEqual([]);
        expect(keys(pinned), "the closed group still shows the selected member").toContain("s:deeper");
        expect(members(reveal(view, facts, "row-004", true).openGroups)).toEqual([]);
    });

    it("unfolds a missing parent's row", () => {
        const view = { ...select("root"), folded: HashSet.make("absent") };
        expect(keys(reveal(view, facts, "lost-child", false))).toContain("s:lost-child");
    });
});

describe("cycling and scrolling", () => {
    it("cycles the log scope and the panes", () => {
        expect([nextScope("span"), nextScope("subtree"), nextScope("trace")]).toEqual(["subtree", "trace", "span"]);
        expect([cyclePane("tree", "next"), cyclePane("logs", "next"), cyclePane("tree", "prev")]).toEqual([
            "details",
            "tree",
            "logs",
        ]);
    });

    it("scrolls details within its rows", () => {
        expect(scrollDetails(defaultTraceView, 3, 10).detailsTop).toBe(3);
        expect(scrollDetails({ ...defaultTraceView, detailsTop: 9 }, 3, 10).detailsTop).toBe(10);
        expect(scrollDetails(defaultTraceView, -3, 10)).toBe(defaultTraceView);
    });
});
