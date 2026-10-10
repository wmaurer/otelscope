import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { dispatch } from "../../src/keys/Dispatch.ts";
import { initialKeyState, Shell, stepShell } from "../../src/keys/Shell.ts";
import { detect, docOf } from "../../src/model/bodyDoc.ts";
import { BodyContent } from "../../src/model/bodyModel.ts";
import { rowsOf } from "../../src/model/bodyRows.ts";
import { matchesOf } from "../../src/model/bodySearch.ts";
import { EDIT_WARNING, seekFirstMatch, stepBody } from "../../src/nav/BodyStep.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultBodyView, defaultTraceView, Screen } from "../../src/nav/Screen.ts";
import { ShellEffect } from "../../src/nav/ScreenStep.ts";
import { press } from "../support/keys.ts";
import { listFor } from "../support/lists.ts";
import { indexed } from "../support/store.ts";

import type { BodyAction } from "../../src/keys/Action.ts";
import type { BodyRef } from "../../src/model/bodies.ts";
import type { BodyView, ScreenOf } from "../../src/nav/Screen.ts";
import type { BodyContext } from "../../src/nav/ScreenStep.ts";

const VIEWPORT = 5;
const WIDTH = 20;

const refOf = (prefix: string): BodyRef => ({ prefix, sha256: `${prefix}-sha`, bytes: 100, preview: "preview" });
const refs = [refOf("llm.request"), refOf("llm.response"), refOf("llm.tool")];

/** 30 lines, `hit` on lines 2, 26, 27 and 29, and `solo` on line 2. */
const pagerLines = Arr.makeBy(30, (i) =>
    i === 2 ? "row 2 hit solo" : Arr.contains([26, 27, 29], i) ? `row ${i} hit` : `row ${i}`,
);
const pager = Arr.join(pagerLines, "\n");

/** Where `hit` starts on a line of the pager. */
const hitOn = (line: number): number =>
    Arr.reduce(Arr.take(pagerLines, line), 0, (at, text) => at + text.length + 1) +
    (pagerLines[line] ?? "").indexOf("hit");

const trace = Screen.Trace({ traceId: "t", idIsPrefix: false, viaRun: Option.none(), view: defaultTraceView });

const bodyScreen = (view: Partial<BodyView> = {}, prefix = "llm.request"): ScreenOf<"Body"> =>
    Screen.Body({ traceId: "t", spanId: "s", prefix, view: { ...defaultBodyView, ...view } });

const navOf = (screen: ScreenOf<"Body">): Nav.Nav => Nav.push(Nav.push(Nav.initial, trace), screen);

const stored = (text: string, view: BodyView): BodyContent => {
    const doc = docOf(text, detect(text), view.raw);
    return BodyContent.Stored({
        text: { text, truncated: false, bytes: text.length, storedBytes: text.length, path: "/data/bodies/abc.txt" },
        doc,
        matches: matchesOf(doc, view.search),
    });
};

const contextOf = (
    screen: ScreenOf<"Body">,
    content: BodyContent = stored(pager, screen.view),
    bodies: ReadonlyArray<BodyRef> = refs,
): BodyContext => {
    const doc = content._tag === "Loading" ? docOf("", Option.none(), false) : content.doc;
    return {
        model: { spanName: "llm.chat", refs: bodies, ref: bodies[0] ?? refOf("x"), content },
        rows: rowsOf(doc, WIDTH, screen.view.wrap),
        viewport: VIEWPORT,
        width: WIDTH,
    };
};

const step = (screen: ScreenOf<"Body">, action: BodyAction, context = contextOf(screen)) =>
    stepBody(navOf(screen), screen, context, action);

const viewAfter = (screen: ScreenOf<"Body">, action: BodyAction, context = contextOf(screen)): BodyView => {
    const top = Nav.top(step(screen, action, context).nav);
    if (top._tag !== "Body") {
        throw new Error("not on Body");
    }
    return top.view;
};

