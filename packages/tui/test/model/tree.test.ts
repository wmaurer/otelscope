import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet, Option, Order, pipe, Schema } from "effect";

import { anchorOf, flatten, parentRow, pinsOf, visibilityOf, shownIndex } from "../../src/model/tree.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { defaultTraceView, TreeRow } from "../../src/nav/Screen.ts";
import { indexed } from "../support/store.ts";
import { siblings, span, traceOf } from "../support/traces.ts";

import type { Trace } from "../../src/data/Snapshot.ts";
import type { Visibility } from "../../src/model/tree.ts";
import type { GroupKey, TraceView } from "../../src/nav/Screen.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const visibility = (over: Partial<Visibility> = {}): Visibility => ({
    folded: HashSet.empty(),
    openGroups: HashSet.empty(),
    pins: [],
    ...over,
});

const keys = (trace: Trace, over: Partial<Visibility> = {}) =>
    Arr.map(flatten(factsOf(trace), visibility(over)).rows, (row) => row.key);

const tree = traceOf([
    span("root", null, 1000),
    span("a", "root", 1001),
    span("a1", "a", 1002),
    span("a2", "a", 1003),
    span("b", "root", 1004),
]);

const wide = traceOf([
    span("root", null, 0),
    ...siblings("row", "root", "import.row", 25, 1, (i) => ({
        exit: i === 2 ? "Failure" : i === 7 ? "Interrupted" : "Success",
    })),
    span("deep", "row-010", 50),
    span("after", "root", 60),
]);

