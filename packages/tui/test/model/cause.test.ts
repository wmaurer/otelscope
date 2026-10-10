import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { Index } from "../../src/data/Index.ts";
import { Cause, causeLines, causeOf, originOf, parseFrames, sameThrown, thrownOf } from "../../src/model/cause.ts";
import { lineText } from "../../src/model/text.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { log } from "../support/records.ts";
import { ingestAll, status } from "../support/store.ts";
import { span, traceOf } from "../support/traces.ts";

import type { Thrown } from "../../src/model/cause.ts";
import type { Line } from "../../src/model/Role.ts";
import type { JsonlSpanEvent } from "@wmaurer/otelscope-effect/format";

const thrown = (type: string, message: string, frames: ReadonlyArray<string>): JsonlSpanEvent => ({
    name: "exception",
    offsetMs: 0,
    attrs: {
        "exception.type": type,
        "exception.message": message,
        "exception.stacktrace": Arr.join([`${type}: ${message}`, ...Arr.map(frames, (f) => `    at ${f}`)], "\n"),
    },
});

const texts = (lines: ReadonlyArray<Line>): ReadonlyArray<string> => Arr.map(lines, lineText);

describe("parseFrames", () => {
    it("reads named frames whose names hold spaces and parentheses", () => {
        const frames = parseFrames(
            Arr.join(
                [
                    "Error: boom",
                    "    at POST /orders (packages/effect/scripts/fixture/scenarios.ts:179:22)",
                    "    at fn (wrapped) (src/a.ts:1:2)",
                    "    at <anonymous> (packages/effect/scripts/fixture/scenarios.ts:108:27)",
                ],
                "\n",
            ),
        );
        expect(frames).toEqual([
            {
                name: Option.some("POST /orders"),
                definition: false,
                file: "packages/effect/scripts/fixture/scenarios.ts",
                line: 179,
                col: 22,
            },
            { name: Option.some("fn (wrapped)"), definition: false, file: "src/a.ts", line: 1, col: 2 },
            {
                name: Option.some("<anonymous>"),
                definition: false,
                file: "packages/effect/scripts/fixture/scenarios.ts",
                line: 108,
                col: 27,
            },
        ]);
    });

    it("marks a `(definition)` frame and keeps its name", () => {
        expect(parseFrames("    at payment.charge (definition) (fixture/scenarios.ts:117:30)")).toEqual([
            { name: Option.some("payment.charge"), definition: true, file: "fixture/scenarios.ts", line: 117, col: 30 },
        ]);
    });

    it("reads a bare location and strips a file:// URL", () => {
        expect(
            parseFrames("at file:///home/me/app/src/main.ts:9:4\nat run (file:///home/me/app/src/run.ts:3:1)"),
        ).toEqual([
            { name: Option.none(), definition: false, file: "/home/me/app/src/main.ts", line: 9, col: 4 },
            { name: Option.some("run"), definition: false, file: "/home/me/app/src/run.ts", line: 3, col: 1 },
        ]);
    });

    it("drops frames under node_modules/, with a node: path, or without a location", () => {
        const frames = parseFrames(
            Arr.join(
                [
                    "at Effect.gen (/app/node_modules/effect/dist/Effect.js:10:3)",
                    "at node:internal/process/task_queues:95:5",
                    "at process (node:internal/process:1:2)",
                    "at <anonymous>",
                    "at Array.map (native)",
                    "at kept (/app/src/kept.ts:4:5)",
                ],
                "\n",
            ),
        );
        expect(Arr.map(frames, (frame) => frame.file)).toEqual(["/app/src/kept.ts"]);
    });
});

