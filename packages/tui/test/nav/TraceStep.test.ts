import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet, Option } from "effect";

import { Action, ClickTarget } from "../../src/keys/Action.ts";
import { defaultPanes } from "../../src/model/panes.ts";
import { traceContext } from "../../src/model/traceFrame.ts";
import { traceModelOf } from "../../src/model/traceModel.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { bodyFor, defaultTraceView, Screen, TreeRow } from "../../src/nav/Screen.ts";
import { ShellEffect } from "../../src/nav/ScreenStep.ts";
import { seekMatch, stepTrace } from "../../src/nav/TraceStep.ts";
import { log } from "../support/records.ts";
import { indexed } from "../support/store.ts";
import { siblings, span } from "../support/traces.ts";

import type { TraceAction } from "../../src/keys/Action.ts";
import type { Panes } from "../../src/model/panes.ts";
import type { GroupKey, TraceView } from "../../src/nav/Screen.ts";
import type { ScreenStep } from "../../src/nav/ScreenStep.ts";
import type { JsonlSpanEvent } from "@wmaurer/otelscope-effect/format";

const declined = (offsetMs: number): JsonlSpanEvent => ({
    name: "exception",
    offsetMs,
    attrs: {
        "exception.type": "PaymentDeclined",
        "exception.message": "",
        "exception.stacktrace": "PaymentDeclined: \n    at <anonymous> (fixture/scenarios.ts:120:15)",
    },
});

const at = (offsetMs: number, event: JsonlSpanEvent): JsonlSpanEvent => ({ ...event, offsetMs });

const snapshot = indexed([
    span("root", null, 0, { name: "POST /orders", ms: 100, exit: "Failure" }),
    span("validate", "root", 1, { name: "order.validate", ms: 2 }),
    span("pay", "root", 3, {
        name: "payment.charge",
        ms: 20,
        exit: "Failure",
        events: [declined(19), at(1, log("charging"))],
        site: { file: "fixture/scenarios.ts", line: 154, col: 16 },
        attrs: { "request.sha256": "abc", "request.bytes": 12, "request.preview": "{}" },
    }),
    span("attempt", "pay", 4, {
        name: "payment.attempt",
        ms: 10,
        exit: "Failure",
        events: [declined(9), at(2, log("declined", "ERROR"))],
    }),
    ...siblings("row", "root", "import.row", 20, 30, (i) => ({
        exit: i === 4 ? "Failure" : "Success",
        events: i === 9 ? [log("row nine")] : [],
    })),
    span("notify", "root", 60, { name: "notify", exit: "Interrupted" }),
]);
const trace = snapshot.traces.get("trace-1")!;

const navOf = (view: Partial<TraceView> = {}): Nav.Nav =>
    Nav.push(
        Nav.initial,
        Screen.Trace({
            traceId: "trace-1",
            idIsPrefix: false,
            viaRun: Option.none(),
            view: { ...defaultTraceView, ...view },
        }),
    );

const viewOf = (nav: Nav.Nav): TraceView => {
    const screen = Nav.top(nav);
    if (screen._tag !== "Trace") {
        throw new Error(`top is ${screen._tag}`);
    }
    return screen.view;
};

const step = (
    nav: Nav.Nav,
    action: TraceAction,
    panes: Panes = defaultPanes,
    size = { width: 120, height: 40 },
): ScreenStep => {
    const screen = Nav.top(nav);
    if (screen._tag !== "Trace") {
        throw new Error("not on a Trace screen");
    }
    const model = traceModelOf(trace, screen.view, screen.view.logFilter);
    const context = traceContext(model, {
        size,
        panes,
        now: 0,
        snapshot,
        bodyStats: new Map(),
    });
    return stepTrace(nav, screen, context, action);
};

const selectedAfter = (nav: Nav.Nav, ...actions: ReadonlyArray<TraceAction>) =>
    viewOf(Arr.reduce(actions, nav, (current, action) => step(current, action).nav)).selected;

