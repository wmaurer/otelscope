import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet, Option, Schema } from "effect";

import {
    causeLine,
    cursorEntry,
    logCount,
    logLine,
    logList,
    logsOf,
    logsTitle,
    scopedLogs,
} from "../../src/model/logs.ts";
import { lineText } from "../../src/model/text.ts";
import { flatten } from "../../src/model/tree.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { parse } from "../../src/query/Query.ts";
import { exception, log } from "../support/records.ts";
import { siblings, span, traceOf } from "../support/traces.ts";

import type { Trace } from "../../src/data/Snapshot.ts";
import type { LogEntry } from "../../src/model/logs.ts";
import type { TreeEntry } from "../../src/model/tree.ts";
import type { LogCursor, LogScope } from "../../src/nav/Screen.ts";
import type { JsonlSpanEvent } from "@wmaurer/otelscope-effect/format";

const at = (offsetMs: number, event: JsonlSpanEvent): JsonlSpanEvent => ({ ...event, offsetMs });

const declined: JsonlSpanEvent = {
    name: "payment failed",
    offsetMs: 5,
    attrs: {
        "effect.logLevel": "ERROR",
        "effect.fiberId": 7,
        "effect.cause": "PaymentDeclined: \n    at <anonymous> (fixture/scenarios.ts:110:46)",
        "order.id": "ord_1004",
        "retry.count": 2,
    },
};

// Tree order: root, b, a, a1. Time order: root 1000, b 1007, a 1015, a1 1020, root 1030.
const trace = traceOf([
    span("root", null, 1000, { events: [log("starting"), at(30, log("root late", "WARN"))] }),
    span("a", "root", 1010, { name: "payment.charge", events: [exception("PaymentDeclined", ""), declined] }),
    span("a1", "a", 1020, { events: [{ name: "marker", offsetMs: 0, attrs: {} }, log("deep", "DEBUG")] }),
    span("b", "root", 1005, { events: [at(2, log('["rows", 3, {"ok":true}, null]', "TRACE"))] }),
]);

const facts = factsOf(trace);
const keysOf = (logs: ReadonlyArray<LogEntry>) => Arr.map(logs, (entry) => entry.key);
const spanRow = (trace: Trace, spanId: string): Option.Option<TreeEntry> =>
    Arr.findFirst(
        flatten(factsOf(trace), { folded: HashSet.empty(), openGroups: HashSet.empty(), pins: [] }).rows,
        (row) => row._tag === "Span" && row.spanId === spanId,
    );
const rowWithKey = (trace: Trace, key: string): Option.Option<TreeEntry> =>
    Arr.findFirst(
        flatten(factsOf(trace), { folded: HashSet.empty(), openGroups: HashSet.empty(), pins: [] }).rows,
        (row) => row.key === key,
    );
const entryWithKey = (key: string): LogEntry => {
    const found = Arr.findFirst(logsOf(facts).all, (entry) => entry.key === key);
    if (found._tag === "None") {
        throw new Error(`no log ${key}`);
    }
    return found.value;
};

describe("logsOf", () => {
    it("takes only events with a log level, ordered by absolute time across spans", () => {
        expect(keysOf(logsOf(facts).all)).toEqual(["root:0", "b:0", "a:1", "a1:1", "root:1"]);
        expect(Arr.map(logsOf(facts).all, (entry) => entry.atMs)).toEqual([1000, 1007, 1015, 1020, 1030]);
    });

    it("flattens a log: JSON-array message, fiber, annotations minus level, fiber and cause, the cause's first line", () => {
        const charged = entryWithKey("a:1");
        expect(charged).toMatchObject({
            message: "payment failed",
            level: "ERROR",
            fiber: "#7",
            spanName: "payment.charge",
            annotations: [
                ["order.id", "ord_1004"],
                ["retry.count", "2"],
            ],
            exit: "Success",
            position: 2,
        });
        expect(charged.cause).toEqual(Option.some("PaymentDeclined: "));
        const rows = entryWithKey("b:0");
        expect(rows.message).toBe('rows 3 {"ok":true} null');
        expect(rows.cause).toEqual(Option.none());
        expect(entryWithKey("root:0").annotations).toEqual([]);
    });

    it("keeps a name that only looks like an array as it is", () => {
        const odd = factsOf(traceOf([span("x", null, 0, { events: [log("[not json"), log('{"a":1}')] })]));
        expect(Arr.map(logsOf(odd).all, (entry) => entry.message)).toEqual(["[not json", '{"a":1}']);
    });

    it("leaves the fiber empty when the log carries none", () => {
        const bare = factsOf(
            traceOf([
                span("x", null, 0, { events: [{ name: "hi", offsetMs: 0, attrs: { "effect.logLevel": "INFO" } }] }),
            ]),
        );
        expect(Arr.map(logsOf(bare).all, (entry) => entry.fiber)).toEqual([""]);
    });
});

