import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet } from "effect";

import { lineText } from "../../src/model/text.ts";
import { flatten } from "../../src/model/tree.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { guides, hitOf, leftWidth, treeLeft } from "../../src/model/treeLine.ts";
import { searchOf } from "../../src/model/treeSearch.ts";
import { siblings, span, traceOf } from "../support/traces.ts";

import type { Trace } from "../../src/data/Snapshot.ts";
import type { Visibility } from "../../src/model/tree.ts";

const visibility = (over: Partial<Visibility> = {}): Visibility => ({
    folded: HashSet.empty(),
    openGroups: HashSet.empty(),
    pins: [],
    ...over,
});

const linesOf = (trace: Trace, text = "", over: Partial<Visibility> = {}, nameColumn = 32) => {
    const facts = factsOf(trace);
    const env = { facts, search: searchOf(facts, text), nameColumn };
    return Arr.map(flatten(facts, visibility(over)).rows, (row) => treeLeft(row, env, false));
};

const tree = traceOf([
    span("root", null, 0, { name: "POST /orders", ms: 1240, exit: "Failure" }),
    span("validate", "root", 1, { name: "order.validate", ms: 2.36 }),
    span("pay", "root", 2, { name: "payment.charge", ms: 12.3, exit: "Failure" }),
    span("attempt", "pay", 3, { name: "payment.attempt", ms: 5, exit: "Failure" }),
    span("stop", "pay", 4, { name: "cancel", ms: 1, exit: "Interrupted" }),
]);

describe("treeLeft", () => {
    it("draws gutter, exit glyph, guides, fold mark, name and the right-aligned duration", () => {
        expect(Arr.map(linesOf(tree), lineText)).toEqual([
            " ✗ ▾ POST /orders                     1.24s ",
            "   ├   order.validate                2.36ms ",
            " ✗ └ ▾ payment.charge                12.3ms ",
            " ✗   ├   payment.attempt             5.00ms ",
            " ⊘   └   cancel                      1.00ms ",
        ]);
    });

    it("colours the exit glyph by origin, propagated and interrupted, and the name red only on an origin", () => {
        const [root, , , attempt, stop] = linesOf(tree);
        expect(root?.[1]).toEqual({ text: "✗ ", role: "failurePropagated" });
        expect(attempt?.[1]).toEqual({ text: "✗ ", role: "failure" });
        expect(Arr.findFirst(attempt ?? [], (part) => part.text === "payment.attempt")).toEqual(
            expect.objectContaining({ value: { text: "payment.attempt", role: "failure" } }),
        );
        expect(Arr.some(root ?? [], (part) => part.text === "POST /orders" && part.role === "text")).toBe(true);
        expect(stop?.[1]).toEqual({ text: "⊘ ", role: "interrupted" });
    });

    it("marks a match in the gutter and highlights the matched text in the name", () => {
        const line = linesOf(tree, "payment")[2] ?? [];
        expect(line[0]).toEqual({ text: "▌", role: "accent" });
        expect(line).toContainEqual({ text: "payment", role: "text", bg: "matchBg" });
        expect(linesOf(tree, "payment")[0]?.[0]).toEqual({ text: " ", role: "text" });
    });

    it("tells how many matches a folded span hides, keeping the count in view when the name is cut", () => {
        const folded = linesOf(tree, "payment", { folded: HashSet.make("root") }, 20);
        expect(lineText(folded[0] ?? [])).toBe(" ✗ ▸ POST … · 2 matches   1.24s ");
    });

    it("draws a same-name group with its count, problems and envelope", () => {
        const wide = traceOf([
            span("root", null, 0),
            ...siblings("row", "root", "import.row", 400, 1, (i) => ({ exit: i % 70 === 3 ? "Failure" : "Success" })),
        ]);
        expect(lineText(linesOf(wide)[1] ?? [])).toBe("   └ ▸ import.row ×400 · 6 failed     400ms ");
    });

    it("draws a missing parent's row", () => {
        const orphans = traceOf([span("lost", "ab12cd34ef", 1)]);
        expect(lineText(linesOf(orphans)[0] ?? [])).toBe("   ▾ ⋯ missing parent ab12cd34…             ");
    });

    it("cuts a long name with an ellipsis inside its column", () => {
        const long = traceOf([span("root", null, 0, { name: "a.very.long.span.name.that.goes.on", ms: 3 })]);
        expect(lineText(linesOf(long, "", {}, 16)[0] ?? [])).toBe("     a.very.long.s…  3.00ms ");
    });
});

describe("guides", () => {
    it("shows every level up to 4 deep, then the depth and the innermost 4", () => {
        const deep = traceOf(Arr.makeBy(42, (i) => span(`d${i}`, i === 0 ? null : `d${i - 1}`, i)));
        const rows = flatten(factsOf(deep), visibility()).rows;
        expect(Arr.map([0, 1, 2, 4, 5, 41], (i) => guides(rows[i]!))).toEqual([
            "",
            "└ ",
            "  └ ",
            "      └ ",
            "⋯5       └ ",
            "⋯41       └ ",
        ]);
        expect(guides(flatten(factsOf(tree), visibility()).rows[3]!)).toBe("  ├ ");
    });
});

describe("hitOf", () => {
    const rows = flatten(factsOf(tree), visibility()).rows;

    it("hits the fold mark of a row with children, and the row elsewhere", () => {
        expect(hitOf(rows[2]!, 5)).toBe("mark");
        expect(hitOf(rows[2]!, 8)).toBe("row");
        expect(hitOf(rows[1]!, 5), "a leaf has no mark").toBe("row");
    });

    it("toggles a group row wherever it is clicked", () => {
        const wide = traceOf([span("root", null, 0), ...siblings("row", "root", "x", 20, 1)]);
        expect(hitOf(flatten(factsOf(wide), visibility()).rows[1]!, 30)).toBe("mark");
    });

    it("leaves the bar column after the left part", () => {
        expect(leftWidth(32)).toBe(1 + 2 + 32 + 8 + 1);
    });
});
