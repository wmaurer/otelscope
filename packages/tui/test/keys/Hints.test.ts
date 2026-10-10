import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Equal, HashSet, Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { dispatch } from "../../src/keys/Dispatch.ts";
import { helpSections } from "../../src/keys/Help.ts";
import { formatHint, hintBindings, hintFacts, hintLine } from "../../src/keys/Hints.ts";
import { defaultPanes } from "../../src/model/panes.ts";
import { traceContext } from "../../src/model/traceFrame.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { TreeRow } from "../../src/nav/Screen.ts";
import { stepTrace } from "../../src/nav/TraceStep.ts";
import { body, bodySearching, press, runs, trace, traces } from "../support/keys.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";
import { traceModelFor } from "../support/traces.ts";

import type { Mode } from "../../src/keys/Bindings.ts";
import type { HelpSection } from "../../src/keys/Help.ts";

const quiet = { toOrigin: false };
const line = (mode: Mode, nav: Nav.Nav, facts = quiet) =>
    Arr.join(Arr.map(hintLine(mode, nav, facts), formatHint), " · ");

describe("hint line", () => {
    it("matches 09's hint table on every screen and pane", () => {
        expect(line("screen", runs)).toBe("⏎ open · / filter · n problem · S sort · ? help");
        expect(line("screen", traces)).toBe("⏎ open · / filter · n problem · S sort · ? help");
        expect(line("screen", trace("tree"))).toBe("⏎ fold · / search · n problem · b body · ? help");
        expect(line("screen", trace("details"))).toBe("b body · e editor · 1 tree · ? help");
        expect(line("screen", trace("logs"))).toBe("⏎ go to span · / filter · s scope · ? help");
        expect(line("screen", body)).toBe("/ search · r raw · w wrap · y copy · ? help");
    });

    it("offers o origin only where o would move, and n match while a tree search is active", () => {
        expect(line("screen", trace("tree"), { toOrigin: true })).toBe(
            "⏎ fold · / search · n problem · b body · o origin · ? help",
        );
        expect(line("screen", trace("tree", { search: "boom" }))).toBe("⏎ fold · / search · n match · b body · ? help");
    });

    it("shows the overlay's close key in an overlay and nothing while typing", () => {
        expect(line("help", trace("tree"))).toBe("Esc close");
        expect(line("badLines", runs)).toBe("Esc close");
        expect(hintLine("input", runs, quiet)).toEqual([]);
    });

    it("marks ? help as the hint to keep longest", () => {
        expect(Arr.map(hintLine("screen", runs, quiet), (hint) => hint.sticky)).toEqual([
            false,
            false,
            false,
            false,
            true,
        ]);
    });

    it("only advertises a key that runs the advertised action now", () => {
        const navs = [
            runs,
            traces,
            trace("tree"),
            trace("tree", { search: "x" }),
            trace("details"),
            trace("logs"),
            body,
        ];
        Arr.forEach(navs, (nav) =>
            Arr.forEach([true, false], (toOrigin) =>
                Arr.forEach(hintBindings("screen", nav, { toOrigin }), (binding) =>
                    expect(dispatch("screen", nav, press(binding.keys[0])), binding.label).toEqual(
                        Option.some(binding.action),
                    ),
                ),
            ),
        );
    });
});

