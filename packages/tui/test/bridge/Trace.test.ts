import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Option } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";

import { SEARCH_DEBOUNCE_MILLIS, settledFilter } from "../../src/bridge/Lists.ts";
import { bodyStatsAtom, traceModelAtom } from "../../src/bridge/Trace.ts";
import { defaultPanes } from "../../src/model/panes.ts";
import { traceFrame } from "../../src/model/traceFrame.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultTraceView, Screen, TreeRow } from "../../src/nav/Screen.ts";
import { log } from "../support/records.ts";
import { indexed } from "../support/store.ts";
import { span } from "../support/traces.ts";

import type { TraceModel } from "../../src/model/traceModel.ts";
import type { TraceView } from "../../src/nav/Screen.ts";

const snapshot = indexed([
    span("root", null, 0, { ms: 10, events: [log("charging"), log("declined", "WARN")] }),
    span("pay", "root", 1, {
        attrs: {
            "request.sha256": "short",
            "request.bytes": 10,
            "request.preview": "{}",
            "response.sha256": "gone",
            "response.bytes": 5,
            "response.preview": "{}",
        },
    }),
]);

const navOf = (view: Partial<TraceView>): Nav.Nav =>
    Nav.push(
        Nav.initial,
        Screen.Trace({
            traceId: "trace-1",
            idIsPrefix: false,
            viaRun: Option.none(),
            view: { ...defaultTraceView, ...view },
        }),
    );

const setup = (view: Partial<TraceView> = {}) => {
    const registry = AtomRegistry.make();
    const navAtom = Atom.make(navOf(view));
    const model = traceModelAtom(Atom.make(snapshot), navAtom, settledFilter(navAtom));
    registry.mount(model);
    const setView = (over: Partial<TraceView>) =>
        registry.update(navAtom, (nav) => Nav.update(nav, "Trace", (current) => ({ ...current, ...over })));
    return { registry, navAtom, model, current: () => Option.getOrThrow(registry.get(model)), setView };
};

const messages = (model: TraceModel) => Arr.map(model.logs.entries, (entry) => entry.message);

describe("traceModelAtom", () => {
    it("keeps the same rows while only the selection moves", () => {
        const { current, setView } = setup({ selected: Option.some(TreeRow.Span({ spanId: "root" })) });
        const before = current();
        setView({ selected: Option.some(TreeRow.Span({ spanId: "pay" })) });
        const after = current();
        expect(after.index).toBe(1);
        expect(after.tree, "a selection move does not flatten again").toBe(before.tree);
    });

    it.live("applies a typed log filter once typing pauses", () =>
        Effect.gen(function* () {
            const { current, setView } = setup({ logScope: "trace" });
            expect(messages(current())).toEqual(["charging", "declined"]);
            setView({ logFilter: "warn" });
            expect(messages(current()), "still debouncing").toEqual(["charging", "declined"]);
            yield* Effect.sleep(SEARCH_DEBOUNCE_MILLIS + 50);
            expect(messages(current())).toEqual(["declined"]);
        }),
    );

    it("is None on any screen but a Trace screen", () => {
        const registry = AtomRegistry.make();
        const navAtom = Atom.make(Nav.initial);
        expect(registry.get(traceModelAtom(Atom.make(snapshot), navAtom, settledFilter(navAtom)))).toEqual(
            Option.none(),
        );
    });
});

describe("bodyStatsAtom", () => {
    it("marks a body file shorter than its record truncated, and an absent one missing", () => {
        const { registry, model, current } = setup({ selected: Option.some(TreeRow.Span({ spanId: "pay" })) });
        const sizes = new Map([["short", Option.some(3)]]);
        const stats = bodyStatsAtom(
            model,
            Atom.family((sha256: string) => Atom.make(Effect.succeed(sizes.get(sha256) ?? Option.none<number>()))),
        );
        const frame = traceFrame(current(), defaultTraceView, {
            size: { width: 120, height: 40 },
            panes: defaultPanes,
            now: 0,
            snapshot,
            bodyStats: registry.get(stats),
        });
        const texts = Arr.map(frame.details.rows, (row) =>
            Arr.join(
                Arr.map(row.line, (part) => part.text),
                "",
            ),
        );
        expect(Arr.filter(texts, (text) => text.includes("⚠"))).toEqual([
            expect.stringMatching(/^request .* ⚠ truncated$/),
            expect.stringMatching(/^response .* ⚠ missing$/),
        ]);
    });
});
