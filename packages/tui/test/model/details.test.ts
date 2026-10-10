import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { detailsOf, shownAttributes } from "../../src/model/details.ts";
import { clockTime } from "../../src/model/format.ts";
import { lineText } from "../../src/model/text.ts";
import { spanKey, TreeEntry } from "../../src/model/tree.ts";
import { factsOf, groupKey } from "../../src/model/treeFacts.ts";
import { exception, log, record } from "../support/records.ts";
import { indexed } from "../support/store.ts";
import { siblings, span } from "../support/traces.ts";

import type { DetailRow, DetailsEnv } from "../../src/model/details.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const envOf = (records: ReadonlyArray<JsonlSpanRecord>, over: Partial<DetailsEnv> = {}): DetailsEnv => {
    const snapshot = indexed(records);
    const trace = snapshot.traces.get("trace-1");
    if (trace === undefined) {
        throw new Error("no trace");
    }
    return { facts: factsOf(trace), snapshot, now: 1_000, bodyStats: new Map(), width: 80, ...over };
};

const spanEntry = (spanId: string): TreeEntry =>
    TreeEntry.Span({ key: spanKey(spanId), spanId, depth: 0, rails: undefined, last: true, fold: "leaf" });

const texts = (rows: ReadonlyArray<DetailRow>): ReadonlyArray<string> => Arr.map(rows, (row) => lineText(row.line));

describe("the header", () => {
    const records = [
        span("root", null, 1_000, { ms: 40 }),
        span("pay", "root", 1_012.5, {
            ms: 3.25,
            fiber: 5,
            site: { file: "/repo/src/app/pay.ts", line: 10, col: 3 },
            def: { file: "/repo/src/app/defs.ts", line: 4, col: 2 },
        }),
    ];

    it("shows the exit, timing, ids, fiber and source locations", () => {
        expect(texts(detailsOf(spanEntry("pay"), envOf(records)))).toEqual([
            "pay  Success",
            `3.25ms · +12.5ms · ${clockTime(1_012.5, "millis")}`,
            "span pay · parent root · #5",
            "at app/pay.ts:10:3",
            "defined at app/defs.ts:4:2",
        ]);
    });

    it("leaves out the parent of a root, a null fiber and null locations, and hides every empty section", () => {
        expect(texts(detailsOf(spanEntry("root"), envOf(records)))).toEqual([
            "root  Success",
            `40.0ms · +0µs · ${clockTime(1_000, "millis")}`,
            "span root",
        ]);
    });

    it("names the run only when the trace spans several runs", () => {
        const twoRuns = [records[0] ?? span("", null, 0), span("pay", "root", 1_001, { run: "run-2" })];
        expect(texts(detailsOf(spanEntry("pay"), envOf(twoRuns, { now: 1_001 })))).toContain(
            `run api · ${clockTime(1_001)}`,
        );
        expect(Arr.some(texts(detailsOf(spanEntry("pay"), envOf(records))), (text) => text.startsWith("run "))).toBe(
            false,
        );
    });

    it("colours the exit", () => {
        const failed = envOf([span("f", null, 0, { exit: "Failure" }), span("i", null, 1, { exit: "Interrupted" })]);
        expect(detailsOf(spanEntry("f"), failed)[0]?.line[2]).toEqual({ text: "✗ Failure", role: "failure" });
        expect(detailsOf(spanEntry("i"), failed)[0]?.line[2]).toEqual({ text: "⊘ Interrupted", role: "interrupted" });
    });
});