describe("thrownOf and sameThrown", () => {
    const record = span("s", null, 0, {
        exit: "Failure",
        events: [
            thrown("First", "one", ["<anonymous> (src/a.ts:1:1)"]),
            log("in between"),
            thrown("Second", "", ["<anonymous> (src/b.ts:2:2)"]),
        ],
    });

    it("lists the exception events in order and nothing else", () => {
        expect(Arr.map(thrownOf(record), ({ type, message }) => [type, message])).toEqual([
            ["First", "one"],
            ["Second", ""],
        ]);
    });

    it("is computed once per record", () => {
        expect(thrownOf(record)).toBe(thrownOf(record));
    });

    const at = (type: string, site: string, rest: ReadonlyArray<string> = []): Thrown =>
        thrownOf(span("x", null, 0, { events: [thrown(type, "", [site, ...rest])] }))[0] ?? {
            type,
            message: "",
            frames: [],
        };

    it("calls two exceptions the same on type and throw site alone", () => {
        expect(sameThrown(at("A", "f (src/a.ts:1:2)", ["g (src/g.ts:1:1)"]), at("A", "h (/x/src/a.ts:1:2)"))).toBe(
            false,
        );
        expect(sameThrown(at("A", "f (src/a.ts:1:2)", ["g (src/g.ts:1:1)"]), at("A", "h (src/a.ts:1:2)"))).toBe(true);
        expect(sameThrown(at("A", "f (src/a.ts:1:2)"), at("B", "f (src/a.ts:1:2)"))).toBe(false);
        expect(sameThrown(at("A", "f (src/a.ts:1:2)"), at("A", "f (src/a.ts:1:3)"))).toBe(false);
        expect(sameThrown(at("A", "f (src/a.ts:1:2)"), at("A", "f (src/a.ts:2:2)"))).toBe(false);
    });
});

const A = thrown("A", "", ["<anonymous> (src/a.ts:1:1)", "outer (src/outer.ts:5:5)"]);
const B = thrown("B", "", ["<anonymous> (src/b.ts:2:2)"]);

// root ── mid ── first (origin, B)
//             └─ second (origin, A)
//      └─ bare (failed, no exception) ── deep (origin, B)
//      └─ nameless (failed, no exception, no child)
const tree = factsOf(
    traceOf([
        span("root", null, 0, { exit: "Failure", events: [A] }),
        span("mid", "root", 1, { exit: "Failure", events: [A] }),
        span("first", "mid", 2, { exit: "Failure", events: [B] }),
        span("second", "mid", 3, { exit: "Failure", events: [A] }),
        span("bare", "root", 4, { exit: "Failure" }),
        span("fine", "bare", 5),
        span("deep", "bare", 6, { exit: "Failure", events: [B] }),
        span("nameless", "root", 7, { exit: "Failure" }),
        span("lost", "root", 8, { exit: "Interrupted" }),
        span("ok", "root", 9),
        span("odd", "root", 10, { exit: "Failure", events: [thrown("C", "", ["<anonymous> (src/c.ts:3:3)"])] }),
        span("oddChild", "odd", 11, { exit: "Failure", events: [B] }),
    ]),
);

describe("originOf", () => {
    it("finds the first origin in the subtree whose exception is the same, skipping an earlier different one", () => {
        expect(originOf(tree, "root")).toEqual(Option.some("second"));
        expect(originOf(tree, "mid")).toEqual(Option.some("second"));
    });

    it("takes the first origin in the subtree for a span without an exception", () => {
        expect(originOf(tree, "bare")).toEqual(Option.some("deep"));
    });

    it("is None when no origin in the subtree has the same exception, and for a span that did not fail", () => {
        expect(originOf(tree, "odd")).toEqual(Option.none());
        expect(originOf(tree, "ok")).toEqual(Option.none());
        expect(originOf(tree, "lost")).toEqual(Option.none());
    });

    it("is the span itself for an origin", () => {
        expect(originOf(tree, "first")).toEqual(Option.some("first"));
    });
});

describe("causeOf", () => {
    it("gives each kind of span its cause", () => {
        expect(causeOf(tree, "second")).toEqual(
            Cause.Full({ thrown: thrownOf(tree.trace.spans.get("second") ?? span("", null, 0)) }),
        );
        expect(causeOf(tree, "mid")).toEqual(Cause.Propagated({ type: "A", origin: "second" }));
        expect(causeOf(tree, "bare")).toEqual(Cause.ChildFailed({ child: "deep" }));
        expect(causeOf(tree, "nameless")).toEqual(Cause.Unrecorded());
        expect(causeOf(tree, "lost")).toEqual(Cause.Interrupted());
        expect(causeOf(tree, "ok")).toEqual(Cause.None());
        expect(causeOf(tree, "absent")).toEqual(Cause.None());
    });

    it("shows the full cause on a propagated span whose origin cannot be found", () => {
        expect(causeOf(tree, "odd")._tag).toBe("Full");
    });
});

