import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { hintLine } from "../../src/keys/Hints.ts";
import { breadcrumb, segments } from "../../src/model/breadcrumb.ts";
import { badLinesContent, overlayFrame } from "../../src/model/overlays.ts";
import { placeholderLines } from "../../src/model/placeholder.ts";
import { phasePart, statusBar } from "../../src/model/statusBar.ts";
import { lineText } from "../../src/model/text.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { Presence } from "../../src/nav/Resolve.ts";
import { bodyFor, defaultTraceView, Screen, tracesFor } from "../../src/nav/Screen.ts";
import { initialNav } from "../../src/nav/Seed.ts";
import { runs } from "../support/keys.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot, Status } from "../../src/data/Snapshot.ts";
import type { StatusInput } from "../../src/model/statusBar.ts";

const now = Date.parse("2026-10-06T14:10:00Z");
const file = "/tmp/run/spans.jsonl";

const base = indexed([
    record({ span: "a", run: "run-1", trace: "t1", startMs: Date.parse("2026-10-06T14:03:27Z") }),
    record({ span: "b", run: "run-2", trace: "t2" }),
    record({ span: "c", run: "run-2", trace: "t2", parent: "b" }),
]);

const withStatus = (status: Partial<Status>, snapshot: Snapshot = base): Snapshot => ({
    ...snapshot,
    status: { ...snapshot.status, ...status },
});

const live = withStatus({ lastRecordAt: Option.some(now - 1000) });
const bad: Snapshot = { ...live, badLines: { legacy: 0, malformed: 3, samples: [] } };

const input = (over: Partial<StatusInput> = {}): StatusInput => ({
    hints: hintLine("screen", runs, { propagated: false }),
    message: Option.none(),
    query: Option.none(),
    newRows: Option.some("↑ 3 new"),
    snapshot: bad,
    file,
    now,
    ...over,
});

const bar = (width: number, over: Partial<StatusInput> = {}) => {
    const text = lineText(statusBar(input(over), width));
    expect(text.length, `exactly ${width} cells`).toBe(width);
    return text.startsWith(" ") ? text.trim() : text.replace(/ {2,}/, " | ");
};

