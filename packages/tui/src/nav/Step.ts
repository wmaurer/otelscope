import { Option, Predicate } from "effect";

import { isBodyAction, isListAction, isTraceAction } from "../keys/Action.ts";
import { stepBody } from "./BodyStep.ts";
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
    if (Predicate.isTagged(screen, "Trace")) {
        return isTraceAction(action) && Option.isSome(context.trace)
            ? stepTrace(nav, screen, context.trace.value, action)
            : stepTo(nav);
    }
    if (Predicate.isTagged(screen, "Body")) {
        return isBodyAction(action) && Option.isSome(context.body)
            ? stepBody(nav, screen, context.body.value, action)
            : stepTo(nav);
    }
    if (!isListAction(action)) {
        return stepTo(nav);
    }
    if (Predicate.isTagged(screen, "Runs") && Predicate.isTagged(list, "Runs")) {
        return stepRuns(nav, screen.view, list.list, context, action);
    }
    if (Predicate.isTagged(screen, "Traces") && Predicate.isTagged(list, "Traces")) {
        return stepTraces(nav, screen, list.list, context, action);
    }
    return stepTo(nav);
};
