import { isListAction } from "../keys/Action.ts";
import { top } from "./Nav.ts";
import { stepRuns } from "./RunsStep.ts";
import { stepTo } from "./ScreenStep.ts";
import { stepTraces } from "./TracesStep.ts";

import type { ScreenAction } from "../keys/Action.ts";
import type { Nav } from "./Nav.ts";
import type { ScreenStep, StepContext } from "./ScreenStep.ts";

export const stepScreen = (nav: Nav, context: StepContext, action: ScreenAction): ScreenStep => {
    const screen = top(nav);
    const { list } = context;
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