describe("flatten", () => {
    it("lists every span expanded, depth first, with depth, guides and fold marks", () => {
        const rows = flatten(factsOf(tree), visibility()).rows;
        expect(Arr.map(rows, (row) => row.key)).toEqual(["s:root", "s:a", "s:a1", "s:a2", "s:b"]);
        const described = Arr.map(rows, (row) =>
            row._tag === "Span" ? `${row.depth} ${row.last ? "└" : "├"} ${row.fold} ${row.rails?.more ?? "-"}` : "",
        );
        expect(described).toEqual(["0 └ open -", "1 ├ open -", "2 ├ leaf true", "2 └ leaf true", "1 └ leaf -"]);
    });

    it("hides a folded span's descendants", () => {
        expect(keys(tree, { folded: HashSet.make("a") })).toEqual(["s:root", "s:a", "s:b"]);
        expect(keys(tree, { folded: HashSet.make("root") })).toEqual(["s:root"]);
    });

    it("shows a closed group's row with its failed and interrupted members only", () => {
        expect(keys(wide)).toEqual(["s:root", "g:root|import.row", "s:row-002", "s:row-007", "s:after"]);
        const group = flatten(factsOf(wide), visibility()).rows[1];
        expect(group?._tag === "Group" && [group.open, group.shown]).toEqual([false, ["row-002", "row-007"]]);
    });

    it("also shows pinned members of a closed group, and every member of an open one", () => {
        expect(keys(wide, { pins: ["row-010"] })).toEqual([
            "s:root",
            "g:root|import.row",
            "s:row-002",
            "s:row-007",
            "s:row-010",
            "s:deep",
            "s:after",
        ]);
        const open = keys(wide, { openGroups: HashSet.make<[GroupKey]>("root|import.row") });
        expect(open.length).toBe(1 + 1 + 25 + 1 + 1);
        expect(open.slice(11, 14)).toEqual(["s:row-009", "s:row-010", "s:deep"]);
    });

    it("draws orphans under a missing-parent row that folds like a span", () => {
        const orphans = traceOf([span("top", null, 0), span("lost", "absent", 1), span("under", "lost", 2)]);
        expect(keys(orphans)).toEqual(["s:top", "m:absent", "s:lost", "s:under"]);
        expect(keys(orphans, { folded: HashSet.make("absent") })).toEqual(["s:top", "m:absent"]);
        const lost = flatten(factsOf(orphans), visibility()).rows[2];
        expect(lost?._tag === "Span" && lost.depth).toBe(1);
    });

    it("re-parents the orphans once the parent arrives", () => {
        const arrived = traceOf([
            span("top", null, 0),
            span("absent", "top", 1),
            span("lost", "absent", 1),
            span("under", "lost", 2),
        ]);
        expect(keys(arrived)).toEqual(["s:top", "s:absent", "s:lost", "s:under"]);
    });

    it("keeps one rail per ancestor level, so a 41-level row knows all of them", () => {
        const deep = traceOf(Arr.makeBy(41, (i) => span(`d${i}`, i === 0 ? null : `d${i - 1}`, i)));
        const rows = flatten(factsOf(deep), visibility()).rows;
        const last = rows[rows.length - 1];
        let levels = 0;
        for (let rail = last?._tag === "Span" ? last.rails : undefined; rail !== undefined; rail = rail.up) {
            levels += 1;
        }
        expect([last?._tag === "Span" && last.depth, levels]).toEqual([40, 39]);
    });

    const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
    const Seed = Schema.Struct({
        parent: between(-2, 40),
        name: between(0, 2),
        startMs: between(0, 9),
        exit: Schema.Literals(["Success", "Failure", "Interrupted"]),
        shuffle: between(0, 1000),
    });

    // A parent always comes earlier in the seed list, so the records form a forest; arrival order is shuffled apart.
    const recordsOf = (seeds: ReadonlyArray<typeof Seed.Type>): ReadonlyArray<JsonlSpanRecord> =>
        Arr.map(seeds, (seed, i) =>
            span(
                `s${String(i).padStart(2, "0")}`,
                seed.parent === -1 || seed.parent >= i
                    ? null
                    : seed.parent === -2
                      ? "gone"
                      : `s${String(seed.parent).padStart(2, "0")}`,
                seed.startMs,
                { name: `n${seed.name}`, exit: seed.exit },
            ),
        );

    const rowsOf = (input: ReadonlyArray<JsonlSpanRecord>, openAll: boolean): ReadonlyArray<string> =>
        Option.match(Option.fromUndefinedOr(indexed(input).traces.get("trace-1")), {
            onNone: () => [],
            onSome: (trace) => {
                const facts = factsOf(trace);
                const openGroups = openAll
                    ? HashSet.fromIterable(Arr.map(facts.groups(), (group) => group.key))
                    : HashSet.empty<GroupKey>();
                return Arr.map(flatten(facts, visibility({ openGroups })).rows, (row) => row.key);
            },
        });

    it.prop(
        "gives the same rows for the same records in any order",
        [Schema.Array(Seed).check(Schema.isMaxLength(60))],
        ([seeds]) => {
            const records = recordsOf(seeds);
            const shuffled = pipe(
                Arr.zip(records, seeds),
                Arr.sort(
                    Order.mapInput(
                        Order.Number,
                        ([, seed]: readonly [JsonlSpanRecord, typeof Seed.Type]) => seed.shuffle,
                    ),
                ),
                Arr.map(([record]) => record),
            );
            expect(rowsOf(shuffled, false)).toEqual(rowsOf(records, false));
            expect(rowsOf(shuffled, true)).toEqual(rowsOf(records, true));
        },
    );

    it.prop(
        "shows every span once with groups open, each orphan below its missing-parent row",
        [Schema.Array(Seed).check(Schema.isMaxLength(60))],
        ([seeds]) => {
            const records = recordsOf(seeds);
            const rows = rowsOf(records, true);
            const spans = Arr.filter(rows, (key) => key.startsWith("s:"));
            expect(Arr.sort(spans, Order.String)).toEqual(
                Arr.sort(
                    Arr.map(records, (record) => `s:${record.span}`),
                    Order.String,
                ),
            );
            const trace = indexed(records).traces.get("trace-1");
            for (const parentId of trace?.missingParents ?? []) {
                for (const child of trace?.children.get(parentId) ?? []) {
                    const at = (key: string) =>
                        Option.getOrElse(
                            Arr.findFirstIndex(rows, (row) => row === key),
                            () => -1,
                        );
                    expect(at(`s:${child}`)).toBeGreaterThan(at(`m:${parentId}`));
                }
            }
        },
    );
});

const view = (over: Partial<TraceView>): TraceView => ({ ...defaultTraceView, ...over });

const shown = (trace: Trace, over: Partial<TraceView>) => {
    const facts = factsOf(trace);
    const v = view(over);
    const built = flatten(facts, visibilityOf(facts, v));
    return built.rows[shownIndex(built, facts, v.selected)]?.key;
};