describe("scopedLogs", () => {
    const scoped = (spanId: string, scope: LogScope) => keysOf(scopedLogs(facts, spanRow(trace, spanId), scope));

    it("gives a span's own logs, its subtree's, or the whole trace's", () => {
        expect(scoped("a", "span")).toEqual(["a:1"]);
        expect(scoped("a", "subtree")).toEqual(["a:1", "a1:1"]);
        expect(scoped("a", "trace")).toEqual(["root:0", "b:0", "a:1", "a1:1", "root:1"]);
        expect(scoped("root", "span")).toEqual(["root:0", "root:1"]);
        expect(scoped("root", "subtree")).toEqual(["root:0", "b:0", "a:1", "a1:1", "root:1"]);
        expect(keysOf(scopedLogs(facts, Option.none(), "span")), "no selection shows all").toEqual(
            keysOf(logsOf(facts).all),
        );
    });

    const grouped = traceOf([
        span("root", null, 0),
        ...siblings("item", "root", "item.process", 20, 1, (i) => ({
            events: i === 0 || i === 19 ? [at(i === 0 ? 30 : 0, log(`item ${i}`))] : [],
        })),
        span("child", "item-005", 100, { events: [log("under item 5")] }),
        span("after", "root", 200, { events: [log("not in the group")] }),
    ]);
    const groupRow = rowWithKey(grouped, "g:root|item.process");

    it("gives a group row its members' own logs, or with subtree their descendants' too", () => {
        expect(groupRow._tag).toBe("Some");
        expect(keysOf(scopedLogs(factsOf(grouped), groupRow, "span"))).toEqual(["item-019:0", "item-000:0"]);
        expect(keysOf(scopedLogs(factsOf(grouped), groupRow, "subtree"))).toEqual([
            "item-019:0",
            "item-000:0",
            "child:0",
        ]);
    });

    const orphans = traceOf([
        span("o1", "gone", 10, { events: [at(5, log("o1 log"))] }),
        span("o2", "gone", 12, { events: [log("o2 log")] }),
        span("o1c", "o1", 20, { events: [log("o1 child log")] }),
        span("other", null, 0, { events: [log("elsewhere")] }),
    ]);
    const missingRow = rowWithKey(orphans, "m:gone");

    it("gives a missing-parent row its orphans' own logs, or their subtrees", () => {
        expect(missingRow._tag).toBe("Some");
        expect(keysOf(scopedLogs(factsOf(orphans), missingRow, "span"))).toEqual(["o2:0", "o1:0"]);
        expect(keysOf(scopedLogs(factsOf(orphans), missingRow, "subtree"))).toEqual(["o2:0", "o1:0", "o1c:0"]);
    });
});

