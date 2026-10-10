import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option, Schema } from "effect";

import * as Nav from "../../src/nav/Nav.ts";
import { matchPrefix, PrefixMatch, presence, Presence, resolvePrefixes } from "../../src/nav/Resolve.ts";
import {
    bodyFor,
    defaultRunsView,
    defaultTracesView,
    defaultTraceView,
    Screen,
    TraceRow,
    TreeRow,
} from "../../src/nav/Screen.ts";
import { initialNav, initialReadDone, openArrivedTrace, openSingleRun } from "../../src/nav/Seed.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Phase, Snapshot } from "../../src/data/Snapshot.ts";

const none = Option.none<string>();
const some = Option.some;

const withPhase = (snapshot: Snapshot, phase: Phase): Snapshot => ({
    ...snapshot,
    status: { ...snapshot.status, phase },
});

const runIdA = "2026-10-07T10-01-00-000-0001";
const runIdB = "2026-10-07T10-02-00-000-0002";
const traceA = "9f3c11aa22bb33cc44dd55ee66ff7788";
const traceB = "9f3c99aa22bb33cc44dd55ee66ff7788";

const snapshot = indexed([
    record({ span: "a", run: runIdA, trace: traceA }),
    record({ span: "b", run: runIdB, trace: traceB }),
]);

describe("initialNav", () => {
    it("is the bare Runs screen without seeds", () => {
        expect(initialNav({ run: none, trace: none })).toStrictEqual(Nav.initial);
    });

    it("seeds --run as a selected run with its traces on top", () => {
        expect(initialNav({ run: some("2026-10-07T10-01"), trace: none }).stack).toStrictEqual([
            Screen.Runs({ view: { ...defaultRunsView, selected: some("2026-10-07T10-01") } }),
            Screen.Traces({ runId: "2026-10-07T10-01", idIsPrefix: true, view: defaultTracesView }),
        ]);
    });

    it("seeds --trace straight onto Runs", () => {
        expect(initialNav({ run: none, trace: some("9f3c") }).stack).toStrictEqual([
            Screen.Runs({ view: defaultRunsView }),
            Screen.Trace({ traceId: "9f3c", idIsPrefix: true, viaRun: none, view: defaultTraceView }),
        ]);
    });

    it("seeds --run and --trace as three screens, each selecting the next", () => {
        expect(initialNav({ run: some("2026"), trace: some("9f3c") }).stack).toStrictEqual([
            Screen.Runs({ view: { ...defaultRunsView, selected: some("2026") } }),
            Screen.Traces({
                runId: "2026",
                idIsPrefix: true,
                view: { ...defaultTracesView, selected: Option.some(TraceRow.Trace({ traceId: "9f3c" })) },
            }),
            Screen.Trace({ traceId: "9f3c", idIsPrefix: true, viaRun: some("2026"), view: defaultTraceView }),
        ]);
    });
});

const Ids = Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1));

describe("matchPrefix", () => {
    it.prop("always resolves an id by its full value", [Ids], ([ids]) => {
        const map = new Map(Arr.map(ids, (id) => [id, id] as const));
        Arr.forEach(ids, (id) => expect(matchPrefix(id, map)).toEqual(PrefixMatch.Found({ id })));
    });

    it.prop(
        "never resolves a prefix that two ids share and none equals",
        [Schema.String, Schema.String, Schema.String, Ids],
        ([prefix, a, b, others]) => {
            const first = `${prefix}${a}x`;
            const second = `${prefix}${b}y`;
            const map = new Map(
                Arr.map(
                    Arr.filter([first, second, ...others], (id) => id !== prefix),
                    (id) => [id, id] as const,
                ),
            );
            expect(matchPrefix(prefix, map)._tag).toBe("Ambiguous");
        },
    );

    it("prefers an exact id over longer ids that start with it, and counts the ambiguous", () => {
        const ids = new Map([
            ["9f3c", 1],
            ["9f3c1", 2],
            ["9f3c2", 3],
        ]);
        expect(matchPrefix("9f3c", ids)).toEqual(PrefixMatch.Found({ id: "9f3c" }));
        expect(matchPrefix("9f", ids)).toEqual(PrefixMatch.Ambiguous({ count: 3 }));
        expect(matchPrefix("9f3c1", ids)).toEqual(PrefixMatch.Found({ id: "9f3c1" }));
        expect(matchPrefix("aa", ids)).toEqual(PrefixMatch.NotFound());
    });
});