describe("hintFacts", () => {
    const snapshot = indexed([
        record({ span: "root" }),
        record({ span: "ok", parent: "root", startMs: 1001 }),
        record({ span: "passed", parent: "ok", startMs: 1002, exit: "Failure" }),
        record({ span: "origin", parent: "passed", startMs: 1003, exit: "Failure" }),
        record({ span: "other", parent: "root", startMs: 1004 }),
    ]);
    const on = (spanId: string, folded: ReadonlyArray<string> = []) =>
        trace("tree", { selected: Option.some(TreeRow.Span({ spanId })), folded: HashSet.fromIterable(folded) });
    const toOrigin = (nav: Nav.Nav) => hintFacts(traceModelFor(nav, snapshot)).toOrigin;
    const shownKey = (nav: Nav.Nav) => Option.map(Option.getOrThrow(traceModelFor(nav, snapshot)).entry, (e) => e.key);
    /** Whether `o` changes the row the selection shows as. */
    const moves = (nav: Nav.Nav) => {
        const screen = Nav.top(nav);
        if (screen._tag !== "Trace") {
            throw new Error("not on a Trace screen");
        }
        const context = traceContext(Option.getOrThrow(traceModelFor(nav, snapshot)), {
            size: { width: 120, height: 40 },
            panes: defaultPanes,
            now: 0,
            snapshot,
            bodyStats: new Map(),
        });
        const after = stepTrace(nav, screen, context, Action.GoToOrigin()).nav;
        return !Equal.equals(shownKey(after), shownKey(nav));
    };

    it("reads the row the selection shows as, not the stored span", () => {
        expect(toOrigin(on("passed")), "a span the failure passed through").toBe(true);
        expect(toOrigin(on("passed", ["ok"])), "it shows as its folded ancestor, which succeeded").toBe(false);
        expect(toOrigin(on("origin")), "an origin is its own origin").toBe(false);
        expect(toOrigin(on("origin", ["passed"])), "it shows as its folded parent, which passed it on").toBe(true);
        expect(toOrigin(runs)).toBe(false);
    });

    it("shows o origin exactly when o moves the selection", () => {
        const folds = [[], ["ok"], ["passed"], ["root"]];
        Arr.forEach(["root", "ok", "passed", "origin", "other"], (spanId) =>
            Arr.forEach(folds, (folded) => {
                const nav = on(spanId, folded);
                expect(toOrigin(nav), `${spanId} with ${Arr.join(folded, ",")} folded`).toBe(moves(nav));
            }),
        );
    });
});

describe("help", () => {
    const titles = (nav: Nav.Nav) => Arr.map(helpSections(nav), (section) => section.title);
    const rows = (nav: Nav.Nav, title: string) =>
        Arr.flatMap(
            Arr.filter(helpSections(nav), (section) => section.title === title),
            (section: HelpSection) => Arr.map(section.rows, (row) => `${row.keys} ${row.label}`),
        );

    it("lists the current screen's keys, then movement, then global keys", () => {
        expect(titles(runs)).toEqual(["Runs", "Movement", "Global"]);
        expect(rows(runs, "Runs")).toEqual([
            "⏎ open, or toggle a group",
            "Space toggle a group",
            "/ filter",
            "n/N problem",
            "S sort",
            "r reverse",
        ]);
        expect(rows(runs, "Movement")).toEqual([
            "j/k/↑/↓ row",
            "Ctrl-d/Ctrl-u half page",
            "PgDn/PgUp page",
            "g/G/Home/End ends",
        ]);
        expect(rows(runs, "Global")).toEqual([
            "Esc close, clear the query, or go back",
            "? help",
            "! bad lines",
            "q quit",
            "Ctrl-z suspend to the shell",
            "Ctrl-c quit from anywhere",
        ]);
        expect(titles(bodySearching)).toEqual(["Body", "Movement", "Global"]);
        expect(rows(body, "Body")).toContain("h/←/l/→ sideways");
    });

    it("lists the focused Trace pane first and marks it", () => {
        const sections = helpSections(trace("logs"));
        expect(Arr.map(sections, (section) => [section.title, section.focused])).toEqual([
            ["Trace · logs", true],
            ["Trace · any pane", false],
            ["Trace · tree", false],
            ["Trace · details", false],
            ["Movement", false],
            ["Global", false],
        ]);
        expect(rows(trace("logs"), "Trace · logs")).toEqual(["⏎ go to the log's span", "/ filter"]);
        expect(titles(trace("details"))[0]).toBe("Trace · details");
    });

    it("lists only the bindings that apply now", () => {
        expect(rows(trace("tree"), "Trace · tree")).toContain("n/N problem");
        expect(rows(trace("tree"), "Trace · tree")).not.toContain("n/N match");
        const searching = rows(trace("tree", { search: "boom" }), "Trace · tree");
        expect(searching).toContain("n/N match");
        expect(searching).not.toContain("n/N problem");
        expect(rows(trace("tree"), "Trace · tree"), "o is listed whether or not a span propagated").toContain(
            "o go to the failure origin",
        );
    });
});
