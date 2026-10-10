import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet, Option, Order, Schema } from "effect";

import { Index } from "../../src/data/Index.ts";
import { lineText } from "../../src/model/text.ts";
import { headingStats, moreText, traceLayout, traceLine } from "../../src/model/traceLine.ts";
import { collect, pinnedBy, traceList } from "../../src/model/traceList.ts";
import { TraceRow } from "../../src/nav/Screen.ts";
import { parse } from "../../src/query/Query.ts";
import { namedTraces, rootSpan } from "../support/lists.ts";
import { exception, line, record } from "../support/records.ts";
import { indexed, ingestAll, status } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { TraceList, TraceListRow } from "../../src/model/traceList.ts";
import type { TracesView } from "../../src/nav/Screen.ts";

const failing = new Set([3, 7, 11, 15, 19, 22]);
const orders = namedTraces("o", "POST /orders", 25, 10_000, failing);
const health = [
    rootSpan("h1", "GET /health", 5_000),
    rootSpan("h2", "GET /health", 20_500),
    rootSpan("h3", "GET /health", 60_000),
];
const snapshot = indexed([...orders, ...health]);

const build = (
    over: Partial<TracesView> = {},
    filter = "",
    source: Snapshot = snapshot,
    pinned: Option.Option<string> = Option.none(),
): TraceList => {
    const view = { sort: "start" as const, reverse: false, openGroups: HashSet.empty<string>(), ...over };
    const collected = Option.getOrThrow(collect(source, "run-1", view, filter, Option.none()));
    return traceList(collected, view.openGroups, pinned);
};

const label = (row: TraceListRow): string => {
    switch (row._tag) {
        case "Trace":
            return `${row.member ? "  " : ""}${row.item.trace.id}`;
        case "Heading":
            return `▸ ${row.group.name}`;
        case "More":
            return `⋯ ${row.group.name}`;
    }
};
const labels = (list: TraceList) => Arr.map(list.rows, label);

describe("groups", () => {
    it("folds a name with 20 or more traces, keeps a smaller name flat, and starts closed", () => {
        expect(labels(build())).toEqual([
            "h1",
            "▸ POST /orders",
            "  o003",
            "  o007",
            "  o011",
            "  o015",
            "  o019",
            "⋯ POST /orders",
            "h2",
            "h3",
        ]);
        const nineteen = build({}, "", indexed([...namedTraces("o", "POST /orders", 19, 10_000), ...health]));
        expect(Arr.filter(nineteen.rows, (row) => row._tag !== "Trace")).toEqual([]);
        const twenty = build({}, "", indexed([...namedTraces("o", "POST /orders", 20, 10_000), ...health]));
        expect(
            Arr.map(
                Arr.filter(twenty.rows, (row) => row._tag !== "Trace"),
                label,
            ),
        ).toEqual(["▸ POST /orders", "⋯ POST /orders"]);
    });

    it("counts a group over every trace in the run, whatever the filter", () => {
        const list = build({}, "o02");
        expect(labels(list)).toEqual(["▸ POST /orders", "  o022", "⋯ POST /orders"]);
        const heading = list.rows[0];
        expect(heading?._tag === "Heading" && heading.group.all).toBe(25);
        expect(lineText(traceLine(heading!, context(list, true), false))).toContain("▸ POST /orders ×5 (of 25)");
    });

    it("places a group at its first member in sort order, and drops a group with no matching member", () => {
        expect(labels(build({ reverse: true }))).toEqual([
            "h3",
            "▸ POST /orders",
            "  o022",
            "  o019",
            "  o015",
            "  o011",
            "  o007",
            "⋯ POST /orders",
            "h2",
            "h1",
        ]);
        expect(labels(build({}, "health"))).toEqual(["h1", "h2", "h3"]);
    });

    it("shows every member of an open group", () => {
        const list = build({ openGroups: HashSet.make("POST /orders") });
        expect(Arr.filter(list.rows, (row) => row._tag === "Trace" && row.member).length).toBe(25);
        expect(Arr.some(list.rows, (row) => row._tag === "More")).toBe(false);
    });

    it("counts what the more row hides by state, leaving zero counts out", () => {
        const more = Arr.findFirst(build().rows, (row) => row._tag === "More");
        expect(Option.map(more, (row) => (row._tag === "More" ? moreText(row.group.hidden) : ""))).toEqual(
            Option.some("⋯ 1 more failed · 19 ok"),
        );
        const trace = snapshot.traces.get("h1")!;
        const states = ["ok", "partial", "recovered", "running", "interrupted", "failed"] as const;
        expect(moreText(Arr.map(states, (state) => ({ trace, state, key: "t:h1", headName: trace.headName })))).toBe(
            "⋯ 1 more failed · 1 interrupted · 1 running · 1 recovered · 1 partial · 1 ok",
        );
    });

    it("shows a closed group's running members under its heading", () => {
        const at = 1_760_000_000_000;
        const live = ingestAll(
            new Index(),
            Arr.map(
                [
                    ...namedTraces("j", "job", 20, 10_000),
                    record({ span: "x-child", trace: "x", parent: "gone", name: "job", startMs: 40_000 }),
                ],
                line,
            ),
            Option.some(at),
        ).freeze({ ...status, phase: "following", lastRecordAt: Option.some(at) });
        const collected = Option.getOrThrow(
            collect(live, "run-1", { sort: "start", reverse: false }, "", Option.some(at + 1000)),
        );
        expect(labels(traceList(collected, HashSet.empty(), Option.none()))).toEqual(["▸ job", "  x", "⋯ job"]);
    });
});

