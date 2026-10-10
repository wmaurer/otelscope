import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet, Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { newRowsText } from "../../src/model/list.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultRunsView, TraceRow, TreeRow, tracesFor } from "../../src/nav/Screen.ts";
import { stepScreen } from "../../src/nav/Step.ts";
import { listFor, namedTraces, rootSpan } from "../support/lists.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { ScreenAction } from "../../src/keys/Action.ts";
import type { TracesView } from "../../src/nav/Screen.ts";

const snapshot: Snapshot = indexed([
    ...namedTraces("o", "POST /orders", 25, 10_000, new Set([3, 7, 11, 15, 19, 22])),
    rootSpan("h1", "GET /health", 5_000),
    rootSpan("h2", "GET /health", 60_000),
    rootSpan("r2", "GET /other", 1_000, "Success", { run: "run-2" }),
    rootSpan("m1", "GET /multi", 70_000),
    record({ span: "m1-child", trace: "m1", parent: "m1-root", name: "needle.call", startMs: 70_001 }),
]);

const step = (nav: Nav.Nav, action: ScreenAction) =>
    stepScreen(nav, { snapshot, list: listFor(nav, snapshot), listRows: 10 }, action);

const runs = Nav.initial;
const traces = (view: Partial<TracesView> = {}) =>
    Nav.update(Nav.push(Nav.initial, tracesFor("run-1", defaultRunsView)), "Traces", (v) => ({ ...v, ...view }));
const tracesView = (nav: Nav.Nav) => {
    const top = Nav.top(nav);
    if (top._tag !== "Traces") {
        throw new Error(`expected Traces, got ${top._tag}`);
    }
    return top.view;
};
const selecting = (row: TraceRow) => traces({ selected: Option.some(row) });

describe("the Runs reducer", () => {
    it("opens the selected run with the filter seeded", () => {
        const filtered = Nav.update(runs, "Runs", (view) => ({ ...view, filter: "health" }));
        const opened = step(filtered, Action.Open()).nav;
        expect(Nav.top(opened)).toMatchObject({ _tag: "Traces", runId: "run-1", view: { filter: "health" } });
    });

    it("cycles the sort and reverses", () => {
        expect(Nav.top(step(runs, Action.CycleSort()).nav)).toMatchObject({ view: { sort: "service" } });
        expect(Nav.top(step(runs, Action.Reverse()).nav)).toMatchObject({ view: { reverse: true } });
    });

    it("stores the run a move lands on, and leaves following with newerThan", () => {
        const moved = step(runs, Action.Move({ by: "row", dir: "next" })).nav;
        expect(Nav.top(moved)).toMatchObject({
            view: { selected: Option.some("run-2"), newerThan: Option.some(5_000) },
        });
    });

    it("counts runs started after a move made under another sort, once back on newest", () => {
        const two = [
            rootSpan("a", "x", 1000, "Success", { run: "r1", service: "b" }),
            rootSpan("b", "y", 2000, "Success", { run: "r2", service: "a" }),
        ];
        const before = indexed(two);
        const after = indexed([...two, rootSpan("c", "z", 3000, "Success", { run: "r3", service: "c" })]);
        const stepBefore = (nav: Nav.Nav, action: ScreenAction) =>
            stepScreen(nav, { snapshot: before, list: listFor(nav, before), listRows: 10 }, action).nav;
        const byService = Nav.update(runs, "Runs", (view) => ({ ...view, sort: "service" }));
        const moved = stepBefore(byService, Action.Move({ by: "row", dir: "next" }));
        const newest = Arr.reduce(Arr.replicate(Action.CycleSort(), 3), moved, stepBefore);
        const view = Nav.top(newest);
        const built = listFor(newest, after);
        expect(
            view._tag === "Runs" && built._tag === "Runs" ? newRowsText(built.list, view.view) : Option.none(),
        ).toEqual(Option.some("↑ 1 new"));
    });
});