describe("resolvePrefixes", () => {
    it("rewrites a uniquely matched run and trace, and the selections that point at them", () => {
        const nav = initialNav({ run: some("2026-10-07T10-01"), trace: some("9f3c1") });
        expect(resolvePrefixes(nav, snapshot).stack).toStrictEqual([
            Screen.Runs({ view: { ...defaultRunsView, selected: some(runIdA) } }),
            Screen.Traces({
                runId: runIdA,
                idIsPrefix: false,
                view: { ...defaultTracesView, selected: Option.some(TraceRow.Trace({ traceId: traceA })) },
            }),
            Screen.Trace({ traceId: traceA, idIsPrefix: false, viaRun: some(runIdA), view: defaultTraceView }),
        ]);
    });

    it("leaves an ambiguous prefix unresolved and returns the same Nav", () => {
        const nav = initialNav({ run: none, trace: some("9f3c") });
        expect(resolvePrefixes(nav, snapshot)).toBe(nav);
    });

    it("resolves on the snapshot that makes the prefix unique, and never again", () => {
        const nav = initialNav({ run: none, trace: some("9f3c1") });
        const empty = indexed([]);
        expect(resolvePrefixes(nav, empty), "not in the file yet").toBe(nav);

        const resolved = resolvePrefixes(nav, snapshot);
        expect(Nav.top(resolved)).toMatchObject({ traceId: traceA, idIsPrefix: false });

        const longer = `${traceA}0`;
        const later = indexed([record({ span: "c", trace: longer })]);
        expect(resolvePrefixes(resolved, later), "a resolved id is not matched again").toBe(resolved);
        expect(resolvePrefixes(resolved, empty), "a Reset does not unresolve it").toBe(resolved);
    });

    it("keeps a selection the user has moved away from the seed", () => {
        const seeded = initialNav({ run: some("2026-10-07T10-01"), trace: none });
        const moved = Nav.updateBelow(seeded, "Runs", (view) => ({ ...view, selected: some(runIdB) }));
        expect(resolvePrefixes(moved, snapshot).stack[0].view.selected).toEqual(some(runIdB));
    });
});

describe("one-run files", () => {
    const one = indexed([record({ span: "a", run: runIdA })]);

    it("pushes the run's traces on the bare Runs screen when the file holds one run", () => {
        expect(openSingleRun(Nav.initial, one).stack).toStrictEqual([
            Nav.initial.stack[0],
            Screen.Traces({ runId: runIdA, idIsPrefix: false, view: defaultTracesView }),
        ]);
    });

    it("leaves several runs, no runs, and a seeded stack alone", () => {
        expect(openSingleRun(Nav.initial, snapshot)).toBe(Nav.initial);
        expect(openSingleRun(Nav.initial, indexed([]))).toBe(Nav.initial);
        const seeded = initialNav({ run: none, trace: some("9f3c") });
        expect(openSingleRun(seeded, one)).toBe(seeded);
    });

    it("waits for the end of the initial read", () => {
        expect(initialReadDone(withPhase(one, "loading"))).toBe(false);
        expect(initialReadDone(withPhase(one, "waiting"))).toBe(false);
        expect(initialReadDone(withPhase(one, "following"))).toBe(true);
        expect(initialReadDone(withPhase(one, "done"))).toBe(true);
    });
});