const small = { width: 80, height: 24 };
const spanRow = (spanId: string) => Option.some(TreeRow.Span({ spanId }));
const down = Action.Move({ by: "row", dir: "next" });
const up = Action.Move({ by: "row", dir: "prev" });

describe("moving", () => {
    it("moves the tree selection by rows, stopping at the ends", () => {
        const nav = navOf({ selected: spanRow("root") });
        expect(selectedAfter(nav, down, down)).toEqual(spanRow("pay"));
        expect(selectedAfter(nav, up)).toEqual(spanRow("root"));
        expect(selectedAfter(nav, Action.Jump({ to: "end" }))).toEqual(spanRow("notify"));
    });

    it("moves from the row the selection shows as when the stored span is hidden", () => {
        const nav = navOf({ selected: spanRow("attempt"), folded: HashSet.make("pay") });
        expect(selectedAfter(nav, down), "the row after the folded pay").toEqual(
            Option.some(TreeRow.Group({ key: "root|import.row" })),
        );
    });

    it("scrolls details and moves the logs cursor when they have focus", () => {
        const details = navOf({ selected: spanRow("pay"), pane: "details" });
        expect(viewOf(step(details, down, defaultPanes, small).nav).detailsTop).toBe(1);
        expect(step(details, down).nav, "everything fits at 120×40").toBe(details);
        const logs = navOf({ selected: spanRow("root"), pane: "logs" });
        const moved = viewOf(step(logs, down).nav);
        expect(moved.logCursor, "from the first log to the second").toEqual(Option.some("attempt:1"));
        expect(moved.selected, "the tree stays").toEqual(spanRow("root"));
    });
});

describe("panes", () => {
    it("focuses and cycles panes", () => {
        const nav = navOf({ selected: spanRow("root") });
        expect(viewOf(step(nav, Action.FocusPane({ pane: "logs" })).nav).pane).toBe("logs");
        expect(viewOf(step(nav, Action.CyclePane({ dir: "prev" })).nav).pane).toBe("logs");
    });

    it("resizes through SetPanes, clamped, without touching the Nav", () => {
        const nav = navOf({ selected: spanRow("root") });
        const wider = step(nav, Action.ResizeSplit({ delta: 5 }));
        expect(wider.nav).toBe(nav);
        expect(wider.effects).toEqual([ShellEffect.SetPanes({ panes: { split: 55, nameColumn: 32 } })]);
        expect(step(nav, Action.ResizeSplit({ delta: -5 }), { split: 25, nameColumn: 32 }).effects).toEqual([
            ShellEffect.SetPanes({ panes: { split: 25, nameColumn: 32 } }),
        ]);
        expect(step(nav, Action.SetSplit({ percent: 93 })).effects).toEqual([
            ShellEffect.SetPanes({ panes: { split: 80, nameColumn: 32 } }),
        ]);
    });

    it("widens the name column from the width it is drawn at", () => {
        const nav = navOf({ selected: spanRow("root") });
        expect(step(nav, Action.ResizeNameColumn({ delta: 5 }), { split: 50, nameColumn: 500 }).effects).toEqual([
            ShellEffect.SetPanes({ panes: { split: 50, nameColumn: 42 } }),
        ]);
    });

    it("cycles the log scope", () => {
        expect(viewOf(step(navOf(), Action.CycleLogScope()).nav).logScope).toBe("trace");
    });
});

describe("folding", () => {
    it("toggles, folds to the parent, unfolds, expands and collapses", () => {
        const nav = navOf({ selected: spanRow("pay") });
        const folded = step(nav, Action.ToggleFold()).nav;
        expect(HashSet.has(viewOf(folded).folded, "pay")).toBe(true);
        expect(viewOf(step(folded, Action.Unfold()).nav).folded).toEqual(viewOf(nav).folded);
        expect(selectedAfter(navOf({ selected: spanRow("attempt") }), Action.FoldOrParent())).toEqual(spanRow("pay"));
        const collapsed = viewOf(step(nav, Action.CollapseAll()).nav);
        expect(Arr.fromIterable(collapsed.folded)).toEqual(["pay"]);
        expect(HashSet.size(viewOf(step(nav, Action.ExpandAll()).nav).openGroups)).toBe(1);
    });
});

