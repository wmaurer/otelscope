import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { Index } from "../../src/data/Index.ts";
import { logMatches, runMatches, spanMatches, traceMatches, traceScans } from "../../src/query/Match.ts";
import { parse } from "../../src/query/Query.ts";
import { exception, line, log, record } from "../support/records.ts";
import { indexed, status } from "../support/store.ts";

import type { LogLine } from "../../src/query/Match.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const span = record({
    span: "span-abc",
    trace: "trace-xyz",
    name: "payment.charge",
    service: "shop-api",
    exit: "Failure",
    fiber: 17,
    site: { file: "src/checkout/pay.ts", line: 3, col: 1 },
    def: { file: "src/defs/charge.ts", line: 9, col: 1 },
    attrs: {
        "http.route": "/orders/:id",
        "retry.count": 3,
        "card.saved": true,
        tags: ["eu", "beta"],
        "llm.request.preview": "summarise the ticket",
        "llm.request.sha256": "deadbeefcafe",
        "llm.request.bytes": 4096,
    },
    events: [exception("PaymentDeclined", "insufficient funds"), log("charging card", "WARN")],
});

const matches = (query: string, target: JsonlSpanRecord = span) => spanMatches(parse(query), target);

describe("spanMatches", () => {
    it("matches each searchable field of a span", () => {
        const found = [
            "payment.charge",
            "span-abc",
            "trace-xyz",
            "shop-api",
            "checkout/pay",
            "defs/charge",
            "#17",
            "http.route",
            "orders",
            "3",
            "true",
            "beta",
            "summarise",
            "PaymentDeclined",
            "insufficient",
            "charging",
            "effect.loglevel",
        ];
        for (const query of found) {
            expect(matches(query), query).toBe(true);
        }
        expect(matches("nothing-here")).toBe(false);
    });

    it("reads a body only through its preview", () => {
        expect(matches("deadbeef")).toBe(false);
        expect(matches("4096")).toBe(false);
        expect(matches("sha256")).toBe(false);
    });

    it("needs the exact key for key=value, matches a key's presence, and looks in events too", () => {
        expect(matches("http.route=/orders")).toBe(true);
        expect(matches("route=/orders"), "the key must be exact").toBe(false);
        expect(matches("http.route=/carts")).toBe(false);
        expect(matches("retry.count=3")).toBe(true);
        expect(matches("tags=eu")).toBe(true);
        expect(matches("http.route=")).toBe(true);
        expect(matches("http.method=")).toBe(false);
        expect(matches("exception.type=Declined")).toBe(true);
        expect(matches("exception.type=declined"), "lowercase ignores case").toBe(true);
        expect(matches("exception.type=DECLINED"), "a capital makes it case-sensitive").toBe(false);
    });

    it("applies smart case to plain terms", () => {
        expect(matches("SHOP")).toBe(false);
        expect(matches("paymentdeclined")).toBe(true);
    });

    it("takes a lowercase term's characters literally, and folds case beyond ASCII", () => {
        const odd = record({ span: "odd", name: "f(x) [a+b] 1.5 c\\d", attrs: { city: "ZÜRICH" } });
        expect(matches("f(x)", odd)).toBe(true);
        expect(matches("[a+b]", odd)).toBe(true);
        expect(matches("1.5", odd)).toBe(true);
        expect(matches("c\\d", odd)).toBe(true);
        const lookalike = record({ span: "lookalike", name: "1x5 aab" });
        expect(matches("1.5", lookalike), "a dot is not a wildcard").toBe(false);
        expect(matches("a+b", lookalike), "a plus is not a repeat").toBe(false);
        expect(matches("zürich", odd)).toBe(true);
    });

    it("looks a key=value key up among the span's own attributes only", () => {
        for (const query of ["constructor=x", "constructor=", "toString=", "__proto__=", "hasOwnProperty=own"]) {
            expect(matches(query), query).toBe(false);
        }
        const own = record({ span: "own", attrs: { constructor: "x" } });
        expect(matches("constructor=x", own)).toBe(true);
        expect(matches("constructor=", own)).toBe(true);
    });

    it("matches is: against the exit, and never a log level or an unknown value", () => {
        expect(matches("is:failed")).toBe(true);
        expect(matches("is:ok")).toBe(false);
        expect(matches("is:warn"), "a span never matches a level").toBe(false);
        expect(matches("is:bogus")).toBe(false);
    });

    it("needs every term to match the one span", () => {
        expect(matches("payment is:failed")).toBe(true);
        expect(matches("payment is:ok")).toBe(false);
    });
});

