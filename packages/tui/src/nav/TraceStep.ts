import { Array as Arr, Option } from "effect";

import { locationTarget } from "../editor.ts";
import { moveRows } from "../keys/Action.ts";
import { bodiesOf } from "../model/bodies.ts";
import { originOf } from "../model/cause.ts";
import { cursorEntry } from "../model/logs.ts";
import { firstAtOrAfter, nextStop } from "../model/stops.ts";
import { resizeName, resizeSplit } from "../model/traceLayout.ts";
import { anchorOf, rowOf } from "../model/tree.ts";
import { factsOf } from "../model/treeFacts.ts";
import { searchOf } from "../model/treeSearch.ts";
import { push, top, update } from "./Nav.ts";
import { bodyFor } from "./Screen.ts";
import { said, ShellEffect, stepTo } from "./ScreenStep.ts";
import {
    collapseAll,
    cyclePane,
    expandAll,
    foldOrParent,
    nextScope,
    reveal,
    scrollDetails,
    selectRow,
    toggleAt,
    unfold,
} from "./TraceView.ts";

import type { SpanId, Snapshot } from "../data/Snapshot.ts";
import type { Dir, TraceAction } from "../keys/Action.ts";
import type { Panes } from "../model/panes.ts";
import type { TreeEntry } from "../model/tree.ts";
import type { Nav } from "./Nav.ts";
import type { Pane, ScreenOf, TraceView } from "./Screen.ts";
import type { ScreenStep, TraceContext } from "./ScreenStep.ts";

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

const signed = (dir: Dir, n: number): number => (dir === "next" ? n : -n);

