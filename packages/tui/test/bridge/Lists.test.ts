import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, HashSet, Option } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";

import { listAtom, SEARCH_DEBOUNCE_MILLIS, settledFilter } from "../../src/bridge/Lists.ts";
import { Index } from "../../src/data/Index.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultRunsView, TraceRow, tracesFor } from "../../src/nav/Screen.ts";
import { namedTraces } from "../support/lists.ts";
import { line, record } from "../support/records.ts";
import { indexed, ingestAll, status } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";
import type { ScreenList } from "../../src/model/screenList.ts";
import type { TracesView } from "../../src/nav/Screen.ts";

const snapshot = indexed([
    record({ span: "a", run: "r1", trace: "t1", service: "shop-api", startMs: 1000 }),
    record({ span: "b", run: "r1", trace: "t2", service: "shop-api", startMs: 2000, name: "pay", ms: 50 }),
    record({ span: "c", run: "r2", trace: "t3", service: "billing", startMs: 3000 }),
]);

const setup = (nav: Nav.Nav = Nav.initial, source: Snapshot = snapshot, at = 0) => {
    const registry = AtomRegistry.make();
    const navAtom = Atom.make(nav);
    const now = Atom.make(at);
    const list = listAtom(Atom.make(source), navAtom, now, settledFilter(navAtom));
    registry.mount(list);
    return { registry, navAtom, now, list: () => registry.get(list) };
};

const keys = (built: ScreenList): ReadonlyArray<string> => {
    switch (built._tag) {
        case "Runs":
            return Arr.map(built.list.rows, (row) => row.key);
        case "Traces":
            return Arr.map(built.list.rows, (row) => row.key);
        case "None":
            return [];
    }
};

const settle = Effect.sleep(SEARCH_DEBOUNCE_MILLIS + 50);

const onTraces = (runId = "r1") => Nav.push(Nav.initial, tracesFor(runId, defaultRunsView));

const setTraces = (registry: AtomRegistry.AtomRegistry, navAtom: Atom.Writable<Nav.Nav>, over: Partial<TracesView>) =>
    registry.update(navAtom, (nav) => Nav.update(nav, "Traces", (view) => ({ ...view, ...over })));

