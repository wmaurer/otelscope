import { top, update } from "./Nav.ts";
import { Screen } from "./Screen.ts";

import type { Nav } from "./Nav.ts";

/**
 * The query the focused pane owns: a list's filter, the tree search (from the tree or details pane), the log filter,
 * or the Body search. Empty when none is active.
 */
export const activeQuery = (nav: Nav): string =>
    Screen.$match(top(nav), {
        Runs: ({ view }) => view.filter,
        Traces: ({ view }) => view.filter,
        Trace: ({ view }) => (view.pane === "logs" ? view.logFilter : view.search),
        Body: ({ view }) => view.search,
    });

export const clearQuery = (nav: Nav): Nav => {
    if (activeQuery(nav) === "") {
        return nav;
    }
    return Screen.$match(top(nav), {
        Runs: () => update(nav, "Runs", (view) => ({ ...view, filter: "" })),
        Traces: () => update(nav, "Traces", (view) => ({ ...view, filter: "" })),
        Trace: () =>
            update(nav, "Trace", (view) =>
                view.pane === "logs" ? { ...view, logFilter: "" } : { ...view, search: "" },
            ),
        Body: () => update(nav, "Body", (view) => ({ ...view, search: "" })),
    });
};