describe("shownIndex", () => {
    const select = (row: TreeRow) => Option.some(row);

    it("finds the stored row, or the first row with nothing stored", () => {
        expect(shown(tree, { selected: select(TreeRow.Span({ spanId: "a2" })) })).toBe("s:a2");
        expect(shown(tree, {})).toBe("s:root");
    });

    it("stands a hidden span in by its nearest visible ancestor, without rewriting the selection", () => {
        expect(shown(tree, { selected: select(TreeRow.Span({ spanId: "a2" })), folded: HashSet.make("a") })).toBe(
            "s:a",
        );
        expect(
            shown(tree, { selected: select(TreeRow.Span({ spanId: "a2" })), folded: HashSet.make("a", "root") }),
        ).toBe("s:root");
    });

    it("keeps a selected member of a closed group visible beneath it", () => {
        expect(shown(wide, { selected: select(TreeRow.Span({ spanId: "deep" })) })).toBe("s:deep");
        expect(
            pinsOf(factsOf(wide), view({ selected: select(TreeRow.Span({ spanId: "deep" })) })),
            "the member on the lineage is pinned",
        ).toEqual(["row-010"]);
    });

    it("selects a missing parent's span once it arrives, and the first row for anything gone", () => {
        const arrived = traceOf([span("top", null, 0), span("absent", "top", 1), span("lost", "absent", 2)]);
        expect(shown(arrived, { selected: select(TreeRow.Missing({ parentId: "absent" })) })).toBe("s:absent");
        expect(shown(tree, { selected: select(TreeRow.Span({ spanId: "nope" })) })).toBe("s:root");
        expect(shown(tree, { selected: select(TreeRow.Group({ key: "root|x" })) })).toBe("s:root");
    });

    it("stands a group row hidden by a fold in by the folded ancestor", () => {
        const selected = select(TreeRow.Group({ key: "root|import.row" }));
        expect(shown(wide, { selected })).toBe("g:root|import.row");
        expect(shown(wide, { selected, folded: HashSet.make("root") })).toBe("s:root");
    });
});

describe("parentRow", () => {
    const facts = factsOf(wide);
    const opened = flatten(facts, visibility({ openGroups: HashSet.make<[GroupKey]>("root|import.row") }));
    const rowFor = (key: string) => {
        const row = opened.rows[opened.indexOf(key)];
        if (row === undefined) {
            throw new Error(`no row ${key}`);
        }
        return row;
    };

    it("goes from a member to its group row, from a group row to its parent, and stops at the top", () => {
        expect(parentRow(facts, rowFor("s:row-004"))).toEqual(Option.some(TreeRow.Group({ key: "root|import.row" })));
        expect(parentRow(facts, rowFor("g:root|import.row"))).toEqual(Option.some(TreeRow.Span({ spanId: "root" })));
        expect(parentRow(facts, rowFor("s:deep"))).toEqual(Option.some(TreeRow.Span({ spanId: "row-010" })));
        expect(parentRow(facts, rowFor("s:root"))).toEqual(Option.none());
    });

    it("goes from an orphan to its missing-parent row", () => {
        const orphans = factsOf(traceOf([span("lost", "absent", 1)]));
        const lost = flatten(orphans, visibility()).rows[1]!;
        expect(parentRow(orphans, lost)).toEqual(Option.some(TreeRow.Missing({ parentId: "absent" })));
    });
});

describe("anchorOf", () => {
    it("is a span's position, or half a step before the first span a group or missing row stands for", () => {
        const facts = factsOf(wide);
        const at = (row: TreeRow) => anchorOf(facts, Option.some(row));
        expect(at(TreeRow.Span({ spanId: "root" }))).toBe(0);
        expect(at(TreeRow.Group({ key: "root|import.row" }))).toBe(0.5);
        expect(anchorOf(facts, Option.none())).toBe(-1);
        const orphans = factsOf(traceOf([span("top", null, 0), span("lost", "absent", 1)]));
        expect(anchorOf(orphans, Option.some(TreeRow.Missing({ parentId: "absent" })))).toBe(0.5);
    });
});