describe("n and N", () => {
    it("walks failure origins and interrupted spans in tree order, wrapping", () => {
        const nav = navOf({ selected: spanRow("root") });
        const next = Action.NextProblem({ dir: "next" });
        expect(selectedAfter(nav, next)).toEqual(spanRow("attempt"));
        expect(selectedAfter(nav, next, next)).toEqual(spanRow("row-004"));
        expect(selectedAfter(nav, next, next, next)).toEqual(spanRow("notify"));
        expect(selectedAfter(nav, next, next, next, next)).toEqual(spanRow("attempt"));
        expect(selectedAfter(nav, Action.NextProblem({ dir: "prev" }))).toEqual(spanRow("notify"));
    });

    it("leaves a closed group closed when landing on its failed member", () => {
        const landed = viewOf(step(navOf({ selected: spanRow("pay") }), Action.NextProblem({ dir: "next" })).nav);
        expect(HashSet.size(landed.openGroups)).toBe(0);
    });

    it("says so when there are no problems", () => {
        const clean = indexed([span("root", null, 0)]);
        const model = traceModelOf(clean.traces.get("trace-1")!, defaultTraceView, "");
        const nav = navOf();
        const screen = Nav.top(nav);
        if (screen._tag !== "Trace") {
            throw new Error("not on a Trace screen");
        }
        const context = traceContext(model, {
            size: { width: 120, height: 40 },
            panes: defaultPanes,
            now: 0,
            snapshot: clean,
            bodyStats: new Map(),
        });
        expect(stepTrace(nav, screen, context, Action.NextProblem({ dir: "next" })).effects).toEqual([
            ShellEffect.Say({ text: "no problems" }),
        ]);
    });

    it("walks matches while searching, unfolding and opening groups on the way", () => {
        const nav = navOf({ selected: spanRow("root"), search: "row nine", folded: HashSet.make("root") });
        const landed = viewOf(step(nav, Action.NextMatch({ dir: "next" })).nav);
        expect(landed.selected).toEqual(spanRow("row-009"));
        expect(Arr.fromIterable(landed.folded)).toEqual([]);
        expect(Arr.fromIterable(landed.openGroups)).toEqual(["root|import.row"]);
        expect(step(navOf({ search: "zebra" }), Action.NextMatch({ dir: "next" })).effects).toEqual([
            ShellEffect.Say({ text: "no matches" }),
        ]);
    });
});

describe("o", () => {
    it("goes from a propagated span to its origin, and says when there is none", () => {
        expect(selectedAfter(navOf({ selected: spanRow("root") }), Action.GoToOrigin())).toEqual(spanRow("attempt"));
        expect(step(navOf({ selected: spanRow("validate") }), Action.GoToOrigin()).effects).toEqual([
            ShellEffect.Say({ text: "no cause origin" }),
        ]);
    });
});

describe("logs ⏎", () => {
    it("selects the log's span, unfolding to it, and keeps focus and cursor in the logs", () => {
        const nav = navOf({
            selected: spanRow("root"),
            pane: "logs",
            logCursor: Option.some("attempt:1"),
            folded: HashSet.make("pay"),
        });
        const view = viewOf(step(nav, Action.GoToLogSpan()).nav);
        expect([view.selected, view.pane, view.logCursor]).toEqual([
            spanRow("attempt"),
            "logs",
            Option.some("attempt:1"),
        ]);
        expect(HashSet.has(view.folded, "pay")).toBe(false);
    });
});