describe("logList", () => {
    const root = spanRow(trace, "root");
    const list = (filter: string, scope: LogScope = "subtree") => logList(facts, root, scope, filter);

    it("filters within the scope by level, text and key=value, with smart case", () => {
        expect(keysOf(list("is:error").entries)).toEqual(["a:1"]);
        expect(keysOf(list("is:error", "span").entries)).toEqual([]);
        expect(keysOf(list("late").entries)).toEqual(["root:1"]);
        expect(keysOf(list("order.id=1004").entries)).toEqual(["a:1"]);
        expect(keysOf(list("rows").entries)).toEqual(["b:0"]);
        expect(keysOf(list("Rows").entries), "a capital makes it case-sensitive").toEqual([]);
        expect(keysOf(list("warn").entries), "lowercase matches the level WARN").toEqual(["root:1"]);
        expect([list("is:error").inScope, list("").inScope]).toEqual([5, 5]);
    });

    it("adds a cause row under an entry with a cause, and maps entries to their rows", () => {
        const all = list("");
        expect(Arr.map(all.rows, (row) => `${row._tag} ${row.key}`)).toEqual([
            "Entry root:0",
            "Entry b:0",
            "Entry a:1",
            "Cause a:1#cause",
            "Entry a1:1",
            "Entry root:1",
        ]);
        expect(all.entryRow).toEqual([0, 1, 2, 4, 5]);
    });

    it("finds a cursor's entry, and -1 for one filtered out, out of scope or unknown", () => {
        expect(list("").entryIndex("a1:1")).toBe(3);
        expect(list("").entryIndex("root:1")).toBe(4);
        expect(list("is:error").entryIndex("a1:1")).toBe(-1);
        expect(logList(facts, spanRow(trace, "a"), "span", "").entryIndex("root:0")).toBe(-1);
        expect(list("").entryIndex("a:0"), "an exception event is not a log").toBe(-1);
        expect(list("").entryIndex("nowhere:0")).toBe(-1);
    });
});

describe("cursorEntry", () => {
    const shown = (filter: string, scope: LogScope = "trace") => logList(facts, Option.none(), scope, filter);
    const cursor = (key: LogCursor) => Option.some(key);

    it("is the cursor's entry when it is shown", () => {
        expect(cursorEntry(shown(""), facts, cursor("a:1"))).toBe(2);
    });

    it("falls back to the first entry at or after the cursor log's time, then to the last", () => {
        const warnAndError = shown("is:warn");
        expect(keysOf(warnAndError.entries)).toEqual(["root:1"]);
        expect(cursorEntry(warnAndError, facts, cursor("b:0")), "b:0 is at 1007, root:1 after it").toBe(0);
        const early = logList(facts, spanRow(trace, "b"), "subtree", "");
        expect(keysOf(early.entries)).toEqual(["b:0"]);
        expect(cursorEntry(early, facts, cursor("root:1")), "nothing after 1030: the last").toBe(0);
        const twoLogs = logList(facts, spanRow(trace, "a"), "subtree", "");
        expect(cursorEntry(twoLogs, facts, cursor("b:0"))).toBe(0);
        expect(cursorEntry(twoLogs, facts, cursor("root:1"))).toBe(1);
        expect(cursorEntry(twoLogs, facts, cursor("gone:3")), "a log not in the trace: the last").toBe(1);
    });

    it("is 0 without a cursor and -1 without entries", () => {
        expect(cursorEntry(shown(""), facts, Option.none())).toBe(0);
        expect(cursorEntry(shown("nothing-matches"), facts, cursor("a:1"))).toBe(-1);
        expect(cursorEntry(shown("nothing-matches"), facts, Option.none())).toBe(-1);
    });
});