describe("the Traces reducer", () => {
    it("opens a trace with the filter seeded as its search and the opening selection", () => {
        const opened = step(selecting(TraceRow.Trace({ traceId: "o003" })), Action.Open()).nav;
        expect(Nav.top(opened)).toMatchObject({
            _tag: "Trace",
            traceId: "o003",
            viaRun: Option.some("run-1"),
            view: { selected: Option.some(TreeRow.Span({ spanId: "o003-root" })), search: "" },
        });
        const searched = step(
            traces({ selected: Option.some(TraceRow.Trace({ traceId: "m1" })), filter: "needle" }),
            Action.Open(),
        ).nav;
        expect(Nav.top(searched)).toMatchObject({
            view: { search: "needle", selected: Option.some(TreeRow.Span({ spanId: "m1-child" })) },
        });
    });

    it("toggles a group from its heading and keeps the heading selected", () => {
        const heading = TraceRow.Heading({ name: "POST /orders" });
        for (const action of [Action.Open(), Action.ToggleGroup(), Action.Pick({ key: "h:POST /orders" })]) {
            const view = tracesView(step(selecting(heading), action).nav);
            expect(HashSet.has(view.openGroups, "POST /orders"), action._tag).toBe(true);
            expect(view.selected).toEqual(Option.some(heading));
        }
        const closed = tracesView(step(selecting(heading), Action.ToggleGroup()).nav);
        expect(
            tracesView(
                step(
                    Nav.update(selecting(heading), "Traces", () => closed),
                    Action.Open(),
                ).nav,
            ).openGroups,
        ).toEqual(HashSet.empty());
    });

    it("toggles a group row on a single click, wherever the selection is", () => {
        const view = tracesView(
            step(selecting(TraceRow.Trace({ traceId: "h1" })), Action.Pick({ key: "m:POST /orders" })).nav,
        );
        expect(HashSet.has(view.openGroups, "POST /orders")).toBe(true);
        expect(view.selected).toEqual(Option.some(TraceRow.Trace({ traceId: "o000" })));
    });

    it("opens a group from its more row on the first member it hid", () => {
        const view = tracesView(step(selecting(TraceRow.More({ name: "POST /orders" })), Action.Open()).nav);
        expect(HashSet.has(view.openGroups, "POST /orders")).toBe(true);
        expect(view.selected).toEqual(Option.some(TraceRow.Trace({ traceId: "o000" })));
    });

    it("toggles a member's group with Space and keeps the member selected", () => {
        const member = TraceRow.Trace({ traceId: "o010" });
        const opened = tracesView(
            step(
                traces({ selected: Option.some(member), openGroups: HashSet.make("POST /orders") }),
                Action.ToggleGroup(),
            ).nav,
        );
        expect(opened.openGroups).toEqual(HashSet.empty());
        expect(opened.selected).toEqual(Option.some(member));
    });

    it("lands on a more row by opening it on the first or last hidden problem", () => {
        const lastShown = TraceRow.Trace({ traceId: "o019" });
        const next = tracesView(step(selecting(lastShown), Action.NextProblem({ dir: "next" })).nav);
        expect(HashSet.has(next.openGroups, "POST /orders")).toBe(true);
        expect(next.selected).toEqual(Option.some(TraceRow.Trace({ traceId: "o022" })));
        const prev = tracesView(
            step(selecting(TraceRow.Trace({ traceId: "o003" })), Action.NextProblem({ dir: "prev" })).nav,
        );
        expect(prev.selected, "wraps to the more row's last hidden problem").toEqual(
            Option.some(TraceRow.Trace({ traceId: "o022" })),
        );
    });

    it("leaves a missing selection stored until the user moves", () => {
        const missing = selecting(TraceRow.Trace({ traceId: "gone" }));
        expect(step(missing, Action.CycleSort()).nav).not.toBe(missing);
        expect(tracesView(step(missing, Action.CycleSort()).nav).selected).toEqual(
            Option.some(TraceRow.Trace({ traceId: "gone" })),
        );
        expect(
            tracesView(step(missing, Action.Move({ by: "row", dir: "next" })).nav).selected,
            "the move starts from the first row, which stands in for the missing one",
        ).toEqual(Option.some(TraceRow.Heading({ name: "POST /orders" })));
    });
});
