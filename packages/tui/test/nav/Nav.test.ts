import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option, Schema } from "effect";

import * as Nav from "../../src/nav/Nav.ts";
import { activeQuery, clearQuery } from "../../src/nav/Query.ts";
import {
    bodyFor,
    defaultRunsView,
    defaultTracesView,
    defaultTraceView,
    Screen,
    traceFor,
    tracesFor,
} from "../../src/nav/Screen.ts";

const ScreenSeed = Schema.Struct({
    tag: Schema.Literals(["Runs", "Traces", "Trace", "Body"]),
    id: Schema.String,
});

const screenOf = (seed: typeof ScreenSeed.Type): Screen => {
    switch (seed.tag) {
        case "Runs":
            return Screen.Runs({ view: { ...defaultRunsView, filter: seed.id } });
        case "Traces":
            return Screen.Traces({ runId: seed.id, idIsPrefix: false, view: defaultTracesView });
        case "Trace":
            return Screen.Trace({ traceId: seed.id, idIsPrefix: false, viaRun: Option.none(), view: defaultTraceView });
        case "Body":
            return bodyFor("t", seed.id, "llm.request");
    }
};

const navOf = (seeds: ReadonlyArray<typeof ScreenSeed.Type>): Nav.Nav =>
    Arr.reduce(seeds, Nav.initial, (nav, seed) => Nav.push(nav, screenOf(seed)));

const Op = Schema.Struct({ op: Schema.Literals(["push", "replace", "back", "update"]), screen: ScreenSeed });

const apply = (nav: Nav.Nav, { op, screen }: typeof Op.Type): Nav.Nav => {
    switch (op) {
        case "push":
            return Nav.push(nav, screenOf(screen));
        case "replace":
            return Nav.replace(nav, screenOf(screen));
        case "back":
            return Nav.back(nav);
        case "update":
            return Nav.update(nav, "Runs", (view) => ({ ...view, filter: screen.id }));
    }
};

const Stack = Schema.Array(ScreenSeed).check(Schema.isMaxLength(6));

describe("Nav", () => {
    it.prop("back after push is the identity", [Stack, ScreenSeed], ([seeds, seed]) => {
        const nav = navOf(seeds);
        expect(Nav.back(Nav.push(nav, screenOf(seed)))).toStrictEqual(nav);
    });

    it.prop("replace never grows the stack", [Stack, ScreenSeed], ([seeds, seed]) => {
        const nav = navOf(seeds);
        expect(Nav.depth(Nav.replace(nav, screenOf(seed)))).toBeLessThanOrEqual(Nav.depth(nav));
    });

    it.prop(
        "keeps Runs at the head through any sequence of operations",
        [Schema.Array(Op).check(Schema.isMaxLength(12))],
        ([ops]) => {
            const nav = Arr.reduce(ops, Nav.initial, apply);
            expect(nav.stack[0]._tag).toBe("Runs");
        },
    );

    it("does nothing going back from the bare Runs screen", () => {
        expect(Nav.back(Nav.initial)).toBe(Nav.initial);
    });

    it("replaces the top screen, and the head only with another Runs screen", () => {
        const traces = tracesFor("run-1", defaultRunsView);
        const body = bodyFor("t", "s", "a");
        const nav = Nav.push(Nav.initial, traces);
        expect(Nav.replace(nav, body).stack).toStrictEqual([Nav.initial.stack[0], body]);
        expect(Nav.replace(Nav.initial, body), "a Body cannot become the head").toBe(Nav.initial);
        const filtered = Screen.Runs({ view: { ...defaultRunsView, filter: "shop" } });
        expect(Nav.replace(Nav.initial, filtered).stack).toStrictEqual([filtered]);
    });

    it("updates the top view only when the top has the expected tag", () => {
        const nav = Nav.push(Nav.initial, tracesFor("run-1", defaultRunsView));
        const sorted = Nav.update(nav, "Traces", (view) => ({ ...view, sort: "duration" }));
        expect(Nav.top(sorted)).toMatchObject({ _tag: "Traces", view: { sort: "duration" } });
        expect(sorted.stack[0], "the screens below are untouched").toBe(nav.stack[0]);
        expect(
            Nav.update(nav, "Runs", (view) => ({ ...view, filter: "x" })),
            "a stale handler",
        ).toBe(nav);
        expect(
            Nav.update(nav, "Traces", (view) => view),
            "an unchanged view",
        ).toBe(nav);
    });

    it("updates the screen under the top", () => {
        const nav = Nav.push(Nav.initial, tracesFor("run-1", defaultRunsView));
        const selected = Nav.updateBelow(nav, "Runs", (view) => ({ ...view, selected: Option.some("run-1") }));
        expect(selected.stack[0].view.selected).toEqual(Option.some("run-1"));
        expect(selected.stack[1]).toBe(nav.stack[1]);
        expect(Nav.updateBelow(Nav.initial, "Runs", (view) => ({ ...view, filter: "x" }))).toBe(Nav.initial);
    });
});

describe("Screen pushes", () => {
    it("seeds the list's query into the pushed screen once", () => {
        const traces = tracesFor("run-1", { ...defaultRunsView, filter: "payment" });
        expect(traces).toMatchObject({ runId: "run-1", idIsPrefix: false, view: { filter: "payment" } });
        const trace = traceFor("t1", Option.some("run-1"), { ...defaultTracesView, filter: "declined" }, Option.none());
        expect(trace.view).toEqual({ ...defaultTraceView, search: "declined" });
        expect(trace.view.logFilter, "the log filter is not seeded").toBe("");
    });
});

describe("Query", () => {
    const trace = (pane: "tree" | "details" | "logs") =>
        Nav.push(
            Nav.initial,
            Screen.Trace({
                traceId: "t1",
                idIsPrefix: false,
                viaRun: Option.none(),
                view: { ...defaultTraceView, pane, search: "boom", logFilter: "warn" },
            }),
        );

    it("reads and clears the focused pane's query", () => {
        expect(activeQuery(trace("tree"))).toBe("boom");
        expect(activeQuery(trace("details"))).toBe("boom");
        expect(activeQuery(trace("logs"))).toBe("warn");
        expect(Nav.top(clearQuery(trace("logs")))).toMatchObject({ view: { search: "boom", logFilter: "" } });
        expect(Nav.top(clearQuery(trace("tree")))).toMatchObject({ view: { search: "", logFilter: "warn" } });

        const runs = Nav.update(Nav.initial, "Runs", (view) => ({ ...view, filter: "shop" }));
        expect(activeQuery(clearQuery(runs))).toBe("");
        expect(clearQuery(Nav.initial), "nothing to clear").toBe(Nav.initial);
    });
});