export const stepTrace = (
    nav: Nav,
    screen: ScreenOf<"Trace">,
    context: TraceContext,
    action: TraceAction,
): ScreenStep => {
    const { model, layout, panes } = context;
    const { facts, tree, logs } = model;
    const { view } = screen;
    const set = (next: TraceView): ScreenStep => stepTo(update(nav, "Trace", () => next));
    const setPanes = (next: Panes): ScreenStep => ({ nav, effects: [ShellEffect.SetPanes({ panes: next })] });
    const withEntry = (f: (entry: TreeEntry) => TraceView): ScreenStep =>
        Option.match(model.entry, { onNone: () => stepTo(nav), onSome: (entry) => set(f(entry)) });
    const selectedSpan = Option.flatMap(model.entry, (entry) =>
        entry._tag === "Span" ? Option.fromUndefinedOr(facts.trace.spans.get(entry.spanId)) : Option.none(),
    );
    const anchor = () => anchorOf(facts, Option.map(model.entry, rowOf));
    const detailsMax = Math.max(0, context.detailsLines - layout.detailsRows);
    const moveTree = (target: number): ScreenStep => {
        const entry = tree.rows[clamp(target, 0, tree.rows.length - 1)];
        return entry === undefined ? stepTo(nav) : set(selectRow(view, rowOf(entry)));
    };
    const moveLogs = (target: (current: number, last: number) => number): ScreenStep => {
        const last = logs.entries.length - 1;
        const entry = logs.entries[clamp(target(cursorEntry(logs, facts, view.logCursor), last), 0, last)];
        return entry === undefined ? stepTo(nav) : set({ ...view, logCursor: Option.some(entry.key) });
    };
    const goToLog = (from: TraceView, index: number): ScreenStep => {
        const entry = logs.entries[index];
        return entry === undefined
            ? stepTo(nav)
            : set({ ...reveal(from, facts, entry.spanId, false), logCursor: Option.some(entry.key) });
    };
    const openBody = (from: TraceView, spanId: SpanId, prefix: string): ScreenStep =>
        stepTo(
            push(
                update(nav, "Trace", () => from),
                bodyFor(facts.trace.id, spanId, prefix),
            ),
        );
    const focused = (pane: Pane): TraceView => (view.pane === pane ? view : { ...view, pane });

    switch (action._tag) {
        case "FocusPane":
            return set(focused(action.pane));
        case "CyclePane":
            return set({ ...view, pane: cyclePane(view.pane, action.dir) });
        case "ResizeSplit":
            return setPanes(resizeSplit(panes, action.delta));
        case "SetSplit":
            return setPanes(resizeSplit({ ...panes, split: action.percent }, 0));
        case "ResizeNameColumn":
            return setPanes(resizeName(panes, layout, action.delta));
        case "CycleLogScope":
            return set({ ...view, logScope: nextScope(view.logScope) });
        case "OpenBody":
            return Option.match(
                Option.flatMap(selectedSpan, (span) =>
                    Option.map(Arr.head(bodiesOf(span)), (body) => [span.span, body.prefix] as const),
                ),
                {
                    onNone: () => said(nav, "no bodies on this span"),
                    onSome: ([spanId, prefix]) => openBody(view, spanId, prefix),
                },
            );
        case "OpenEditor":
            return Option.match(Option.flatMap(selectedSpan, locationTarget), {
                onNone: () => said(nav, "no source location for this span"),
                onSome: (target) => ({ nav, effects: [ShellEffect.Edit({ target })] }),
            });
        case "Move":
        case "Jump": {
            const toStart = action._tag === "Jump" && action.to === "start";
            const step = (viewport: number) =>
                action._tag === "Move" ? signed(action.dir, moveRows(action.by, viewport)) : 0;
            switch (view.pane) {
                case "tree":
                    return moveTree(
                        action._tag === "Move" ? model.index + step(layout.treeRows) : toStart ? 0 : tree.rows.length,
                    );
                case "details":
                    return set(
                        action._tag === "Move"
                            ? scrollDetails(view, step(layout.detailsRows), detailsMax)
                            : scrollDetails(view, toStart ? -view.detailsTop : detailsMax, detailsMax),
                    );
                case "logs":
                    return moveLogs((current, last) =>
                        action._tag === "Move" ? current + step(layout.logsRows) : toStart ? 0 : last,
                    );
            }
        }
        case "ScrollDetails":
            return set(scrollDetails(view, action.rows, detailsMax));
        case "ToggleFold":
            return withEntry((entry) => toggleAt(view, entry));
        case "FoldOrParent":
            return withEntry((entry) => foldOrParent(view, facts, entry));
        case "Unfold":
            return withEntry((entry) => unfold(view, entry));
        case "ExpandAll":
            return set(expandAll(view, facts));
        case "CollapseAll":
            return set(collapseAll(view, facts));
        case "NextProblem": {
            const { problems, ids } = facts.order();
            return Option.match(nextStop(problems, anchor(), action.dir), {
                onNone: () => said(nav, "no problems"),
                onSome: (stop) => set(reveal(view, facts, ids[stop] ?? "", false)),
            });
        }
        case "NextMatch":
            return Option.match(nextStop(model.search.positions, anchor(), action.dir), {
                onNone: () => said(nav, "no matches"),
                onSome: (stop) => set(reveal(view, facts, facts.order().ids[stop] ?? "", true)),
            });
        case "GoToOrigin":
            return Option.match(
                Option.flatMap(selectedSpan, (span) => originOf(facts, span.span)),
                {
                    onNone: () => said(nav, "no cause origin"),
                    onSome: (origin) => set(reveal(view, facts, origin, false)),
                },
            );
        case "GoToLogSpan":
            return goToLog(view, cursorEntry(logs, facts, view.logCursor));
        case "Click": {
            const { target } = action;
            const from = focused(action.pane);
            switch (target._tag) {
                case "Pane":
                    return set(from);
                case "Body":
                    return Option.match(selectedSpan, {
                        onNone: () => set(from),
                        onSome: (span) => openBody(from, span.span, target.prefix),
                    });
                case "Row":
                case "Mark": {
                    if (action.pane === "logs") {
                        const index = Arr.findFirstIndex(logs.entries, (entry) => entry.key === target.key);
                        return Option.match(index, {
                            onNone: () => set(from),
                            onSome: (at) =>
                                at === cursorEntry(logs, facts, view.logCursor)
                                    ? goToLog(from, at)
                                    : set({ ...from, logCursor: Option.some(logs.entries[at]?.key ?? target.key) }),
                        });
                    }
                    const at = tree.indexOf(target.key);
                    const entry = tree.rows[at];
                    if (entry === undefined) {
                        return set(from);
                    }
                    const toggles = target._tag === "Mark" || at === model.index;
                    const selected = selectRow(from, rowOf(entry));
                    return set(toggles ? toggleAt(selected, entry) : selected);
                }
            }
        }
    }
};

/**
 * Typing in the tree search: the first match at or after the current selection, revealed with its groups opened. The
 * current span stays when it matches; nothing moves when no match lies at or after it.
 */
export const seekMatch = (nav: Nav, snapshot: Snapshot): Nav => {
    const screen = top(nav);
    if (screen._tag !== "Trace" || screen.view.pane === "logs") {
        return nav;
    }
    const trace = snapshot.traces.get(screen.traceId);
    if (trace === undefined) {
        return nav;
    }
    const facts = factsOf(trace);
    const search = searchOf(facts, screen.view.search);
    return Option.match(firstAtOrAfter(search.positions, anchorOf(facts, screen.view.selected)), {
        onNone: () => nav,
        onSome: (stop) => update(nav, "Trace", (view) => reveal(view, facts, facts.order().ids[stop] ?? "", true)),
    });
};