describe("listAtom", () => {
    it.live("applies a typed filter once typing pauses, and an emptied filter at once", () =>
        Effect.gen(function* () {
            const { registry, navAtom, list } = setup();
            expect(keys(list())).toEqual(["r2", "r1"]);
            registry.update(navAtom, (nav) => Nav.update(nav, "Runs", (view) => ({ ...view, filter: "shop" })));
            expect(keys(list()), "still debouncing").toEqual(["r2", "r1"]);
            yield* settle;
            expect(keys(list())).toEqual(["r1"]);
            registry.update(navAtom, (nav) => Nav.update(nav, "Runs", (view) => ({ ...view, filter: "" })));
            expect(keys(list())).toEqual(["r2", "r1"]);
        }),
    );

    it.live("applies a Traces filter once typing pauses", () =>
        Effect.gen(function* () {
            const { registry, navAtom, list } = setup(onTraces());
            setTraces(registry, navAtom, { filter: "pay" });
            expect(keys(list()), "still debouncing").toEqual(["t:t1", "t:t2"]);
            yield* settle;
            expect(keys(list())).toEqual(["t:t2"]);
        }),
    );

    it("builds the new screen's list at once when the screen changes, with its seeded filter", () => {
        const { registry, navAtom, list } = setup(
            Nav.update(Nav.initial, "Runs", (view) => ({ ...view, filter: "pay" })),
        );
        registry.update(navAtom, (nav) => Nav.push(nav, tracesFor("r1", { ...defaultRunsView, filter: "pay" })));
        expect(keys(list())).toEqual(["t:t2"]);
        registry.update(navAtom, Nav.back);
        expect(list()._tag).toBe("Runs");
    });

    it.live("never shows a filter typed on an earlier visit to the same run", () =>
        Effect.gen(function* () {
            const { registry, navAtom, list } = setup(onTraces());
            setTraces(registry, navAtom, { filter: "pay" });
            yield* settle;
            registry.update(navAtom, Nav.back);
            registry.update(navAtom, (nav) => Nav.push(nav, tracesFor("r1", { ...defaultRunsView, filter: "t1" })));
            expect(keys(list())).toEqual(["t:t1"]);
        }),
    );

    it.live("debounces typing that follows a push at once", () =>
        Effect.gen(function* () {
            const { registry, navAtom, list } = setup();
            registry.update(navAtom, (nav) => Nav.push(nav, tracesFor("r1", { ...defaultRunsView, filter: "t" })));
            setTraces(registry, navAtom, { filter: "t1" });
            expect(keys(list()), "still debouncing").toEqual(["t:t1", "t:t2"]);
            yield* settle;
            expect(keys(list())).toEqual(["t:t1"]);
        }),
    );

    it("rebuilds for a sort, a reverse and another run", () => {
        const { registry, navAtom, list } = setup();
        registry.update(navAtom, (nav) => Nav.update(nav, "Runs", (view) => ({ ...view, sort: "duration" })));
        expect(keys(list())).toEqual(["r1", "r2"]);
        registry.update(navAtom, (nav) => Nav.update(nav, "Runs", (view) => ({ ...view, reverse: true })));
        expect(keys(list())).toEqual(["r2", "r1"]);

        const traces = setup(onTraces());
        setTraces(traces.registry, traces.navAtom, { sort: "duration" });
        expect(keys(traces.list())).toEqual(["t:t2", "t:t1"]);
        setTraces(traces.registry, traces.navAtom, { reverse: true });
        expect(keys(traces.list())).toEqual(["t:t1", "t:t2"]);
        traces.registry.update(traces.navAtom, (nav) => Nav.push(Nav.back(nav), tracesFor("r2", defaultRunsView)));
        expect(keys(traces.list())).toEqual(["t:t3"]);
    });

    describe("groups", () => {
        const grouped = indexed(namedTraces("o", "POST /orders", 20, 10_000, new Set([2])));
        const traces = () => setup(Nav.push(Nav.initial, tracesFor("run-1", defaultRunsView)), grouped);

        it("lays the rows out again when a group opens", () => {
            const { registry, navAtom, list } = traces();
            expect(keys(list())).toEqual(["h:POST /orders", "t:o002", "m:POST /orders"]);
            setTraces(registry, navAtom, { openGroups: HashSet.make("POST /orders") });
            expect(keys(list())).toHaveLength(21);
        });

        it("shows a selected member the closed group hides, and keeps the same list while only the selection moves", () => {
            const { registry, navAtom, list } = traces();
            const before = list();
            setTraces(registry, navAtom, { selected: Option.some(TraceRow.Trace({ traceId: "o002" })) });
            expect(list(), "a shown member pins nothing").toBe(before);
            setTraces(registry, navAtom, { selected: Option.some(TraceRow.Trace({ traceId: "o009" })) });
            expect(keys(list())).toEqual(["h:POST /orders", "t:o002", "t:o009", "m:POST /orders"]);
        });
    });

    it("stops showing a rootless trace as running once nothing has arrived for 5 s", () => {
        const at = 1_760_000_000_000;
        const following = ingestAll(
            new Index(),
            [line(record({ span: "orphan", run: "r1", trace: "t1", parent: "gone", startMs: 1000 }))],
            Option.some(at),
        ).freeze({ ...status, phase: "following", lastRecordAt: Option.some(at) });
        const { registry, now, list } = setup(onTraces(), following, at + 1000);
        const states = () => {
            const built = list();
            return built._tag === "Traces"
                ? Arr.map(built.list.rows, (row) => (row._tag === "Trace" ? row.item.state : row._tag))
                : [];
        };
        expect(states()).toEqual(["running"]);
        registry.set(now, at + 10_000);
        expect(states()).toEqual(["partial"]);
        const idle = list();
        registry.set(now, at + 11_000);
        expect(list(), "nothing can be live, so time passing rebuilds nothing").toBe(idle);
    });
});
