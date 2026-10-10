import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { Array as Arr, Option } from "effect";
import { act } from "react";

import { Index } from "../../src/data/Index.ts";
import { initialShell } from "../../src/keys/Shell.ts";
import { openingFor } from "../../src/model/opening.ts";
import { defaultPanes } from "../../src/model/panes.ts";
import { factsOf } from "../../src/model/treeFacts.ts";
import { searchOf } from "../../src/model/treeSearch.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultTraceView, Screen, TreeRow } from "../../src/nav/Screen.ts";
import { Frame } from "../../src/ui/Frame.tsx";
import { theme } from "../../src/ui/theme.ts";
import { ingestAll, status } from "../support/store.ts";
import { traceModelFor } from "../support/traces.ts";

import type { Snapshot, TraceId } from "../../src/data/Snapshot.ts";
import type { Shell } from "../../src/keys/Shell.ts";
import type { GroupKey, TraceView } from "../../src/nav/Screen.ts";
import type { FrameProps } from "../../src/ui/Frame.tsx";

const file = fileURLToPath(new URL("../fixtures/sample/spans.jsonl", import.meta.url));
const lines = Arr.filter(readFileSync(file, "utf8").split("\n"), (text) => text.length > 0);
const sample: Snapshot = ingestAll(new Index(), lines).freeze({ ...status, phase: "done" });

const traceStarting = (prefix: string): TraceId =>
    Option.getOrThrow(Arr.findFirst(sample.traceOrder, (id) => id.startsWith(prefix)));

const DECLINED = traceStarting("6072d474");
const WIDE = traceStarting("c61ad8b5");
const DEEP = traceStarting("b82a6a72");

const now = Date.parse("2026-10-10T12:00:00Z");

const navFor = (traceId: TraceId, view: Partial<TraceView>): Nav.Nav =>
    Nav.push(
        Nav.initial,
        Screen.Trace({ traceId, idIsPrefix: false, viaRun: Option.none(), view: { ...defaultTraceView, ...view } }),
    );

