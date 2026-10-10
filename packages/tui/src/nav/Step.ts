import { Option } from "effect";

import { isListAction, isTraceAction } from "../keys/Action.ts";
import { top } from "./Nav.ts";
import { stepRuns } from "./RunsStep.ts";
import { stepTo } from "./ScreenStep.ts";
import { stepTraces } from "./TracesStep.ts";
import { stepTrace } from "./TraceStep.ts";

import type { ScreenAction } from "../keys/Action.ts";
import type { Nav } from "./Nav.ts";
import type { ScreenStep, StepContext } from "./ScreenStep.ts";

export const stepScreen = (nav: Nav, context: StepContext, action: ScreenAction): ScreenStep => {
    const screen = top(nav);
    const { list } = context;
    if (screen._tag === "Trace") {
        return isTraceAction(action) && Option.isSome(context.trace)
            ? stepTrace(nav, screen, context.trace.value, action)
            : stepTo(nav);
    }
    if (!isListAction(action)) {
        return stepTo(nav);
    }
    if (screen._tag === "Runs" && list._tag === "Runs") {
        return stepRuns(nav, screen.view, list.list, context, action);
    }
    if (screen._tag === "Traces" && list._tag === "Traces") {
        return stepTraces(nav, screen, list.list, context, action);
    }
    return stepTo(nav);
};