describe("stops and following", () => {
    it("stops at problem rows and at a more row only while it hides a problem", () => {
        const list = build();
        expect(Arr.map(list.stops, (i) => label(list.rows[i]!))).toEqual([
            "  o003",
            "  o007",
            "  o011",
            "  o015",
            "  o019",
            "⋯ POST /orders",
        ]);
        const clean = build(
            {},
            "",
            indexed([...namedTraces("o", "POST /orders", 25, 10_000, new Set([1])), ...health]),
        );
        expect(Arr.map(clean.stops, (i) => label(clean.rows[i]!))).toEqual(["  o001"]);
    });

    it("follows the newest matching trace, or the heading of the closed group hiding it", () => {
        expect(label(build().rows[build().followIndex]!)).toBe("h3");
        expect(label(build({}, "post").rows[build({}, "post").followIndex]!)).toBe("▸ POST /orders");
        const open = build({ openGroups: HashSet.make("POST /orders") }, "post");
        expect(label(open.rows[open.followIndex]!)).toBe("  o024");
    });
});

describe("the pinned selection", () => {
    it("pins only a member a closed group hides, and shows it under the heading", () => {
        const collected = Option.getOrThrow(
            collect(snapshot, "run-1", { sort: "start", reverse: false }, "", Option.none()),
        );
        const select = (traceId: string) => Option.some(TraceRow.Trace({ traceId }));
        expect(pinnedBy(collected, HashSet.empty(), select("o010"))).toEqual(Option.some("o010"));
        expect(pinnedBy(collected, HashSet.empty(), select("o003")), "already shown").toEqual(Option.none());
        expect(pinnedBy(collected, HashSet.empty(), select("h2")), "not a member").toEqual(Option.none());
        expect(pinnedBy(collected, HashSet.make("POST /orders"), select("o010")), "open").toEqual(Option.none());
        const list = build({}, "", snapshot, Option.some("o010"));
        expect(labels(list).slice(1, 5)).toEqual(["▸ POST /orders", "  o003", "  o007", "  o010"]);
        const more = Arr.findFirst(list.rows, (row) => row._tag === "More");
        expect(Option.map(more, (row) => (row._tag === "More" ? moreText(row.group.hidden) : ""))).toEqual(
            Option.some("⋯ 1 more failed · 18 ok"),
        );
    });
});