describe("traceMatches and runMatches", () => {
    const snapshot = indexed([
        record({ span: "root", trace: "t1", name: "POST /orders", attrs: { "http.route": "/orders" } }),
        record({ span: "child", trace: "t1", parent: "root", name: "db.query", exit: "Failure", startMs: 1001 }),
        record({ span: "other", trace: "t2", name: "GET /health" }),
        record({ span: "far", trace: "t3", name: "shared", run: "run-1" }),
        record({ span: "near", trace: "t3", name: "payment", run: "run-2", startMs: 1002 }),
    ]);
    const trace = (id: string) => snapshot.traces.get(id)!;
    const run = (id: string) => snapshot.runs.get(id)!;

    it("lets each term of a trace query match a different span", () => {
        expect(traceMatches(parse("is:failed http.route=/orders"), trace("t1"))).toBe(true);
        expect(traceMatches(parse("is:failed http.route=/orders"), trace("t2"))).toBe(false);
        expect(spanMatches(parse("is:failed http.route=/orders"), trace("t1").spans.get("root")!)).toBe(false);
    });

    it("matches a run by its id or by its own spans only", () => {
        expect(runMatches(parse("run-2"), run("run-2"), snapshot.traces)).toBe(true);
        expect(runMatches(parse("payment"), run("run-2"), snapshot.traces)).toBe(true);
        expect(runMatches(parse("payment"), run("run-1"), snapshot.traces), "the span is run-2's").toBe(false);
        expect(runMatches(parse("shared"), run("run-1"), snapshot.traces)).toBe(true);
        expect(runMatches(parse("shared"), run("run-2"), snapshot.traces)).toBe(false);
    });

    it("rescans only a trace a publish replaced", () => {
        const index = new Index();
        index.ingest(line(record({ span: "a", trace: "t1", name: "alpha" })), 1, 0, Option.none());
        index.ingest(line(record({ span: "b", trace: "t2", name: "beta" })), 2, 100, Option.none());
        const first = index.freeze(status);
        const query = parse("gamma-unique");
        expect(traceMatches(query, first.traces.get("t1")!)).toBe(false);
        expect(traceMatches(query, first.traces.get("t2")!)).toBe(false);
        const before = traceScans();
        index.ingest(line(record({ span: "c", trace: "t1", name: "gamma-unique-x" })), 3, 200, Option.none());
        const second = index.freeze(status);
        expect(second.traces.get("t2"), "t2 is untouched").toBe(first.traces.get("t2"));
        expect(traceMatches(query, second.traces.get("t2")!)).toBe(false);
        expect(traceMatches(query, second.traces.get("t1")!), "the new span matches").toBe(true);
        expect(traceScans() - before, "only t1 was walked again").toBe(1);
    });
});

const logLine: LogLine = {
    message: "payment failed",
    level: "ERROR",
    fiber: "#7",
    spanName: "payment.charge",
    annotations: [["order.id", "ord_1004"]],
    exit: "Failure",
};

const logMatchesQuery = (query: string, line: LogLine = logLine) => logMatches(parse(query), line);

describe("logMatches", () => {
    it("matches a plain term on the message, level, fiber, span name and annotations only", () => {
        for (const query of ["payment", "failed", "error", "#7", "charge", "order.id", "ord_1004"]) {
            expect(logMatchesQuery(query), query).toBe(true);
        }
        expect(logMatchesQuery("Failure"), "the exit is not text").toBe(false);
        expect(logMatchesQuery("#8")).toBe(false);
        expect(logMatchesQuery("#", { ...logLine, fiber: "" }), "a line without a fiber has no #").toBe(false);
    });

    it("applies smart case to the line's text", () => {
        expect(logMatchesQuery("payment")).toBe(true);
        expect(logMatchesQuery("PAYMENT"), "a capital makes it case-sensitive").toBe(false);
        expect(logMatchesQuery("ERROR")).toBe(true);
        expect(logMatchesQuery("Error")).toBe(false);
        expect(logMatchesQuery("order.id=ORD"), "values follow smart case too").toBe(false);
        expect(logMatchesQuery("order.id=ord")).toBe(true);
    });

    it("needs an annotation with the exact key for key=value, and matches a key's presence with key=", () => {
        expect(logMatchesQuery("order.id=1004")).toBe(true);
        expect(logMatchesQuery("order=1004"), "the key must be exact").toBe(false);
        expect(logMatchesQuery("order.id=1005")).toBe(false);
        expect(logMatchesQuery("order.id=")).toBe(true);
        expect(logMatchesQuery("user.id=")).toBe(false);
    });

    it("matches is:<level> against the level and is:<exit> against the span's exit", () => {
        expect(logMatchesQuery("is:error")).toBe(true);
        expect(logMatchesQuery("is:warn")).toBe(false);
        expect(logMatchesQuery("is:fatal", { ...logLine, level: "FATAL" })).toBe(true);
        expect(logMatchesQuery("is:failed")).toBe(true);
        expect(logMatchesQuery("is:ok")).toBe(false);
        expect(logMatchesQuery("is:bogus"), "an unknown is: value matches nothing").toBe(false);
    });

    it("needs every term to match", () => {
        expect(logMatchesQuery("is:error payment order.id=ord")).toBe(true);
        expect(logMatchesQuery("is:error refund")).toBe(false);
        expect(logMatchesQuery("")).toBe(true);
    });
});
