import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { isLive, runMarks, traceMark, traceState } from "../../src/model/marks.ts";
import { lineText } from "../../src/model/text.ts";
import { exception, record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

const snapshot = indexed([
    record({ span: "f", trace: "failed", exit: "Failure", events: [exception("Boom", "x")] }),
    record({ span: "r", trace: "recovered" }),
    record({ span: "rc", trace: "recovered", parent: "r", exit: "Failure", startMs: 1001 }),
    record({ span: "i", trace: "interrupted", exit: "Interrupted" }),
    record({ span: "o", trace: "ok" }),
    record({ span: "p", trace: "partial", parent: "absent" }),
]);
const trace = (id: string) => snapshot.traces.get(id)!;

describe("traceState", () => {
    it("classifies by the root's exit, failed spans under it, and whether a rootless trace is live", () => {
        expect(traceState(trace("failed"), false)).toBe("failed");
        expect(traceState(trace("recovered"), false)).toBe("recovered");
        expect(traceState(trace("interrupted"), false)).toBe("interrupted");
        expect(traceState(trace("ok"), true), "a finished root is not running").toBe("ok");
        expect(traceState(trace("partial"), true)).toBe("running");
        expect(traceState(trace("partial"), false)).toBe("partial");
    });

    it("marks each state with its own glyph and colour", () => {
        expect(traceMark("failed")).toEqual({ text: "✗", role: "failure" });
        expect(traceMark("recovered")).toEqual({ text: "✗", role: "failurePropagated" });
        expect(traceMark("interrupted")).toEqual({ text: "⊘", role: "interrupted" });
        expect(traceMark("running")).toEqual({ text: "▸", role: "accent" });
        expect(traceMark("partial")).toEqual({ text: "?", role: "muted" });
        expect(traceMark("ok").text).toBe(" ");
    });
});

describe("isLive", () => {
    it("is live only while following and within 5 s of the last arrival", () => {
        expect(isLive(Option.some(10_000), "following", 14_999)).toBe(true);
        expect(isLive(Option.some(10_000), "following", 15_000)).toBe(false);
        expect(isLive(Option.some(10_000), "done", 10_001)).toBe(false);
        expect(isLive(Option.none(), "following", 10_001)).toBe(false);
    });
});

describe("runMarks", () => {
    const run = snapshot.runs.get("run-1")!;
    it("shows live first, then the worst problem: bright ✗ before dim ✗ before ⊘", () => {
        expect(lineText(runMarks(run, true))).toBe("●✗");
        expect(runMarks(run, false)[1]?.role).toBe("failure");
        expect(runMarks({ ...run, failedTraces: 0 }, false)[1]?.role).toBe("failurePropagated");
        expect(runMarks({ ...run, failedTraces: 0, failedSpans: 0 }, false)[1]?.text).toBe("⊘");
        expect(lineText(runMarks({ ...run, failedTraces: 0, failedSpans: 0, interruptedSpans: 0 }, false))).toBe("  ");
    });
});