describe("stepBody: scrolling", () => {
    it("moves by rows and pages, clamped to the last page", () => {
        expect(viewAfter(bodyScreen(), Action.Move({ by: "row", dir: "next" })).topLine).toBe(1);
        expect(viewAfter(bodyScreen(), Action.Move({ by: "row", dir: "prev" })).topLine).toBe(0);
        expect(viewAfter(bodyScreen({ topLine: 23 }), Action.Move({ by: "page", dir: "next" })).topLine).toBe(25);
        expect(viewAfter(bodyScreen(), Action.Move({ by: "halfPage", dir: "next" })).topLine).toBe(2);
        expect(viewAfter(bodyScreen(), Action.ScrollBody({ rows: 3 })).topLine).toBe(3);
    });

    it("moves from the clamped top when the stored one is past the end after a resize", () => {
        expect(viewAfter(bodyScreen({ topLine: 99 }), Action.Move({ by: "row", dir: "prev" })).topLine).toBe(24);
    });

    it("jumps to either end", () => {
        expect(viewAfter(bodyScreen(), Action.Jump({ to: "end" })).topLine).toBe(25);
        expect(viewAfter(bodyScreen({ topLine: 12 }), Action.Jump({ to: "start" })).topLine).toBe(0);
    });

    it("scrolls sideways by 8 only with wrapping off, up to the widest line", () => {
        const wrapped = bodyScreen();
        const nav = navOf(wrapped);
        expect(stepBody(nav, wrapped, contextOf(wrapped), Action.Sideways({ dir: "next" })).nav).toBe(nav);
        const sideways = (view: Partial<BodyView>, dir: "next" | "prev") => {
            const screen = bodyScreen({ wrap: false, ...view });
            const wide = contextOf(screen, stored(`short\n${"x".repeat(40)}`, screen.view));
            return viewAfter(screen, Action.Sideways({ dir }), wide).leftCol;
        };
        expect(sideways({}, "next")).toBe(8);
        expect(sideways({ leftCol: 16 }, "next"), "the widest line's end at the right edge").toBe(20);
        expect(sideways({}, "prev")).toBe(0);
    });
});

describe("stepBody: switching", () => {
    const busy = bodyScreen({
        search: "hit",
        wrap: false,
        raw: true,
        topLine: 7,
        leftCol: 8,
        current: Option.some(hitOn(26)),
    });

    it("Tab replaces the screen with the next body, keeping search, wrap and raw and resetting the position", () => {
        const next = step(busy, Action.CycleBody({ dir: "next" })).nav;
        expect(Nav.depth(next)).toBe(3);
        expect(Nav.top(next)).toEqual(
            bodyScreen(
                { search: "hit", wrap: false, raw: true, topLine: 0, leftCol: 0, current: Option.none() },
                "llm.response",
            ),
        );
    });

    it("Shift-Tab wraps to the last body", () => {
        expect(Nav.top(step(busy, Action.CycleBody({ dir: "prev" })).nav)).toMatchObject({ prefix: "llm.tool" });
    });

    it("Tab does nothing on a span with one body", () => {
        const screen = bodyScreen();
        const nav = navOf(screen);
        const one = contextOf(screen, stored(pager, screen.view), [refOf("llm.request")]);
        expect(stepBody(nav, screen, one, Action.CycleBody({ dir: "next" })).nav).toBe(nav);
    });

    it("r toggles raw and resets the position and the current match", () => {
        expect(viewAfter(busy, Action.ToggleRaw())).toEqual({
            ...busy.view,
            raw: false,
            topLine: 0,
            leftCol: 0,
            current: Option.none(),
        });
    });

    it("w toggles wrapping and resets the position but keeps the current match", () => {
        expect(viewAfter(busy, Action.ToggleWrap())).toEqual({ ...busy.view, wrap: true, topLine: 0, leftCol: 0 });
    });
});

describe("stepBody: n and N", () => {
    const searching = (view: Partial<BodyView>) => bodyScreen({ search: "hit", ...view });

    it("advances from the current match on the last page, where the top line cannot move", () => {
        const first = viewAfter(
            searching({ topLine: 25, current: Option.some(hitOn(26)) }),
            Action.NextMatch({ dir: "next" }),
        );
        expect(first).toMatchObject({ topLine: 25, current: Option.some(hitOn(27)) });
        const second = viewAfter(searching(first), Action.NextMatch({ dir: "next" }));
        expect(second).toMatchObject({ topLine: 25, current: Option.some(hitOn(29)) });
        const wrapped = viewAfter(searching(second), Action.NextMatch({ dir: "next" }));
        expect(wrapped, "around to the first, two rows from the top").toMatchObject({
            topLine: 0,
            current: Option.some(hitOn(2)),
        });
    });

    it("starts from the top row when the current match is out of sight", () => {
        expect(
            viewAfter(searching({ topLine: 10, current: Option.some(hitOn(2)) }), Action.NextMatch({ dir: "next" })),
            "the first match at or after the top row",
        ).toMatchObject({ topLine: 24, current: Option.some(hitOn(26)) });
        expect(
            viewAfter(searching({ topLine: 10 }), Action.NextMatch({ dir: "prev" })),
            "the last match before the top row",
        ).toMatchObject({ topLine: 0, current: Option.some(hitOn(2)) });
    });

    it("keeps the page when the next match is already on it", () => {
        expect(viewAfter(searching({ topLine: 23 }), Action.NextMatch({ dir: "next" }))).toMatchObject({
            topLine: 23,
            current: Option.some(hitOn(26)),
        });
    });

    it("says so when nothing matches", () => {
        const screen = bodyScreen({ search: "absent" });
        expect(step(screen, Action.NextMatch({ dir: "next" })).effects).toEqual([
            ShellEffect.Say({ text: "no matches" }),
        ]);
    });

    it("moves the columns to a match outside them with wrapping off", () => {
        const text = `${"a".repeat(50)} needle`;
        const screen = bodyScreen({ search: "needle", wrap: false });
        const view = viewAfter(screen, Action.NextMatch({ dir: "next" }), contextOf(screen, stored(text, screen.view)));
        expect(view, "8 columns before the match, clamped to the line's end").toMatchObject({
            leftCol: 37,
            current: Option.some(51),
        });
    });
});

