import { describe, expect, it } from "@effect/vitest";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { Array as Arr, HashSet, Option } from "effect";
import { act } from "react";

import { initialShell, Shell } from "../../src/keys/Shell.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultRunsView, tracesFor } from "../../src/nav/Screen.ts";
import { Frame, listRows } from "../../src/ui/Frame.tsx";
import { theme } from "../../src/ui/theme.ts";
import { listFor, namedTraces, rootSpan } from "../support/lists.ts";
import { exception, record } from "../support/records.ts";
import { indexed, status } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { FrameProps } from "../../src/ui/Frame.tsx";

const now = Date.parse("2026-10-06T14:10:00Z");
const file = "/home/me/project/spans.jsonl";
const t0 = Date.parse("2026-10-06T14:03:27Z");

const done = (snapshot: Snapshot): Snapshot => ({ ...snapshot, status: { ...status, phase: "done" } });

const shop = [
    ...namedTraces("o", "POST /orders", 24, t0, new Set([2, 9, 13])),
    rootSpan("pay1", "POST /payments", t0 + 2500, "Failure", {
        events: [exception("PaymentDeclined", "card declined")],
    }),
    rootSpan("h1", "GET /health", t0 + 30_000, "Success"),
    record({ span: "rec", trace: "rec1", name: "GET /cart", startMs: t0 + 31_000, ms: 40 }),
    record({ span: "rec-c", trace: "rec1", parent: "rec", name: "db.query", startMs: t0 + 31_001, exit: "Failure" }),
];
const shopRecords = Arr.map(shop, (r) => ({ ...r, run: "2026-10-06T14-03-27-070-0001", service: "shop-api" }));

const agent = [
    record({
        span: "agent-root",
        trace: "agent1",
        name: "agent.turn",
        run: "2026-10-06T14-05-29-113-0002",
        service: "support-agent",
        startMs: t0 + 120_000,
        ms: 3100,
        exit: "Interrupted",
    }),
];

const sample = done(indexed([...shopRecords, ...agent]));
const shopRun = "2026-10-06T14-03-27-070-0001";
const traces = Nav.push(Nav.initial, tracesFor(shopRun, defaultRunsView));
const openGroup = Nav.update(traces, "Traces", (view) => ({ ...view, openGroups: HashSet.make("POST /orders") }));
const filtered = (nav: Nav.Nav, filter: string): Nav.Nav =>
    Nav.top(nav)._tag === "Runs"
        ? Nav.update(nav, "Runs", (view) => ({ ...view, filter }))
        : Nav.update(nav, "Traces", (view) => ({ ...view, filter }));

const props = (nav: Nav.Nav, snapshot: Snapshot, size: "wide" | "narrow" = "wide"): FrameProps => ({
    nav,
    snapshot,
    now,
    message: Option.none(),
    shell: initialShell,
    file,
    width: size === "wide" ? 120 : 80,
    height: size === "wide" ? 40 : 24,
    list: listFor(nav, snapshot, now),
    onPick: () => undefined,
});

const render = async (frame: FrameProps) => {
    const setup = await testRender(<Frame {...frame} />, { width: frame.width, height: frame.height });
    try {
        await setup.renderOnce();
        return { chars: setup.captureCharFrame(), spans: setup.captureSpans() };
    } finally {
        act(() => setup.renderer.destroy());
    }
};

describe("list frames", () => {
    for (const size of ["wide", "narrow"] as const) {
        it(`draws Runs at ${size}`, async () => {
            const { chars } = await render(props(Nav.initial, sample, size));
            expect(chars).toMatchSnapshot();
            expect(chars).toContain("support-agent");
            expect(chars).toContain("shop-api");
        });

        it(`draws Traces with a closed group at ${size}`, async () => {
            const { chars } = await render(props(traces, sample, size));
            expect(chars).toMatchSnapshot();
            expect(chars).toContain("▸ POST /orders ×24");
            expect(chars).toContain("⋯ 21 more ok");
        });

        it(`draws Traces with an open group at ${size}`, async () => {
            const { chars } = await render(props(openGroup, sample, size));
            expect(chars).toMatchSnapshot();
            expect(chars, "following scrolls the newest row into view").toContain("GET /cart");
            expect(chars).toContain("+23.0s");
            expect(chars).not.toContain("more ok");
        });

        it(`says when a filter matches nothing at ${size}`, async () => {
            const { chars } = await render(props(filtered(traces, "nothing-matches"), sample, size));
            expect(chars).toMatchSnapshot();
            expect(chars).toContain('No traces match "nothing-matches".');
            expect(chars).toContain("Esc clears the filter");
        });
    }

    for (const size of ["wide", "narrow"] as const) {
        it(`draws the input open in place of the status bar at ${size}`, async () => {
            const typing = filtered(traces, "pay");
            const { chars } = await render({
                ...props(typing, sample, size),
                shell: Shell.Input({ cursor: 3, original: "", recall: Option.none() }),
            });
            expect(chars).toMatchSnapshot();
            expect(chars.split("\n")[size === "wide" ? 39 : 23]).toMatch(/^\/ pay▏ +1 of 27 traces$/);
        });
    }

    for (const size of ["wide", "narrow"] as const) {
        it(`draws as many list rows as a page move covers at ${size}`, async () => {
            const many = done(
                indexed(
                    Array.from({ length: 60 }, (_, i) =>
                        record({
                            span: `s${i}`,
                            run: `run-${i}`,
                            service: `svc-${i}`,
                            trace: `t${i}`,
                            startMs: t0 + i,
                        }),
                    ),
                ),
            );
            const frame = props(Nav.initial, many, size);
            const { chars } = await render(frame);
            expect(Arr.filter(chars.split("\n"), (row) => row.includes("svc-")).length).toBe(listRows(frame.height));
        });
    }

    it("shows the legacy notice in place of an empty run list", async () => {
        const legacy = { ...done(indexed([])), badLines: { legacy: 120, malformed: 0, samples: [] } };
        const { chars } = await render(props(Nav.initial, legacy));
        expect(chars).toMatchSnapshot();
        expect(chars).toContain("This file was written by @wmaurer/otelscope-effect < 0.3 (120 lines).");
    });

    it("shows the active query and its count in place of the hints", async () => {
        const { chars } = await render(props(filtered(traces, "pay"), sample));
        expect(chars.split("\n")[39]).toMatch(/^\/ pay · 1 of 27 /);
    });

    it("paints the selected row, a filter match and a failure mark in their colours", async () => {
        const { spans } = await render(props(filtered(Nav.initial, "shop"), sample));
        const all = Arr.flatMap(spans.lines, (line) => line.spans);
        const match = Arr.findFirst(all, (span) => span.text === "shop");
        expect(
            Option.map(match, (span) => span.bg.equals(RGBA.fromHex(theme.matchBg))),
            "match",
        ).toEqual(Option.some(true));
        const selected = Arr.findFirst(all, (span) => span.text.includes("-api"));
        expect(
            Option.map(selected, (span) => span.bg.equals(RGBA.fromHex(theme.selectionBg))),
            "the selected row's background",
        ).toEqual(Option.some(true));
        const mark = Arr.findFirst(all, (span) => span.text === "✗");
        expect(
            Option.map(mark, (span) => span.fg.equals(RGBA.fromHex(theme.failure))),
            "failure mark",
        ).toEqual(Option.some(true));
    });
});