describe("status bar", () => {
    it("drops hints from the last, then new rows, problems, file, size and ? help, then cuts the phase", () => {
        const right = "↑ 3 new  ⚠ 3 bad lines  spans.jsonl  ● following  2 runs · 3 spans";
        expect(bar(116)).toBe(`⏎ open · / filter · n problem · S sort · ? help | ${right}`);
        expect(bar(114)).toBe(`⏎ open · / filter · n problem · ? help | ${right}`);
        expect(bar(83)).toBe(`⏎ open · ? help | ${right}`);
        expect(bar(74)).toBe(`? help | ${right}`);
        expect(bar(73)).toBe("? help | ⚠ 3 bad lines  spans.jsonl  ● following  2 runs · 3 spans");
        expect(bar(64)).toBe("? help | spans.jsonl  ● following  2 runs · 3 spans");
        expect(bar(49)).toBe("? help | ● following  2 runs · 3 spans");
        expect(bar(36)).toBe("? help | ● following");
        expect(bar(18)).toBe("● following");
        expect(bar(8)).toBe("● follo…");
    });

    it("shows a message in place of the hints, and cuts it before the phase", () => {
        expect(bar(116, { message: Option.some("copied 12.4 KB") })).toBe(
            "copied 12.4 KB | ↑ 3 new  ⚠ 3 bad lines  spans.jsonl  ● following  2 runs · 3 spans",
        );
        expect(bar(20, { message: Option.some("copied 12.4 KB") })).toBe("copied… | ● following");
        expect(bar(12, { message: Option.some("copied 12.4 KB") })).toBe("● following");
    });

    it("flashes a Reset for 5 s, then the hints return", () => {
        const reset = withStatus({
            lastReset: Option.some({ reason: "truncated", at: now - 4999 }),
            lastRecordAt: Option.some(now - 1000),
        });
        expect(bar(120, { snapshot: reset, newRows: Option.none() })).toMatch(/^file truncated — reloaded \|/);
        expect(bar(120, { snapshot: reset, newRows: Option.none(), now: now + 1 })).toMatch(/^⏎ open/);
        const replaced = withStatus({ lastReset: Option.some({ reason: "replaced", at: now }) });
        expect(bar(120, { snapshot: replaced })).toMatch(/^file replaced — reloaded \|/);
        const removed = withStatus({ lastReset: Option.some({ reason: "removed", at: now }), phase: "waiting" });
        expect(bar(120, { snapshot: removed })).toMatch(/^file removed \|/);
    });

    it("words every phase", () => {
        const phase = (status: Partial<Status>, at = now) =>
            lineText(phasePart({ ...base.status, ...status }, file, at));
        expect(phase({ phase: "waiting" })).toBe("waiting for /tmp/run/spans.jsonl…");
        expect(phase({ phase: "loading", bytesRead: 41_300_000, bytesTotal: 96_000_000 })).toBe(
            "loading 43% · 41 / 96 MB",
        );
        expect(phase({ phase: "following", lastRecordAt: Option.some(now - 4999) })).toBe("● following");
        expect(phase({ phase: "following", lastRecordAt: Option.some(now - 5000) })).toBe("following");
        expect(phase({ phase: "following", lastRecordAt: Option.none() })).toBe("following");
        expect(phase({ phase: "done" })).toBe("read once");
        expect(phase({ phase: "following", error: Option.some("EACCES: permission denied") })).toBe(
            "⚠ EACCES: permission denied",
        );
        const reloadedAt = Date.parse("2026-10-06T12:03:04Z");
        const reloaded = { lastReset: Option.some({ reason: "truncated" as const, at: reloadedAt }) };
        expect(phase({ ...reloaded, lastRecordAt: Option.none() })).toBe("following · reloaded 12:03:04");
        expect(phase({ ...reloaded, lastRecordAt: Option.some(reloadedAt + 1) })).toBe("following");
    });

    it("colours the live mark, the error and the bad lines by role", () => {
        expect(phasePart(live.status, file, now)).toEqual([{ text: "● following", role: "live" }]);
        expect(phasePart({ ...live.status, error: Option.some("boom") }, file, now)[0]?.role).toBe("failure");
        const roles = statusBar(input(), 120);
        expect(Arr.findFirst(roles, (c) => c.text === "⚠ 3 bad lines")).toEqual(
            Option.some({ text: "⚠ 3 bad lines", role: "warning" }),
        );
    });

    it("counts legacy lines dimly and runs in the singular", () => {
        const legacy: Snapshot = {
            ...withStatus({ phase: "done" }),
            badLines: { legacy: 120, malformed: 0, samples: [] },
        };
        const one = indexed([record({ span: "a" })]);
        expect(bar(120, { snapshot: legacy, newRows: Option.none() })).toMatch(
            /\| 120 lines from otelscope < 0\.3 skipped {2}spans\.jsonl {2}read once {2}2 runs · 3 spans$/,
        );
        expect(bar(120, { snapshot: one, newRows: Option.none() })).toMatch(/1 run · 1 span$/);
    });
});