describe("seekFirstMatch", () => {
    const seek = (screen: ScreenOf<"Body">, context = contextOf(screen)) => {
        const top = Nav.top(seekFirstMatch(navOf(screen), context));
        return top._tag === "Body" ? top.view : undefined;
    };

    it("goes to the first match at or after the top row", () => {
        expect(seek(bodyScreen({ search: "hit", topLine: 10 }))).toMatchObject({
            topLine: 24,
            current: Option.some(hitOn(26)),
        });
    });

    it("wraps to the first match when none is at or after the top row", () => {
        expect(seek(bodyScreen({ search: "solo", topLine: 10 }))).toMatchObject({
            topLine: 0,
            current: Option.some(hitOn(2) + "hit ".length),
        });
    });

    it("does nothing when the matches were found for another search", () => {
        const screen = bodyScreen({ search: "hit", topLine: 10 });
        const nav = navOf(screen);
        expect(seekFirstMatch(nav, contextOf(screen, stored(pager, { ...screen.view, search: "hi" })))).toBe(nav);
    });

    it("runs on ⏎ in the `/` input, which keeps the query", () => {
        const screen = bodyScreen({ search: "hit", topLine: 10 });
        const nav = navOf(screen);
        const snapshot = indexed([]);
        const submitted = stepShell(
            { ...initialKeyState, shell: Shell.Input({ cursor: 3, original: "", recall: Option.none() }) },
            {
                nav,
                snapshot,
                list: listFor(nav, snapshot),
                listRows: 10,
                trace: Option.none(),
                body: Option.some(contextOf(screen)),
                overlay: { total: 0, viewport: 0 },
            },
            Action.SubmitInput(),
        );
        expect(submitted.state.shell).toEqual(Shell.Screen());
        expect(Nav.top(submitted.nav)).toMatchObject({ view: { search: "hit", current: Option.some(hitOn(26)) } });
    });
});

describe("Esc on Body", () => {
    it("clears the search first, then goes back to the trace", () => {
        const searching = navOf(bodyScreen({ search: "hit" }));
        expect(dispatch("screen", searching, press("escape"))).toEqual(Option.some(Action.ClearQuery()));
        expect(dispatch("screen", navOf(bodyScreen()), press("escape"))).toEqual(Option.some(Action.Back()));
    });
});

describe("stepBody: handing off", () => {
    it("copies the text as shown with its size", () => {
        const screen = bodyScreen();
        const json = '{"a":1}';
        const copied = step(screen, Action.Copy(), contextOf(screen, stored(json, screen.view)));
        expect(copied.effects).toEqual([ShellEffect.Copy({ text: '{\n  "a": 1\n}', done: "copied 12 B" })]);
    });

    it("copies up to 100,000 bytes and refuses more, counting bytes, not characters", () => {
        const screen = bodyScreen();
        const at = step(screen, Action.Copy(), contextOf(screen, stored("a".repeat(100_000), screen.view)));
        expect(at.effects).toEqual([ShellEffect.Copy({ text: "a".repeat(100_000), done: "copied 100.0 KB" })]);
        const over = step(screen, Action.Copy(), contextOf(screen, stored("é".repeat(50_001), screen.view)));
        expect(over.effects).toEqual([ShellEffect.Say({ text: "too large to copy (100.0 KB), use e" })]);
    });

    it("copies nothing while the body loads", () => {
        const screen = bodyScreen();
        expect(step(screen, Action.Copy(), contextOf(screen, BodyContent.Loading())).effects).toEqual([]);
    });

    it("opens the stored file without a line, with a warning", () => {
        expect(step(bodyScreen(), Action.OpenEditor()).effects).toEqual([
            ShellEffect.Say({ text: EDIT_WARNING }),
            ShellEffect.Edit({ target: { file: "/data/bodies/abc.txt", line: Option.none(), col: Option.none() } }),
        ]);
    });

    it("says why a missing body cannot be edited", () => {
        const screen = bodyScreen();
        const doc = docOf("preview", Option.none(), false);
        const preview = BodyContent.Preview({ problem: Option.none(), doc, matches: matchesOf(doc, "") });
        expect(step(screen, Action.OpenEditor(), contextOf(screen, preview)).effects).toEqual([
            ShellEffect.Say({ text: "bodies/llm.request-sha.txt not found" }),
        ]);
    });
});
