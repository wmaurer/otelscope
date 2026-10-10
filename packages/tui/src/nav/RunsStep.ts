import { Option } from "effect";

import { selectedIndex } from "../model/list.ts";
import { follow, ListOutcome, select, stepList } from "./ListStep.ts";
import { push, update } from "./Nav.ts";
import { tracesFor } from "./Screen.ts";
import { stepTo } from "./ScreenStep.ts";

import type { RunId } from "../data/Snapshot.ts";
import type { ListAction } from "../keys/Action.ts";
import type { RunList } from "../model/runList.ts";
import type { Nav } from "./Nav.ts";
import type { RunSort, RunsView } from "./Screen.ts";
import type { ScreenStep, StepContext } from "./ScreenStep.ts";

const nextRunSort = {
    newest: "service",
    service: "failures",
    failures: "duration",
    duration: "newest",
} satisfies Readonly<Record<RunSort, RunSort>>;

const set = (nav: Nav, f: (view: RunsView) => RunsView): ScreenStep => stepTo(update(nav, "Runs", f));

export const stepRuns = (
    nav: Nav,
    view: RunsView,
    list: RunList,
    context: StepContext,
    action: ListAction,
): ScreenStep => {
    switch (action._tag) {
        case "Move":
        case "Jump":
        case "NextProblem":
        case "Pick":
        case "Open": {
            const atRow = (index: number, f: (runId: RunId) => ScreenStep): ScreenStep => {
                const row = list.rows[index];
                return row === undefined ? stepTo(nav) : f(list.selectionOf(row));
            };
            const selectAt = ({ index }: { readonly index: number }) =>
                atRow(index, (runId) => set(nav, (v) => select(list, v, runId)));
            return ListOutcome.$match(stepList(list, selectedIndex(list, view), action, context.listRows), {
                Select: selectAt,
                Land: selectAt,
                Follow: () => set(nav, follow),
                Activate: ({ index }) => atRow(index, (runId) => stepTo(push(nav, tracesFor(runId, view)))),
                Say: ({ text }) => ({ nav, say: Option.some(text) }),
                Stay: () => stepTo(nav),
            });
        }
        case "ToggleGroup":
            return stepTo(nav);
        case "CycleSort":
            return set(nav, (v) => ({ ...v, sort: nextRunSort[v.sort] }));
        case "Reverse":
            return set(nav, (v) => ({ ...v, reverse: !v.reverse }));
    }
};