describe("the span sections", () => {
    const load = span("load", null, 1_000, {
        ms: 50,
        exit: "Failure",
        attrs: {
            "span.label": "hidden",
            "status.interrupted": false,
            "req.sha256": "h1",
            "req.bytes": 1_500,
            "req.preview": "line one\nline two",
            "db.rows": 3,
            tags: ["a", "b"],
            nothing: null,
            "a.key": "v",
        },
        events: [
            {
                name: "exception",
                offsetMs: 50,
                attrs: {
                    "exception.type": "RowInvalid",
                    "exception.message": "bad row",
                    "exception.stacktrace": "RowInvalid: bad row\n    at <anonymous> (/r/src/x/load.ts:1:2)",
                },
            },
            { name: "loaded", offsetMs: 2, attrs: { rows: 3 } },
            { ...log("slow", "WARN"), offsetMs: 1, attrs: { ...log("slow", "WARN").attrs, table: "users" } },
        ],
    });
    const missing = new Map([["h1", AsyncResult.success(Option.none<number>())]]);

    it("shows Cause, Bodies, Attributes and Events in order, a blank line between sections", () => {
        expect(texts(detailsOf(spanEntry("load"), envOf([load], { bodyStats: missing })))).toEqual([
            "load  ✗ Failure",
            `50.0ms · +0µs · ${clockTime(1_000, "millis")}`,
            "span load",
            "",
            "Cause",
            "RowInvalid",
            "bad row",
            "thrown at x/load.ts:1:2",
            "",
            "Bodies",
            "req  1.5 KB  line one line two ⚠ missing",
            "",
            "Attributes",
            "a.key  v",
            "db.rows  3",
            "nothing  null",
            'tags  ["a","b"]',
            "",
            "Events (3)",
            "+1.00ms  WARN  slow  table=users",
            "+2.00ms  loaded  rows=3",
            "+50.0ms  exception  RowInvalid: bad row",
        ]);
    });

    it("makes a Bodies row open its body, and keeps its warning when the preview is cut", () => {
        const rows = detailsOf(spanEntry("load"), envOf([load], { bodyStats: missing, width: 30 }));
        const body = Arr.findFirst(rows, (row) => Option.isSome(row.body));
        expect(Option.map(body, (row) => [lineText(row.line), row.body])).toEqual(
            Option.some(["req  1.5 KB  line o… ⚠ missing", Option.some("req")]),
        );
        expect(Option.flatMap(body, (row) => Arr.last(row.line))).toEqual(
            Option.some({ text: " ⚠ missing", role: "warning" }),
        );
        expect(Arr.filter(rows, (row) => Option.isSome(row.body))).toHaveLength(1);
    });

    it("marks a truncated body and leaves a whole or unknown one unmarked", () => {
        const row = (stat: AsyncResult.AsyncResult<Option.Option<number>>) =>
            texts(detailsOf(spanEntry("load"), envOf([load], { bodyStats: new Map([["h1", stat]]) })))[10];
        expect(row(AsyncResult.success(Option.some(700)))).toBe("req  1.5 KB  line one line two ⚠ truncated");
        expect(row(AsyncResult.success(Option.some(1_500)))).toBe("req  1.5 KB  line one line two");
        expect(row(AsyncResult.initial(true))).toBe("req  1.5 KB  line one line two");
    });

    it("colours a log's level", () => {
        const rows = detailsOf(spanEntry("load"), envOf([load]));
        const warn = Arr.findFirst(rows, (row) => lineText(row.line).startsWith("+1.00ms"));
        expect(Option.map(warn, (row) => row.line[1])).toEqual(Option.some({ text: "WARN", role: "logWarn" }));
    });

    it("cuts a long event line with an ellipsis", () => {
        const rows = texts(detailsOf(spanEntry("load"), envOf([load], { width: 20 })));
        expect(rows).toContain("+2.00ms  loaded  ro…");
    });
});

describe("shownAttributes", () => {
    it("hides span.label, status.interrupted and each body's keys, and sorts the rest", () => {
        const s = record({
            span: "s",
            attrs: {
                "z.last": true,
                "span.label": "x",
                "status.interrupted": true,
                "b.sha256": "h",
                "b.bytes": 1,
                "b.preview": "p",
                "c.preview": "not a body",
                "a.first": 1.5,
            },
        });
        expect(shownAttributes(s)).toEqual([
            ["a.first", "1.5"],
            ["c.preview", "not a body"],
            ["z.last", "true"],
        ]);
    });
});

describe("attribute wrapping", () => {
    const rowsFor = (key: string, value: string, width: number) =>
        texts(detailsOf(spanEntry("s"), envOf([span("s", null, 0, { attrs: { [key]: value } })], { width }))).slice(5);

    it("wraps a long value under itself", () => {
        expect(rowsFor("k", "x".repeat(50), 20)).toEqual([
            `k  ${"x".repeat(17)}`,
            `   ${"x".repeat(17)}`,
            `   ${"x".repeat(16)}`,
        ]);
    });

    it("wraps under half the width when the key is long", () => {
        expect(rowsFor("abcdefghijklmno", "0123456789abcdef", 20)).toEqual([
            "abcdefghijklmno  012",
            "          3456789abc",
            "          def",
        ]);
    });

    it("starts each line of a multi-line value on its own row", () => {
        expect(rowsFor("k", "one\ntwo", 20)).toEqual(["k  one", "   two"]);
    });
});

describe("the group summary", () => {
    const records = [
        span("root", null, 0, { exit: "Failure" }),
        ...siblings("row", "root", "import.row", 25, 1, (i) => ({
            ms: i + 1,
            ...(i === 10
                ? { exit: "Interrupted" as const }
                : i >= 3
                  ? { exit: "Failure" as const, events: [exception("RowInvalid", "bad")] }
                  : {}),
        })),
    ];
    const env = envOf(records);
    const group = Option.getOrThrow(env.facts.group(groupKey("root", "import.row")));
    const entry = TreeEntry.Group({
        key: "g",
        group,
        depth: 1,
        rails: undefined,
        last: true,
        open: false,
        shown: [],
    });

    it("counts members by exit, gives the duration spread and lists up to 20 problems", () => {
        const problems = Arr.map(Arr.range(4, 23), (n) =>
            n === 11 ? "⊘ import.row #11" : `✗ import.row #${n}  RowInvalid`,
        );
        expect(texts(detailsOf(entry, env))).toEqual([
            "import.row ×25",
            "3 ok · 21 failed · 1 interrupted",
            "min 1.00ms · p50 13.0ms · p95 24.0ms · max 25.0ms",
            "",
            ...problems,
            "… and 2 more",
        ]);
    });
});

describe("a missing parent", () => {
    it("names the parent and how many spans reference it", () => {
        const env = envOf([span("a", "gone", 1), span("b", "gone", 2), span("c", "lone", 3)]);
        const missing = (parentId: string) =>
            texts(detailsOf(TreeEntry.Missing({ key: "m", parentId, fold: "open" }), env));
        expect(missing("gone")).toEqual(["Missing parent gone", "2 spans reference it."]);
        expect(missing("lone")).toEqual(["Missing parent lone", "1 span references it."]);
    });
});