describe("causeLines", () => {
    const example = factsOf(
        traceOf([
            span("charge", null, 0, { name: "payment.charge", exit: "Failure" }),
            span("attempt", "charge", 1, {
                name: "payment.attempt",
                exit: "Failure",
                events: [
                    thrown("PaymentDeclined", "", [
                        "<anonymous> (/repo/packages/effect/scripts/fixture/scenarios.ts:120:15)",
                        "payment.charge (/repo/packages/effect/scripts/fixture/scenarios.ts:154:16)",
                        "payment.charge (definition) (/repo/packages/effect/scripts/fixture/scenarios.ts:96:30)",
                        "payment.attempt (/repo/packages/effect/scripts/fixture/scenarios.ts:50:20)",
                        "runMain (/repo/packages/effect/scripts/fixture/main.ts:3:1)",
                    ]),
                    thrown("Second", "it broke\nbadly", []),
                ],
            }),
        ]),
    );

    it("draws the full cause at a failure origin as 06 shows it", () => {
        const lines = causeLines(causeOf(example, "attempt"), example, 80);
        expect(texts(lines)).toEqual([
            "Cause",
            "PaymentDeclined",
            "(no message)",
            "thrown at fixture/scenarios.ts:120:15",
            "in span payment.charge  fixture/scenarios.ts:154:16",
            "  defined at fixture/scenarios.ts:96:30",
            "in span payment.attempt  fixture/scenarios.ts:50:20",
            "in runMain  fixture/main.ts:3:1",
            "",
            "Second",
            "it broke",
            "badly",
        ]);
        expect(lines[0]).toEqual([{ text: "Cause", role: "text", bold: true }]);
        expect(lines[1]).toEqual([{ text: "PaymentDeclined", role: "failure", bold: true }]);
    });

    it("cuts long lines to the width", () => {
        const lines = causeLines(causeOf(example, "attempt"), example, 20);
        expect(texts(lines)[4]).toBe("in span payment.cha…");
        expect(Arr.every(lines, (line) => lineText(line).length <= 20)).toBe(true);
    });

    it("draws the one-line causes", () => {
        expect(texts(causeLines(causeOf(tree, "mid"), tree, 80))).toEqual(["Cause", "↳ A, from second"]);
        expect(texts(causeLines(causeOf(tree, "bare"), tree, 80))).toEqual(["Cause", "failed because deep failed"]);
        expect(texts(causeLines(causeOf(tree, "nameless"), tree, 80))).toEqual([
            "Cause",
            "failed (no exception recorded)",
        ]);
        expect(texts(causeLines(causeOf(tree, "lost"), tree, 80))).toEqual([
            "Interrupted",
            "The span's fiber was interrupted before it finished.",
        ]);
        expect(causeLines(causeOf(tree, "ok"), tree, 80)).toEqual([]);
    });
});

describe("the sample fixture's declined payment", () => {
    const sample = fileURLToPath(new URL("../fixtures/sample/spans.jsonl", import.meta.url));
    const lines = Arr.filter(readFileSync(sample, "utf8").split("\n"), (text) => text.length > 0);
    const trace = ingestAll(new Index(), lines).freeze(status).traces.get("6072d474f66d376254a6cf75e4d4f6a1");
    if (trace === undefined) {
        throw new Error("the sample has no declined payment");
    }
    const facts = factsOf(trace);

    it("shows the full cause at payment.attempt and points the spans above it there", () => {
        expect(texts(causeLines(causeOf(facts, "ef0c8332199d744a"), facts, 80))).toEqual([
            "Cause",
            "PaymentDeclined",
            "(no message)",
            "thrown at fixture/scenarios.ts:110:46",
            "in span payment.attempt  fixture/scenarios.ts:113:16",
            "in span payment.charge  fixture/scenarios.ts:158:16",
            "  defined at fixture/scenarios.ts:117:30",
            "in span POST /orders  fixture/scenarios.ts:179:22",
            "  defined at fixture/scenarios.ts:147:28",
        ]);
        expect(texts(causeLines(causeOf(facts, "293ca2d3adb0b115"), facts, 80))).toEqual([
            "Cause",
            "↳ PaymentDeclined, from payment.attempt",
        ]);
        expect(originOf(facts, "e8453bd11344af1c")).toEqual(Option.some("ef0c8332199d744a"));
    });
});