describe("presence", () => {
    const traceScreen = (traceId: string, idIsPrefix: boolean) =>
        Screen.Trace({ traceId, idIsPrefix, viaRun: none, view: defaultTraceView });

    it("finds a present id, exactly or by a unique prefix", () => {
        expect(presence(traceScreen(traceA, false), snapshot)).toEqual(Presence.Present());
        expect(presence(traceScreen("9f3c1", true), snapshot)).toEqual(Presence.Present());
        expect(presence(Screen.Runs({ view: defaultRunsView }), indexed([]))).toEqual(Presence.Present());
    });

    it("reports loading, ambiguous and missing ids", () => {
        expect(presence(traceScreen("abcd", true), withPhase(snapshot, "loading"))).toEqual(
            Presence.Loading({ noun: "trace", id: "abcd" }),
        );
        expect(presence(traceScreen("9f3c", true), snapshot)).toEqual(
            Presence.Ambiguous({ noun: "trace", id: "9f3c", count: 2 }),
        );
        expect(presence(traceScreen("9f3c", false), snapshot), "a full id is never matched as a prefix").toEqual(
            Presence.NotInFile({ noun: "trace", id: "9f3c", resetAt: Option.none() }),
        );
        const reset: Snapshot = {
            ...snapshot,
            status: { ...snapshot.status, lastReset: Option.some({ reason: "truncated", at: 5 }) },
        };
        expect(presence(Screen.Traces({ runId: "r9", idIsPrefix: false, view: defaultTracesView }), reset)).toEqual(
            Presence.NotInFile({ noun: "run", id: "r9", resetAt: some(5) }),
        );
    });

    it("looks for a body's span inside its trace", () => {
        expect(presence(bodyFor(traceA, "a", "llm.request"), snapshot)).toEqual(Presence.Present());
        expect(presence(bodyFor(traceA, "zz", "llm.request"), snapshot)).toEqual(
            Presence.NotInFile({ noun: "span", id: "zz", resetAt: Option.none() }),
        );
        expect(presence(bodyFor("gone", "a", "llm.request"), snapshot)._tag).toBe("NotInFile");
    });
});

describe("openArrivedTrace", () => {
    const seeded = (search = "") =>
        Nav.push(
            Nav.initial,
            Screen.Trace({
                traceId: "trace-1",
                idIsPrefix: false,
                viaRun: none,
                view: { ...defaultTraceView, search },
            }),
        );
    const arrived = indexed([
        record({ span: "root", name: "POST /orders" }),
        record({ span: "pay", parent: "root", name: "payment", startMs: 1001, exit: "Failure" }),
        record({ span: "ok", parent: "root", name: "notify", startMs: 1002 }),
    ]);
    const selected = (nav: Nav.Nav) => {
        const screen = Nav.top(nav);
        return screen._tag === "Trace" ? screen.view.selected : Option.none();
    };

    it("does nothing while the trace is absent", () => {
        const nav = seeded();
        expect(openArrivedTrace(nav, snapshot)).toBe(nav);
    });

    it("stores the opening selection the first time the trace is present, and only then", () => {
        const opened = openArrivedTrace(seeded(), arrived);
        expect(selected(opened)).toEqual(Option.some(TreeRow.Span({ spanId: "pay" })));
        const moved = Nav.update(opened, "Trace", (view) => ({
            ...view,
            selected: Option.some(TreeRow.Span({ spanId: "ok" })),
        }));
        expect(openArrivedTrace(moved, arrived)).toBe(moved);
    });

    it("honours a seeded search", () => {
        expect(selected(openArrivedTrace(seeded("notify"), arrived))).toEqual(
            Option.some(TreeRow.Span({ spanId: "ok" })),
        );
    });

    it("waits for a prefix to resolve", () => {
        const prefixed = Nav.push(
            Nav.initial,
            Screen.Trace({ traceId: "trace", idIsPrefix: true, viaRun: none, view: defaultTraceView }),
        );
        expect(openArrivedTrace(prefixed, arrived)).toBe(prefixed);
    });
});
