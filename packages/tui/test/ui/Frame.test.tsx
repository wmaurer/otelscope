import { describe, expect, it } from "@effect/vitest";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { Array as Arr, Option } from "effect";
import { act } from "react";

import { initialShell, Shell } from "../../src/keys/Shell.ts";
import { defaultPanes } from "../../src/model/panes.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { initialNav } from "../../src/nav/Seed.ts";
import { Frame } from "../../src/ui/Frame.tsx";
import { theme } from "../../src/ui/theme.ts";
import { trace } from "../support/keys.ts";
import { listFor } from "../support/lists.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { FrameProps } from "../../src/ui/Frame.tsx";

const now = Date.parse("2026-10-06T14:10:00Z");
const file = "/home/me/project/spans.jsonl";

const settled = (snapshot: Snapshot): Snapshot => ({
    ...snapshot,
    status: { ...snapshot.status, phase: "following", lastRecordAt: Option.some(now - 2000) },
});

const empty = settled(indexed([]));

const sample = settled(
    indexed([
        record({ span: "root", run: "run-1", service: "shop-api", trace: "trace-1", startMs: now - 400_000 }),
        record({
            span: "child",
            run: "run-1",
            service: "shop-api",
            trace: "trace-1",
            parent: "root",
            startMs: now - 399_000,
        }),
        record({ span: "other", run: "run-2", service: "support-agent", trace: "9f3c11aa", startMs: now - 300_000 }),
    ]),
);

const withBadLines: Snapshot = {
    ...sample,
    badLines: {
        legacy: 120,
        malformed: 2,
        samples: [
            { line: 1204, offset: 412_330, issue: "not JSON", text: '{"run":"2026-10-06T14-03-27","trace":' },
            { line: 1299, offset: 450_002, issue: "missing field `span`", text: '{"run":"r","trace":"t","name":"x"}' },
        ],
    },
};

const props = (over: Partial<FrameProps>): FrameProps => {
    const nav = over.nav ?? Nav.initial;
    const snapshot = over.snapshot ?? empty;
    return {
        nav,
        snapshot,
        now,
        message: Option.none(),
        shell: initialShell,
        file,
        width: 120,
        height: 40,
        list: listFor(nav, snapshot, now),
        trace: Option.none(),
        panes: defaultPanes,
        bodyStats: new Map(),
        body: Option.none(),
        onAction: () => undefined,
        ...over,
    };
};

const render = async (frame: FrameProps) => {
    const setup = await testRender(<Frame {...frame} />, { width: frame.width, height: frame.height });
    try {
        await setup.renderOnce();
        return { chars: setup.captureCharFrame(), spans: setup.captureSpans() };
    } finally {
        act(() => setup.renderer.destroy());
    }
};

describe("Frame", () => {
    it("draws the breadcrumb and status bar around an empty screen", async () => {
        const { chars, spans } = await render(props({}));
        expect(chars).toMatchSnapshot();
        const lines = chars.split("\n");
        expect(lines[0]?.trimEnd()).toBe("Runs");
        expect(lines[39]).toMatch(
            /^⏎ open · \/ filter · n problem · S sort · \? help +spans\.jsonl {2}● following {2}0 runs · 0 spans$/,
        );
        const live = Arr.findFirst(
            Arr.flatMap(spans.lines, (line) => line.spans),
            (span) => span.text.includes("● following"),
        );
        expect(
            Option.exists(live, (span) => span.fg.equals(RGBA.fromHex(theme.live))),
            "the live mark is green",
        ).toBe(true);
    });

    it("draws a placeholder for a seeded id that is not in the file", async () => {
        const nav = initialNav({ run: Option.none(), trace: Option.some("abcd") });
        const { chars } = await render(
            props({ nav, snapshot: { ...sample, status: { ...sample.status, phase: "done" } } }),
        );
        expect(chars).toMatchSnapshot();
        expect(chars).toContain("Trace abcd… is not in the file");
        expect(chars).toContain("Esc to go back");
        expect(chars.split("\n")[0]?.trimEnd()).toBe("Runs › abcd…");
    });

    it("draws the help overlay over the current screen", async () => {
        const { chars } = await render(props({ snapshot: sample, shell: Shell.Overlay({ kind: "help", scroll: 0 }) }));
        expect(chars).toMatchSnapshot();
        expect(chars).toContain("Help · Runs");
        expect(chars).toContain("j/k/↑/↓");
        expect(chars).toContain("Esc close");
    });

    it("draws the bad-lines overlay with its samples", async () => {
        const { chars } = await render(
            props({ snapshot: withBadLines, shell: Shell.Overlay({ kind: "badLines", scroll: 0 }) }),
        );
        expect(chars).toMatchSnapshot();
        expect(chars).toContain("Bad lines · 2 malformed · 120 legacy (not sampled)");
        expect(chars).toContain("line 1,204 · byte 412,330 · not JSON");
    });

    it("fits the help overlay on a Trace screen into 80x24, focused pane first", async () => {
        const { chars } = await render(
            props({
                nav: trace("details"),
                snapshot: sample,
                shell: Shell.Overlay({ kind: "help", scroll: 0 }),
                width: 80,
                height: 24,
            }),
        );
        expect(chars).toMatchSnapshot();
        expect(chars).toMatch(/▸ Trace · details/);
    });
});