describe("logLine and causeLine", () => {
    it("lays out offset, level, fiber, span, message and annotations", () => {
        expect(lineText(logLine(entryWithKey("a:1"), [], trace.startMs, 200))).toBe(
            " +15.0ms  ERROR  #7    payment.charge        payment failed  order.id=ord_1004 retry.count=2",
        );
        expect(lineText(logLine(entryWithKey("root:0"), [], trace.startMs, 200))).toBe(
            "    +0µs  INFO   #1    root                  starting",
        );
    });

    it("cuts the span name to 20 cells and the line to the width", () => {
        const long = factsOf(
            traceOf([span("x", null, 0, { name: "a.very.long.span.name.indeed", events: [log("hello")] })]),
        );
        const [entry] = logsOf(long).all;
        if (entry === undefined) {
            throw new Error("no log");
        }
        expect(lineText(logLine(entry, [], 0, 200))).toContain("a.very.long.span.na…  hello");
        expect(lineText(logLine(entry, [], 0, 20))).toBe("    +0µs  INFO   #1…");
    });

    it("colours the level by its role, FATAL bold, and annotations muted", () => {
        const levelOf = (entry: LogEntry) =>
            Arr.findFirst(logLine(entry, [], 0, 200), (part) => part.text === entry.level);
        expect(Option.map(levelOf(entryWithKey("a:1")), (part) => [part.role, part.bold])).toEqual(
            Option.some(["logError", undefined]),
        );
        const fatal = { ...entryWithKey("a:1"), level: "FATAL" as const };
        expect(Option.map(levelOf(fatal), (part) => [part.role, part.bold])).toEqual(Option.some(["logFatal", true]));
        const annotation = Arr.findFirst(logLine(entryWithKey("a:1"), [], 0, 200), (part) =>
            part.text.startsWith("order.id="),
        );
        expect(Option.map(annotation, (part) => part.role)).toEqual(Option.some("muted"));
    });

    it("highlights the text the filter matches", () => {
        const line = logLine(entryWithKey("a:1"), parse("pay is:error ord_"), 1000, 200);
        expect(
            Arr.map(
                Arr.filter(line, (part) => part.bg === "matchBg"),
                (part) => part.text,
            ),
        ).toEqual(["pay", "pay", "ord_"]);
    });

    it("draws the cause under the message, a typed error with an empty message as (no message)", () => {
        const text = lineText(causeLine(entryWithKey("a:1"), 200));
        expect(text).toBe(`${" ".repeat(45)}↳ PaymentDeclined: (no message)`);
        expect(text.indexOf("↳")).toBe(lineText(logLine(entryWithKey("a:1"), [], 1000, 200)).indexOf("payment failed"));
        const withMessage = { ...entryWithKey("a:1"), cause: Option.some("Error: card declined") };
        expect(lineText(causeLine(withMessage, 200)).trim()).toBe("↳ Error: card declined");
        expect(lineText(causeLine(withMessage, 50))).toBe(`${" ".repeat(45)}↳ Er…`);
    });
});

describe("logsTitle and logCount", () => {
    it("shows the count and scope, and the filtered count with a filter", () => {
        const root = spanRow(trace, "root");
        expect(logsTitle(logList(facts, root, "subtree", ""))).toBe("3 Logs · 5 · subtree");
        expect(logsTitle(logList(facts, root, "span", ""))).toBe("3 Logs · 2 · span");
        expect(logsTitle(logList(facts, root, "trace", "is:error"))).toBe("3 Logs · 1 of 5 · trace");
        expect(logCount(logList(facts, root, "trace", "is:error"))).toBe("1 of 5 logs");
        expect(logCount(logList(facts, spanRow(trace, "a"), "span", ""))).toBe("1 of 1 log");
    });
});

const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const Seed = Schema.Struct({
    parent: between(-2, 30),
    name: between(0, 2),
    startMs: between(0, 9),
    offsets: Schema.Array(between(0, 5)).check(Schema.isMaxLength(3)),
});

// A parent always comes earlier in the seed list, so the records form a forest, with orphans under "gone".
const traceFromSeeds = (seeds: ReadonlyArray<typeof Seed.Type>): Trace =>
    traceOf(
        Arr.map(seeds, (seed, i) =>
            span(
                `s${String(i).padStart(2, "0")}`,
                seed.parent === -1 || seed.parent >= i
                    ? null
                    : seed.parent === -2
                      ? "gone"
                      : `s${String(seed.parent).padStart(2, "0")}`,
                seed.startMs,
                { name: `n${seed.name}`, events: Arr.map(seed.offsets, (offsetMs) => at(offsetMs, log("x"))) },
            ),
        ),
    );

describe("TraceLogs.range", () => {
    it.prop(
        "equals filtering all by position, for every subtree and every single span",
        [Schema.Array(Seed).check(Schema.isMinLength(1), Schema.isMaxLength(40))],
        ([seeds]) => {
            const randomFacts = factsOf(traceFromSeeds(seeds));
            const order = randomFacts.order();
            const logs = logsOf(randomFacts);
            for (let position = 0; position < order.ids.length; position++) {
                for (const end of [position + 1, order.end(position)]) {
                    expect(keysOf(logs.range(position, end))).toEqual(
                        keysOf(Arr.filter(logs.all, (entry) => entry.position >= position && entry.position < end)),
                    );
                }
            }
        },
    );
});
