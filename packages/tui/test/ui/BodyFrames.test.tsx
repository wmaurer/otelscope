import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { Array as Arr, Cause, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";

import { bodyModelAtom } from "../../src/bridge/Body.ts";
import { BodyMissing } from "../../src/data/Bodies.ts";
import { Index } from "../../src/data/Index.ts";
import { Action } from "../../src/keys/Action.ts";
import { initialShell, Shell } from "../../src/keys/Shell.ts";
import { matchesOf } from "../../src/model/bodySearch.ts";
import { defaultPanes } from "../../src/model/panes.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultBodyView, defaultTraceView, Screen } from "../../src/nav/Screen.ts";
import { Frame } from "../../src/ui/Frame.tsx";
import { theme } from "../../src/ui/theme.ts";
import { ingestAll, status } from "../support/store.ts";

import type { BodyKey } from "../../src/bridge/Atoms.ts";
import type { BodyMissing as Missing, BodyReadFailed, BodyText } from "../../src/data/Bodies.ts";
import type { Snapshot, SpanId, TraceId } from "../../src/data/Snapshot.ts";
import type { ScreenAction } from "../../src/keys/Action.ts";
import type { BodyModel } from "../../src/model/bodyModel.ts";
import type { BodyView } from "../../src/nav/Screen.ts";
import type { FrameProps } from "../../src/ui/Frame.tsx";

const file = fileURLToPath(new URL("../fixtures/sample/spans.jsonl", import.meta.url));
const bodiesDir = fileURLToPath(new URL("../fixtures/sample/bodies/", import.meta.url));
const lines = Arr.filter(readFileSync(file, "utf8").split("\n"), (text) => text.length > 0);
const sample: Snapshot = ingestAll(new Index(), lines).freeze({ ...status, phase: "done" });

const now = Date.parse("2026-10-10T12:00:00Z");

type Result = AsyncResult.AsyncResult<BodyText, Missing | BodyReadFailed>;

/** The sample's body files, read the way `Bodies.read` reads them. */
const stored = (key: BodyKey): Result => {
    const path = `${bodiesDir}${key.sha256}.txt`;
    const storedBytes = statSync(path).size;
    return AsyncResult.success({
        text: readFileSync(path, "utf8"),
        truncated: key.bytes > storedBytes,
        bytes: key.bytes,
        storedBytes,
        path,
    });
};

const missing = (key: BodyKey): Result =>
    AsyncResult.failure(Cause.fail(new BodyMissing({ sha256: key.sha256, path: `${bodiesDir}${key.sha256}.txt` })));

interface SpanAt {
    readonly traceId: TraceId;
    readonly spanId: SpanId;
}

/** The span whose id starts with `prefix`, and its trace. */
const spanOf = (prefix: string): SpanAt => {
    const found = Option.getOrThrow(
        Arr.findFirst(Array.from(sample.traces.values()), (trace) =>
            Arr.some(Array.from(trace.spans.keys()), (id) => id.startsWith(prefix)),
        ),
    );
    const spanId = Option.getOrThrow(Arr.findFirst(Array.from(found.spans.keys()), (id) => id.startsWith(prefix)));
    return { traceId: found.id, spanId };
};

const CHAT = spanOf("86dcbc6a");
const EMAIL = spanOf("cf8ca1b2");
const TRANSCRIPT = spanOf("87c7a6a0");

const navFor = (at: SpanAt, prefix: string, view: Partial<BodyView> = {}): Nav.Nav =>
    Nav.push(
        Nav.push(
            Nav.initial,
            Screen.Trace({
                traceId: at.traceId,
                idIsPrefix: false,
                viaRun: Option.none(),
                view: defaultTraceView,
            }),
        ),
        Screen.Body({ ...at, prefix, view: { ...defaultBodyView, ...view } }),
    );

const modelFor = (nav: Nav.Nav, read: (key: BodyKey) => Result = stored): Option.Option<BodyModel> => {
    const registry = AtomRegistry.make();
    try {
        return registry.get(bodyModelAtom(Atom.make(sample), Atom.make(nav), (key) => Atom.make(read(key))));
    } finally {
        registry.dispose();
    }
};

const props = (nav: Nav.Nav, size: "wide" | "narrow" = "wide", read = stored): FrameProps => ({
    nav,
    snapshot: sample,
    now,
    message: Option.none(),
    shell: initialShell,
    file,
    width: size === "wide" ? 120 : 80,
    height: size === "wide" ? 40 : 24,
    list: { _tag: "None" },
    trace: Option.none(),
    panes: defaultPanes,
    bodyStats: new Map(),
    body: modelFor(nav, read),
    onAction: () => undefined,
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

const snapshotPath = (name: string) => `__snapshots__/BodyFrames/${name}.txt`;

/** The offset of the `n`th match of `search` in the shown JSON of the chat request. */
const matchAt = (search: string, n: number): number => {
    const model = Option.getOrThrow(modelFor(navFor(CHAT, "llm.request")));
    if (model.content._tag !== "Stored") {
        throw new Error("not stored");
    }
    return matchesOf(model.content.doc, search).starts[n] ?? -1;
};

describe("Body frames at 120×40", () => {
    it("shows a JSON body pretty-printed, with the tab row", async () => {
        const { chars } = await render(props(navFor(CHAT, "llm.request")));
        await expect(chars).toMatchFileSnapshot(snapshotPath("json"));
        expect(chars.split("\n")[1]).toMatch(/^llm\.request · llm\.chat · 2\.6 KB · json · L 1–36 \/ \d+/);
    });

    it("shows plain text wrapped at word boundaries, without a tab row for one body", async () => {
        const { chars } = await render(props(navFor(EMAIL, "email")));
        await expect(chars).toMatchFileSnapshot(snapshotPath("text"));
    });

    it("warns that a body is truncated and shows it as text", async () => {
        const { chars } = await render(props(navFor(TRANSCRIPT, "agent.transcript")));
        await expect(chars).toMatchFileSnapshot(snapshotPath("truncated"));
        expect(chars.split("\n")[2]).toMatch(/^⚠ truncated: showing 1,000,023 of 1,213,045 bytes/);
    });

    it("shows the preview of a missing body, marked preview only", async () => {
        const { chars } = await render(props(navFor(EMAIL, "email"), "wide", missing));
        await expect(chars).toMatchFileSnapshot(snapshotPath("missing"));
        expect(chars.split("\n")[2]).toMatch(/^⚠ bodies\/b9d2a2\w+\.txt not found next to spans\.jsonl/);
    });

    it("shows an active search with its current match, in the header and the status bar", async () => {
        const current = matchAt("refund", 2);
        const nav = navFor(CHAT, "llm.request", { search: "refund", current: Option.some(current) });
        const frame = await render(props(nav));
        await expect(frame.chars).toMatchFileSnapshot(snapshotPath("search"));
        expect(frame.chars.split("\n")[1]).toMatch(/ · match 3\/\d+ *$/);
        expect(frame.chars.split("\n")[39]).toMatch(/^\/ refund · match 3\/\d+ /);
        const backgrounds = Arr.flatMap(frame.spans.lines, (line) =>
            Arr.filter(line.spans, (span) => span.text === "refund"),
        );
        expect(Arr.map(backgrounds, (span) => span.bg)).toContainEqual(RGBA.fromHex(theme.currentMatchBg));
        expect(Arr.map(backgrounds, (span) => span.bg)).toContainEqual(RGBA.fromHex(theme.matchBg));
    });

    it("counts the matches in the input bar while typing", async () => {
        const nav = navFor(CHAT, "llm.request", { search: "refund" });
        const typing = Shell.Input({ cursor: 6, original: "", recall: Option.none() });
        const { chars } = await render({ ...props(nav), shell: typing });
        expect(chars.split("\n")[39]).toMatch(/^\/ refund▏ +\d+ matches$/);
    });

    it("says when the span no longer carries the body", async () => {
        const { chars } = await render(props(navFor(CHAT, "llm.tool")));
        expect(chars).toContain("No body llm.tool on this span");
    });
});

describe("Body pager", () => {
    it("scrolls three rows a wheel step", async () => {
        const actions: Array<ScreenAction> = [];
        const frame = {
            ...props(navFor(CHAT, "llm.request")),
            onAction: (action: ScreenAction) => {
                actions[actions.length] = action;
            },
        };
        const setup = await testRender(<Frame {...frame} />, { width: frame.width, height: frame.height });
        try {
            await setup.renderOnce();
            await act(() => setup.mockMouse.scroll(10, 10, "down"));
            await act(() => setup.mockMouse.scroll(10, 10, "up"));
            expect(actions).toEqual([Action.ScrollBody({ rows: 3 }), Action.ScrollBody({ rows: -3 })]);
        } finally {
            act(() => setup.renderer.destroy());
        }
    });
});

describe("Body frames at 80×24", () => {
    it("wraps the JSON body to the narrow width", async () => {
        const { chars } = await render(props(navFor(CHAT, "llm.request"), "narrow"));
        await expect(chars).toMatchFileSnapshot(snapshotPath("json-narrow"));
    });
});