describe("sorts", () => {
    it("orders by duration, failures and spans, breaking ties on start", () => {
        const source = indexed([
            rootSpan("a", "x", 1000, "Success", { ms: 5 }),
            rootSpan("b", "y", 2000, "Failure", { ms: 50 }),
            rootSpan("c", "z", 3000, "Success", { ms: 50 }),
        ]);
        expect(labels(build({ sort: "duration" }, "", source))).toEqual(["b", "c", "a"]);
        expect(labels(build({ sort: "failures" }, "", source))).toEqual(["b", "a", "c"]);
        expect(build({ sort: "duration" }, "", source).timeSort).toBe(false);
    });

    it("breaks a failures tie on the root's exit by failed spans", () => {
        const failedChild = (trace: string, n: number) =>
            record({ span: `${trace}-c${n}`, trace, parent: `${trace}-root`, startMs: 1500, exit: "Failure" });
        const source = indexed([
            rootSpan("one", "x", 1000),
            failedChild("one", 1),
            rootSpan("two", "y", 2000),
            failedChild("two", 1),
            failedChild("two", 2),
        ]);
        expect(labels(build({ sort: "failures" }, "", source))).toEqual(["two", "one"]);
    });
});

describe("headings", () => {
    it("shows the p50 duration, failed traces and the most common error by type", () => {
        const errors = [
            rootSpan("e1", "job", 1000, "Failure", { ms: 10, events: [exception("PaymentDeclined", "a")] }),
            rootSpan("e2", "job", 2000, "Failure", { ms: 30, events: [exception("PaymentDeclined", "b")] }),
            rootSpan("e3", "job", 3000, "Failure", { ms: 20, events: [exception("Timeout", "c")] }),
        ];
        const source = indexed([...errors, ...namedTraces("j", "job", 17, 10_000)]);
        const heading = build({}, "", source).rows[0]!;
        expect(heading._tag).toBe("Heading");
        const stats = heading._tag === "Heading" ? headingStats(heading.group) : undefined;
        expect(stats).toMatchObject({ p50Ms: 10, failedTraces: 3, error: "2× PaymentDeclined · 1 other error" });
    });

    it("takes the lower middle duration as the p50 of an even count", () => {
        const p50 = (count: number) => {
            const source = indexed(
                Array.from({ length: count }, (_, i) => rootSpan(`d${i}`, "job", 1000 + i, "Success", { ms: i + 1 })),
            );
            const heading = build({}, "", source).rows[0]!;
            return heading._tag === "Heading" ? headingStats(heading.group).p50Ms : -1;
        };
        expect(p50(20)).toBe(10);
        expect(p50(21)).toBe(11);
    });

    it.prop(
        "takes the lower middle of the sorted durations, ties and any order included",
        [Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 }))).check(Schema.isMinLength(20))],
        ([durations]) => {
            const source = indexed(
                Arr.map(durations, (ms, i) => rootSpan(`d${i}`, "job", 1000 + i, "Success", { ms })),
            );
            const heading = build({}, "", source).rows[0]!;
            const sorted = Arr.sort(durations, Order.Number);
            expect(heading._tag === "Heading" ? headingStats(heading.group).p50Ms : -1).toBe(
                sorted[Math.floor((sorted.length - 1) / 2)],
            );
        },
    );
});

describe("highlights", () => {
    const highlighted = (row: TraceListRow, list: TraceList) =>
        Arr.map(
            Arr.filter(traceLine(row, context(list, true), false), (chunk) => chunk.bg === "matchBg"),
            (chunk) => chunk.text,
        );

    it("highlights the match in an indented member and after a heading's arrow", () => {
        const list = build({}, "orders");
        const member = Arr.findFirst(list.rows, (row) => row._tag === "Trace" && row.member);
        expect(Option.map(member, (row) => highlighted(row, list))).toEqual(Option.some(["orders"]));
        expect(highlighted(list.rows[0]!, list)).toEqual(["orders"]);
    });

    it("highlights a partial trace's root span and the error column", () => {
        const source = indexed([
            record({ span: "c", trace: "p1", parent: "gone", name: "payment.charge", startMs: 1000 }),
            rootSpan("f1", "checkout", 2000, "Failure", { events: [exception("PaymentDeclined", "card declined")] }),
        ]);
        const partial = build({}, "payment", source);
        expect(Arr.map(partial.rows, (row) => highlighted(row, partial))).toEqual([["payment"], ["Payment"]]);
        const declined = build({}, "card", source);
        expect(Arr.map(declined.rows, (row) => highlighted(row, declined))).toEqual([["card"]]);
    });
});

const context = (list: TraceList, filtered: boolean) => ({
    placed: traceLayout(120),
    run: list.run,
    query: filtered ? parse(list.filter) : [],
    filtered,
    width: 120,
});