const props = (nav: Nav.Nav, size: "wide" | "narrow" = "wide", shell: Shell = initialShell): FrameProps => {
    return {
        nav,
        snapshot: sample,
        now,
        message: Option.none(),
        shell,
        file,
        width: size === "wide" ? 120 : 80,
        height: size === "wide" ? 40 : 24,
        list: { _tag: "None" },
        trace: traceModelFor(nav, sample),
        panes: defaultPanes,
        bodyStats: new Map(),
        body: Option.none(),
        onAction: () => undefined,
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

/** As Traces ⏎ opens it: the opening selection, with the seeded search. */
const opened = (traceId: TraceId, over: Partial<TraceView> = {}): Nav.Nav => {
    const opening = openingFor(sample.traces.get(traceId)!, over.search ?? "");
    return navFor(traceId, { selected: opening.selected, openGroups: opening.openGroups, ...over });
};

const factsFor = (traceId: TraceId) => factsOf(sample.traces.get(traceId)!);

const snapshotPath = (name: string) => `__snapshots__/TraceFrames/${name}.txt`;

/** The tree's part of each row from screen row 4 on: the spans before the details pane's border. */
const treeRows = (frame: Awaited<ReturnType<typeof render>>) =>
    Arr.map(Arr.drop(frame.spans.lines, 4), (line) => Arr.takeWhile(line.spans, (span) => !span.text.includes("││")));

/** The colour of the first span holding `text` in the first tree row holding `row`. */
const colourOf = (frame: Awaited<ReturnType<typeof render>>, text: string, layer: "fg" | "bg", row = text) =>
    Option.map(
        Option.flatMap(
            Arr.findFirst(treeRows(frame), (spans) => Arr.some(spans, (span) => span.text.includes(row))),
            (spans) => Arr.findFirst(spans, (span) => span.text.includes(text)),
        ),
        (span) => span[layer],
    );

describe("Trace frames at 120×40", () => {
    it("shows the declined payment opened at its origin", async () => {
        const { chars } = await render(props(opened(DECLINED)));
        await expect(chars).toMatchFileSnapshot(snapshotPath("declined-wide"));
    });

    it("shows the 400-child trace's closed group with its failed members", async () => {
        const { chars } = await render(props(opened(WIDE)));
        await expect(chars).toMatchFileSnapshot(snapshotPath("group-closed"));
    });

    it("shows ⋯depth on the deep trace's deepest rows", async () => {
        const deepest = Option.getOrThrow(Arr.last(factsFor(DEEP).order().ids));
        const { chars } = await render(
            props(navFor(DEEP, { selected: Option.some(TreeRow.Span({ spanId: deepest })) })),
        );
        await expect(chars).toMatchFileSnapshot(snapshotPath("deep"));
    });

    it("shows an active tree search: gutter, highlights, a hidden-match count and match n/total", async () => {
        const facts = factsFor(WIDE);
        const search = searchOf(facts, "row.index=36");
        const third = facts.order().ids[search.positions[2] ?? -1] ?? "";
        const frame = await render(
            props(opened(WIDE, { search: "row.index=36", selected: Option.some(TreeRow.Span({ spanId: third })) })),
        );
        await expect(frame.chars).toMatchFileSnapshot(snapshotPath("search"));
        expect(frame.chars.split("\n")[39]).toMatch(/^\/ row\.index=36 · match 3\/\d+ /);
    });

    it("shows a group row's details", async () => {
        const root = sample.traces.get(WIDE)!.topLevel[0] ?? "";
        const group = TreeRow.Group({ key: `${root}|row.process` satisfies GroupKey });
        const { chars } = await render(props(navFor(WIDE, { selected: Option.some(group) })));
        await expect(chars).toMatchFileSnapshot(snapshotPath("group-details"));
    });

    it("paints origins, propagated failures, interruptions, the selection and matches in their colours", async () => {
        const declined = await render(props(opened(DECLINED, { search: "attempt" })));
        expect(colourOf(declined, "✗", "fg"), "the root only propagated").toEqual(
            Option.some(RGBA.fromHex(theme.failurePropagated)),
        );
        expect(colourOf(declined, "payment.charge", "fg"), "a propagated span's name").toEqual(
            Option.some(RGBA.fromHex(theme.text)),
        );
        expect(
            colourOf(declined, "payment.", "fg", "attempt"),
            "the origin's name, before its highlighted match",
        ).toEqual(Option.some(RGBA.fromHex(theme.failure)));
        expect(colourOf(declined, "attempt", "bg"), "the match").toEqual(Option.some(RGBA.fromHex(theme.matchBg)));
        expect(colourOf(declined, "▌", "fg", "attempt"), "the gutter").toEqual(Option.some(RGBA.fromHex(theme.accent)));
        const charge = await render(
            props(navFor(DECLINED, { selected: Option.some(TreeRow.Span({ spanId: chargeOf(DECLINED) })) })),
        );
        expect(colourOf(charge, "payment.charge", "bg"), "the selected row").toEqual(
            Option.some(RGBA.fromHex(theme.selectionBg)),
        );
        const interrupted = await render(props(opened(traceStarting("9acb3f47"))));
        expect(colourOf(interrupted, "⊘", "fg")).toEqual(Option.some(RGBA.fromHex(theme.interrupted)));
    });
});

const chargeOf = (traceId: TraceId): string =>
    Option.getOrThrow(
        Arr.findFirst(Array.from(sample.traces.get(traceId)!.spans.values()), (span) => span.name === "payment.charge"),
    ).span;

describe("Trace frames at 80×24", () => {
    it("stacks the tree over details and logs", async () => {
        const { chars } = await render(props(opened(DECLINED), "narrow"));
        await expect(chars).toMatchFileSnapshot(snapshotPath("declined-stacked"));
    });
});