describe("b and e", () => {
    it("pushes the Body screen on the span's first body, or says there is none", () => {
        expect(Nav.top(step(navOf({ selected: spanRow("pay") }), Action.OpenBody()).nav)).toEqual(
            bodyFor("trace-1", "pay", "request"),
        );
        expect(step(navOf({ selected: spanRow("root") }), Action.OpenBody()).effects).toEqual([
            ShellEffect.Say({ text: "no bodies on this span" }),
        ]);
    });

    it("hands the source location to the editor, or says there is none", () => {
        expect(step(navOf({ selected: spanRow("pay") }), Action.OpenEditor()).effects).toEqual([
            ShellEffect.Edit({
                target: { file: "fixture/scenarios.ts", line: Option.some(154), col: Option.some(16) },
            }),
        ]);
        expect(step(navOf({ selected: spanRow("root") }), Action.OpenEditor()).effects).toEqual([
            ShellEffect.Say({ text: "no source location for this span" }),
        ]);
    });
});

describe("clicks", () => {
    const click = (pane: "tree" | "details" | "logs", target: ClickTarget) => Action.Click({ pane, target });

    it("selects a tree row and focuses the tree; a click on the selected row toggles it", () => {
        const nav = navOf({ selected: spanRow("root"), pane: "logs" });
        const selected = viewOf(step(nav, click("tree", ClickTarget.Row({ key: "s:pay" }))).nav);
        expect([selected.selected, selected.pane]).toEqual([spanRow("pay"), "tree"]);
        const again = viewOf(
            step(navOf({ selected: spanRow("pay") }), click("tree", ClickTarget.Row({ key: "s:pay" }))).nav,
        );
        expect(HashSet.has(again.folded, "pay")).toBe(true);
    });

    it("toggles a group row clicked anywhere, selecting it", () => {
        const view = viewOf(
            step(navOf({ selected: spanRow("root") }), click("tree", ClickTarget.Mark({ key: "g:root|import.row" })))
                .nav,
        );
        expect(view.selected).toEqual(Option.some(TreeRow.Group({ key: "root|import.row" })));
        expect(Arr.fromIterable(view.openGroups)).toEqual(["root|import.row" satisfies GroupKey]);
    });

    it("moves the logs cursor, and goes to the log's span on a second click", () => {
        const nav = navOf({ selected: spanRow("root") });
        const first = step(nav, click("logs", ClickTarget.Row({ key: "attempt:1" }))).nav;
        expect([viewOf(first).logCursor, viewOf(first).pane]).toEqual([Option.some("attempt:1"), "logs"]);
        expect(viewOf(step(first, click("logs", ClickTarget.Row({ key: "attempt:1" }))).nav).selected).toEqual(
            spanRow("attempt"),
        );
    });

    it("opens a body from its details row, and only focuses on other clicks", () => {
        const nav = navOf({ selected: spanRow("pay") });
        expect(Nav.top(step(nav, click("details", ClickTarget.Body({ prefix: "request" }))).nav)).toEqual(
            bodyFor("trace-1", "pay", "request"),
        );
        expect(viewOf(step(nav, click("details", ClickTarget.Pane())).nav).pane).toBe("details");
    });

    it("scrolls details with the wheel without moving focus", () => {
        const view = viewOf(
            step(navOf({ selected: spanRow("pay") }), Action.ScrollDetails({ rows: 3 }), defaultPanes, small).nav,
        );
        expect([view.detailsTop, view.pane]).toEqual([3, "tree"]);
    });
});

describe("seekMatch", () => {
    it("moves to the first match at or after the selection, opening its group", () => {
        const view = viewOf(seekMatch(navOf({ selected: spanRow("validate"), search: "row nine" }), snapshot));
        expect(view.selected).toEqual(spanRow("row-009"));
        expect(Arr.fromIterable(view.openGroups)).toEqual(["root|import.row"]);
    });

    it("keeps a selection that matches, and moves nowhere when no match lies at or after it", () => {
        const onMatch = navOf({ selected: spanRow("pay"), search: "payment" });
        expect(seekMatch(onMatch, snapshot)).toBe(onMatch);
        const past = navOf({ selected: spanRow("notify"), search: "payment" });
        expect(seekMatch(past, snapshot)).toBe(past);
    });

    it("does nothing for the logs filter", () => {
        const logs = navOf({ selected: spanRow("root"), pane: "logs", search: "payment" });
        expect(seekMatch(logs, snapshot)).toBe(logs);
    });
});
