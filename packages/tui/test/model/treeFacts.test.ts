import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { Index } from "../../src/data/Index.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { record } from "../support/records.ts";
import { line } from "../support/records.ts";
import { ingestAll, status } from "../support/store.ts";
import { siblings, span, traceOf } from "../support/traces.ts";

const tree = traceOf([
    span("root", null, 1000, { exit: "Failure" }),
    span("auth", "root", 1001),
    span("pay", "root", 1002, { exit: "Failure" }),
    span("charge", "pay", 1003, { exit: "Failure" }),
    span("stop", "root", 1004, { exit: "Interrupted" }),
]);

describe("factsOf", () => {
    it("is computed once per Trace object", () => {
        expect(factsOf(tree)).toBe(factsOf(tree));
    });

    it("tells a failure origin from a span the failure only passed through", () => {
        const facts = factsOf(tree);
        expect(Arr.map(["root", "pay", "charge", "stop", "auth"], facts.kind)).toEqual([
            "propagated",
            "propagated",
            "origin",
            "interrupted",
            "ok",
        ]);
    });

    it("walks the lineage up to the top, or to the span below a missing parent", () => {
        const facts = factsOf(tree);
        expect(facts.lineage("charge")).toEqual(["charge", "pay", "root"]);
        const orphans = factsOf(traceOf([span("lost", "absent", 1), span("under", "lost", 2)]));
        expect(orphans.lineage("under")).toEqual(["under", "lost"]);
        expect(orphans.lineage("absent")).toEqual([]);
    });
});

describe("same-name groups", () => {
    const wide = traceOf([
        span("root", null, 0),
        span("first", "root", 1),
        ...siblings("row", "root", "import.row", 20, 2, (i) => ({ exit: i === 3 ? "Failure" : "Success" })),
        ...siblings("few", "root", "other", 19, 3),
    ]);

    it("folds 20 siblings with one name under a group at the first member's place, and leaves 19 alone", () => {
        const items = factsOf(wide).siblings("root");
        expect(Arr.map(items, (item) => (item._tag === "One" ? item.spanId : `group ${item.group.name}`))).toEqual([
            "first",
            "group import.row",
            ...Arr.makeBy(19, (i) => `few-${String(i).padStart(3, "0")}`),
        ]);
    });

    it("keeps the members in start order, the failed and interrupted ones as problems, and the envelope", () => {
        const group = Option.getOrThrow(factsOf(wide).groupOf("row-005"));
        expect(group.key).toBe("root|import.row");
        expect(group.members.length).toBe(20);
        expect(group.members[0]).toBe("row-000");
        expect(Array.from(group.problems)).toEqual(["row-003"]);
        expect([group.failed, group.interrupted, group.startMs, group.endMs]).toEqual([1, 0, 2, 22]);
        expect(factsOf(wide).group("root|import.row")).toEqual(Option.some(group));
        expect(factsOf(wide).groupOf("few-001")).toEqual(Option.none());
    });

    it("groups top-level spans and orphans too", () => {
        const top = factsOf(traceOf([...siblings("t", null, "job", 20, 0)]));
        expect(Option.map(top.groupOf("t-004"), (group) => group.key)).toEqual(Option.some("|job"));
        const orphans = factsOf(traceOf([...siblings("o", "gone", "job", 20, 0)]));
        expect(Option.map(orphans.groupOf("o-004"), (group) => group.key)).toEqual(Option.some("gone|job"));
    });

    it("reuses a parent's siblings across publishes that did not touch that parent", () => {
        const index = ingestAll(new Index(), [
            line(record({ span: "root", startMs: 0 })),
            ...Arr.map(siblings("row", "root", "row", 20, 1), line),
            line(record({ span: "other", parent: "root", startMs: 100 })),
        ]);
        const before = index.freeze(status).traces.get("trace-1")!;
        index.ingest(line(record({ span: "late", parent: "other", startMs: 101 })), 99, 9_999, Option.none());
        const after = index.freeze(status).traces.get("trace-1")!;
        expect(after).not.toBe(before);
        const group = (trace: typeof before) => Option.getOrThrow(factsOf(trace).groupOf("row-001"));
        expect(group(after)).toBe(group(before));
    });
});

describe("tree order", () => {
    it("walks depth first from the root, then other top-level spans, then each orphan group", () => {
        const trace = traceOf([
            span("root", null, 1000),
            span("a", "root", 1001),
            span("a1", "a", 1002),
            span("b", "root", 1003),
            span("second", null, 1004),
            span("lost", "absent", 1005),
            span("under", "lost", 1006),
        ]);
        const order = factsOf(trace).order();
        expect(order.ids).toEqual(["root", "a", "a1", "b", "second", "lost", "under"]);
        expect([order.end(order.position("root")), order.end(order.position("a")), order.end(5)]).toEqual([4, 3, 7]);
    });

    it("gathers a group's members at its first member, so the group and each subtree are one range", () => {
        const trace = traceOf([
            span("root", null, 0),
            ...siblings("m", "root", "item", 20, 10, () => ({ ms: 1 })),
            span("between", "root", 15),
            span("child", "m-019", 40),
        ]);
        const order = factsOf(trace).order();
        expect(order.ids[1]).toBe("m-000");
        expect(order.ids.slice(19, 23)).toEqual(["m-018", "m-019", "child", "between"]);
        expect(order.end(order.position("m-019"))).toBe(22);
    });

    it("lists failure origins and interrupted spans as problems, origins alone as origins", () => {
        const order = factsOf(tree).order();
        expect(Arr.map(order.problems, (p) => order.ids[p])).toEqual(["charge", "stop"]);
        expect(Arr.map(order.origins, (p) => order.ids[p])).toEqual(["charge"]);
    });
});
