import { top, update } from "./Nav.ts";
import { Screen } from "./Screen.ts";
import { seekMatch } from "./TraceStep.ts";

import type { Snapshot } from "../data/Snapshot.ts";
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

export const setQuery = (nav: Nav, text: string): Nav => {
    if (activeQuery(nav) === text) {
        return nav;
    }
    return Screen.$match(top(nav), {
        Runs: () => update(nav, "Runs", (view) => ({ ...view, filter: text })),
        Traces: () => update(nav, "Traces", (view) => ({ ...view, filter: text })),
        Trace: () =>
            update(nav, "Trace", (view) =>
                view.pane === "logs" ? { ...view, logFilter: text } : { ...view, search: text },
            ),
        Body: () => update(nav, "Body", (view) => ({ ...view, search: text })),
    });
};

export const clearQuery = (nav: Nav): Nav => setQuery(nav, "");

/** An edit in the `/` input. On the tree search the selection follows to the first match at or after it. */
export const typeQuery = (nav: Nav, text: string, snapshot: Snapshot): Nav => {
    const next = setQuery(nav, text);
    return next === nav ? nav : seekMatch(next, snapshot);
};
