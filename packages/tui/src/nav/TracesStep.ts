import { Array as Arr, HashSet, Option } from "effect";

import { selectedIndex } from "../model/list.ts";
import { isProblem } from "../model/marks.ts";
import { openingFor } from "../model/opening.ts";
import { parse } from "../query/Query.ts";
import { follow, ListOutcome, select, stepList } from "./ListStep.ts";
import { push, update } from "./Nav.ts";
import { traceFor, TraceRow } from "./Screen.ts";
import { stepTo } from "./ScreenStep.ts";

import type { Dir, ListAction } from "../keys/Action.ts";
import type { Group, TraceList, TraceListRow } from "../model/traceList.ts";
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

export const toggle = (list: TraceList, view: TracesView, row: TraceListRow): TracesView => {
    switch (row._tag) {
        case "Heading":
            return {
                ...select(list, view, TraceRow.Heading({ name: row.group.name })),
                openGroups: toggled(view.openGroups, row.group.name),
            };
        case "More": {
            const opened = { ...view, openGroups: HashSet.add(view.openGroups, row.group.name) };
            return Option.match(Arr.head(row.group.hidden), {
                onNone: () => opened,
                onSome: (item) => select(list, opened, TraceRow.Trace({ traceId: item.trace.id })),
            });
        }
        case "Trace": {
            const name = row.item.trace.headName;
            return row.member
                ? {
                      ...select(list, view, TraceRow.Trace({ traceId: row.item.trace.id })),
                      openGroups: toggled(view.openGroups, name),
                  }
                : view;
        }
    }
};

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
        if (row._tag !== "Trace") {
            return set(toggle(list, view, row));
        }
        const { trace } = row.item;
        const opening = Option.map(Option.fromUndefinedOr(context.snapshot.traces.get(trace.id)), (found) =>
            openingFor(found, parse(view.filter)),
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
                return row._tag === "More"
                    ? set(land(list, view, row.group, dir))
                    : set(select(list, view, list.selectionOf(row)));
            },
            Follow: () => set(follow(view)),
            Activate: ({ index }) => activate(rowAt(index)),
            Say: ({ text }) => ({ nav, say: Option.some(text) }),
            Stay: () => stepTo(nav),
        });
    switch (action._tag) {
        case "ToggleGroup": {
            const row = rowAt(current);
            return row === undefined ? stepTo(nav) : set(toggle(list, view, row));
        }
        case "CycleSort":
            return set({ ...view, sort: nextTraceSort[view.sort] });
        case "Reverse":
            return set({ ...view, reverse: !view.reverse });
        case "Pick": {
            const row = rowAt(list.indexOf(action.key));
            return row !== undefined && row._tag !== "Trace" ? set(toggle(list, view, row)) : moved(action);
        }
        case "Move":
        case "Jump":
        case "NextProblem":
        case "Open":
            return moved(action);
    }
};
