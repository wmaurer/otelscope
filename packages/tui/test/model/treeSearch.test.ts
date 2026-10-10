import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { Index } from "../../src/data/Index.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { matchText, searchOf } from "../../src/model/treeSearch.ts";
import { spanScans } from "../../src/query/Match.ts";
import { line, record } from "../support/records.ts";
import { ingestAll, status } from "../support/store.ts";
import { siblings, span, traceOf } from "../support/traces.ts";

import type { TreeEntry } from "../../src/model/tree.ts";

const trace = traceOf([
    span("root", null, 0, { name: "POST /orders" }),
    span("pay", "root", 1, { name: "payment.charge", attrs: { "card.brand": "visa" } }),
    span("retry", "pay", 2, { name: "payment.attempt" }),
    ...siblings("row", "root", "import.row", 20, 3, (i) => ({ attrs: { "row.index": i } })),
    span("tail", "root", 40, { name: "notify" }),
]);
const facts = factsOf(trace);

const entry = (spanId: string): Option.Option<TreeEntry> =>
    Option.some({ _tag: "Span", key: `s:${spanId}`, spanId, depth: 1, rails: undefined, last: false, fold: "leaf" });

describe("searchOf", () => {
    it("finds the spans matching every term, in tree order", () => {
        const search = searchOf(facts, "payment");
        expect(Arr.map(search.positions, (p) => facts.order().ids[p])).toEqual(["pay", "retry"]);
        expect(searchOf(facts, "payment visa").positions).toEqual([facts.order().position("pay")]);
    });

    it("counts the matches a folded span or a closed group hides", () => {
        const search = searchOf(facts, "row.index=1");
        expect(search.positions.length, "row.index 1 and 10 to 19").toBe(11);
        expect(search.below("root")).toBe(11);
        const group = Option.getOrThrow(facts.groupOf("row-001"));
        expect(search.hiddenIn(group, [])).toBe(11);
        expect(search.hiddenIn(group, ["row-001", "row-002"])).toBe(10);
        expect(searchOf(facts, "payment").below("pay")).toBe(1);
    });

    it("is inactive without terms", () => {
        expect(searchOf(facts, "  ").active).toBe(false);
    });

    it("matches a grown trace only on the records it did not have before", () => {
        const index = ingestAll(new Index(), [line(record({ span: "a", name: "alpha" }))]);
        const before = index.freeze(status).traces.get("trace-1")!;
        expect(searchOf(factsOf(before), "beta").positions).toEqual([]);
        index.ingest(line(record({ span: "b", name: "beta", startMs: 2000 })), 2, 999, Option.none());
        const after = index.freeze(status).traces.get("trace-1")!;
        const scansBefore = spanScans();
        expect(Arr.map(searchOf(factsOf(after), "beta").positions, (p) => factsOf(after).order().ids[p])).toEqual([
            "b",
        ]);
        expect(spanScans() - scansBefore, "only b was matched").toBe(1);
    });
});

describe("matchText", () => {
    it("reads match n/total on a match, the count elsewhere", () => {
        const search = searchOf(facts, "payment");
        expect(matchText(search, facts, entry("retry"))).toEqual(Option.some("match 2/2"));
        expect(matchText(search, facts, entry("root"))).toEqual(Option.some("2 matches"));
        expect(matchText(searchOf(facts, "notify"), facts, entry("root"))).toEqual(Option.some("1 match"));
    });

    it("says when the terms match only across spans, or not at all", () => {
        expect(matchText(searchOf(facts, "visa notify"), facts, entry("root"))).toEqual(
            Option.some("no single span matches all terms"),
        );
        expect(matchText(searchOf(facts, "zebra"), facts, entry("root"))).toEqual(Option.some("no matches"));
        expect(matchText(searchOf(facts, ""), facts, entry("root"))).toEqual(Option.none());
    });
});