describe("breadcrumb", () => {
    const text = (all: readonly [string, ...Array<string>], width: number) => lineText(breadcrumb(all, width));

    it("names each screen on the stack", () => {
        const nav = Nav.push(
            Nav.push(Nav.push(Nav.initial, tracesFor("run-1", runs.stack[0].view)), {
                ...Screen.Trace({
                    traceId: "t1",
                    idIsPrefix: false,
                    viaRun: Option.some("run-1"),
                    view: defaultTraceView,
                }),
            }),
            bodyFor("t1", "a", "llm.request"),
        );
        expect(segments(nav, base, now)).toEqual(["Runs", "api · 14:03:27", "a t1", "llm.request"]);
        expect(segments(initialNav({ run: Option.none(), trace: Option.some("9f3c") }), base, now)).toEqual([
            "Runs",
            "9f3c…",
        ]);
    });

    it("cuts segments from the left, keeping the current one", () => {
        const all = ["Runs", "shop-api · 14:03:27", "POST /orders 5643b831", "llm.request"] as const;
        expect(text(all, 80)).toBe("Runs › shop-api · 14:03:27 › POST /orders 5643b831 › llm.request");
        expect(text(all, 61)).toBe("… › shop-api · 14:03:27 › POST /orders 5643b831 › llm.request");
        expect(text(all, 60)).toBe("… › POST /orders 5643b831 › llm.request");
        expect(text(all, 20)).toBe("… › llm.request");
        expect(text(all, 8)).toBe("llm.req…");
    });

    it("brightens only the current segment", () => {
        const line = breadcrumb(["Runs", "api · 14:03:27"], 80);
        expect(Arr.map(line, (c) => [c.text, c.role])).toEqual([
            ["Runs", "muted"],
            [" › ", "faint"],
            ["api · 14:03:27", "accent"],
        ]);
    });
});

describe("placeholder", () => {
    const words = (presence: Presence) => Option.map(placeholderLines(presence), (lines) => Arr.map(lines, lineText));

    it("words each missing-id situation and always offers Esc", () => {
        expect(words(Presence.Present())).toEqual(Option.none());
        expect(words(Presence.Loading({ noun: "trace", id: "9f3c" }))).toEqual(
            Option.some(["Loading… looking for trace 9f3c…", "Esc to go back"]),
        );
        expect(words(Presence.Ambiguous({ noun: "trace", id: "9f3c", count: 3 }))).toEqual(
            Option.some(["9f3c matches 3 traces", "Esc to go back"]),
        );
        expect(words(Presence.NotInFile({ noun: "trace", id: "9f3c", resetAt: Option.none() }))).toEqual(
            Option.some(["Trace 9f3c… is not in the file", "Esc to go back"]),
        );
        expect(
            words(
                Presence.NotInFile({
                    noun: "span",
                    id: "51e618f6aa",
                    resetAt: Option.some(Date.parse("2026-10-06T12:03:04Z")),
                }),
            ),
        ).toEqual(Option.some(["Span 51e618f6… is not in the file (file reset at 12:03:04)", "Esc to go back"]));
        expect(words(Presence.Loading({ noun: "run", id: "2026-10-07T10-01" }))).toEqual(
            Option.some(["Loading… looking for run 2026-10-…", "Esc to go back"]),
        );
    });
});

describe("bad-lines overlay", () => {
    it("titles the counts and lists each sample with its text", () => {
        const content = badLinesContent({
            legacy: 120,
            malformed: 3,
            samples: [{ line: 1204, offset: 412_330, issue: "not JSON", text: "{oops" }],
        });
        expect(content.title).toBe("Bad lines · 3 malformed · 120 legacy (not sampled)");
        expect(Arr.map(content.lines, lineText)).toEqual(["line 1,204 · byte 412,330 · not JSON", "  {oops"]);
    });

    it("says legacy lines are not sampled when there are only those", () => {
        const content = badLinesContent({ legacy: 7, malformed: 0, samples: [] });
        expect(content.title).toBe("Bad lines · 7 legacy (not sampled)");
        expect(Arr.map(content.lines, lineText)).toEqual(["legacy lines are not sampled"]);
    });

    it("centres the box and fits it to its content", () => {
        expect(overlayFrame({ width: 120, height: 40 }, 5)).toEqual({
            left: 12,
            top: 16,
            width: 96,
            height: 7,
            viewport: 5,
        });
        expect(overlayFrame({ width: 80, height: 24 }, 100)).toEqual({
            left: 8,
            top: 2,
            width: 64,
            height: 19,
            viewport: 17,
        });
    });
});
