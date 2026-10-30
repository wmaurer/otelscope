import { Array as Arr, HashSet, Match, Option, Predicate } from "effect";

import { selectedIndex } from "../model/list.ts";
import { isProblem } from "../model/marks.ts";
import { openingFor } from "../model/opening.ts";
import { TraceListRow } from "../model/traceList.ts";
import { follow, ListOutcome, select, stepList } from "./ListStep.ts";
import { push, update } from "./Nav.ts";
import { traceFor, TraceRow } from "./Screen.ts";
import { said, stepTo } from "./ScreenStep.ts";

import type { Dir, ListAction } from "../keys/Action.ts";
import type { Group, TraceList } from "../model/traceList.ts";
import type { Movement } from "./ListStep.ts";
import type { Nav } from "./Nav.ts";
import type { ScreenOf, TraceSort, TracesView } from "./Screen.ts";
import type { ScreenStep, StepContext } from "./ScreenStep.ts";

const nextTraceSort = {
    start: "duration",
    duration: "failures",
    failures: "spans",
    spans: "start",
} satisfies Readonly<Record<TraceSort, TraceSort>>;

const toggled = (openGroups: HashSet.HashSet<string>, name: string): HashSet.HashSet<string> =>
    HashSet.has(openGroups, name) ? HashSet.remove(openGroups, name) : HashSet.add(openGroups, name);

export const toggle = (list: TraceList, view: TracesView, row: TraceListRow): TracesView =>
    TraceListRow.$match(row, {
        Heading: ({ group }): TracesView => ({
            ...select(list, view, TraceRow.Heading({ name: group.name })),
            openGroups: toggled(view.openGroups, group.name),
        }),
        More: ({ group }) => {
            const opened = { ...view, openGroups: HashSet.add(view.openGroups, group.name) };
            return Option.match(Arr.head(group.hidden), {
                onNone: () => opened,
                onSome: (item) => select(list, opened, TraceRow.Trace({ traceId: item.trace.id })),
            });
        },
        Trace: ({ item, member }): TracesView =>
            member
                ? {
                      ...select(list, view, TraceRow.Trace({ traceId: item.trace.id })),
                      openGroups: toggled(view.openGroups, item.trace.headName),
                  }
                : view,
    });

const land = (list: TraceList, view: TracesView, group: Group, dir: Dir): TracesView => {
    const problems = Arr.filter(group.hidden, (item) => isProblem(item.state));
    const target = dir === "next" ? Arr.head(problems) : Arr.last(problems);
    const opened = { ...view, openGroups: HashSet.add(view.openGroups, group.name) };
    return Option.match(target, {
        onNone: () => opened,
        onSome: (item) => select(list, opened, TraceRow.Trace({ traceId: item.trace.id })),
    });
};

export const stepTraces = (
    nav: Nav,
    screen: ScreenOf<"Traces">,
    list: TraceList,
    context: StepContext,
    action: ListAction,
): ScreenStep => {
    const { view } = screen;
    const set = (next: TracesView): ScreenStep => stepTo(update(nav, "Traces", () => next));
    const current = selectedIndex(list, view);
    const rowAt = (index: number) => list.rows[index];
    const activate = (row: TraceListRow | undefined): ScreenStep => {
        if (row === undefined) {
            return stepTo(nav);
        }
        if (!Predicate.isTagged(row, "Trace")) {
            return set(toggle(list, view, row));
        }
        const { trace } = row.item;
        const opening = Option.map(Option.fromUndefinedOr(context.snapshot.traces.get(trace.id)), (found) =>
            openingFor(found, view.filter),
        );
        return stepTo(push(nav, traceFor(trace.id, Option.some(screen.runId), view, opening)));
    };
    const moved = (movement: Movement): ScreenStep =>
        ListOutcome.$match(stepList(list, current, movement, context.listRows), {
            Select: ({ index }) => {
                const row = rowAt(index);
                return row === undefined ? stepTo(nav) : set(select(list, view, list.selectionOf(row)));
            },
            Land: ({ index, dir }) => {
                const row = rowAt(index);
                if (row === undefined) {
                    return stepTo(nav);
                }
                return Predicate.isTagged(row, "More")
                    ? set(land(list, view, row.group, dir))
                    : set(select(list, view, list.selectionOf(row)));
            },
            Follow: () => set(follow(view)),
            Activate: ({ index }) => activate(rowAt(index)),
            Say: ({ text }) => said(nav, text),
            Stay: () => stepTo(nav),
        });
    return Match.valueTags(action, {
        ToggleGroup: () => {
            const row = rowAt(current);
            return row === undefined ? stepTo(nav) : set(toggle(list, view, row));
        },
        CycleSort: () => set({ ...view, sort: nextTraceSort[view.sort] }),
        Reverse: () => set({ ...view, reverse: !view.reverse }),
        Pick: (pick) => {
            const row = rowAt(list.indexOf(pick.key));
            return row !== undefined && !Predicate.isTagged(row, "Trace") ? set(toggle(list, view, row)) : moved(pick);
        },
        Move: moved,
        Jump: moved,
        NextProblem: moved,
        Open: moved,
    });
};
