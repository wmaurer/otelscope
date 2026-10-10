import { HashSet, Option } from "effect";

import { openingFor } from "../model/opening.ts";
import { parse } from "../query/Query.ts";
import { push, top, update } from "./Nav.ts";
import { defaultRunsView, defaultTracesView, defaultTraceView, Screen, TraceRow, tracesFor } from "./Screen.ts";

import type { CliArgs } from "../cli/Args.ts";
import type { Snapshot } from "../data/Snapshot.ts";
import type { Nav } from "./Nav.ts";

export type SeedArgs = Pick<CliArgs, "run" | "trace">;

/**
 * The stack the CLI asks for. Seeded ids are prefixes until a snapshot resolves them, and the screens below carry
 * the seeded selection, so they do not follow when the user goes back.
 */
export const initialNav = (args: SeedArgs): Nav => {
    const runs = Screen.Runs({ view: { ...defaultRunsView, selected: args.run } });
    const traces = Option.map(args.run, (runId) =>
        Screen.Traces({
            runId,
            idIsPrefix: true,
            view: { ...defaultTracesView, selected: Option.map(args.trace, (traceId) => TraceRow.Trace({ traceId })) },
        }),
    );
    const trace = Option.map(args.trace, (traceId) =>
        Screen.Trace({ traceId, idIsPrefix: true, viaRun: args.run, view: defaultTraceView }),
    );
    return { stack: [runs, ...Option.toArray(traces), ...Option.toArray(trace)] };
};

export const initialReadDone = (snapshot: Snapshot): boolean =>
    snapshot.status.phase === "following" || snapshot.status.phase === "done";

export const openSingleRun = (nav: Nav, snapshot: Snapshot): Nav => {
    const [runs, ...above] = nav.stack;
    const [only, ...others] = snapshot.runOrder;
    if (above.length > 0 || only === undefined || others.length > 0) {
        return nav;
    }
    return push(nav, tracesFor(only, runs.view));
};

/**
 * 04 "Pushes": a Trace screen pushed before its trace was loaded gets its opening selection the first time the trace is
 * present, seeded search included. It runs once: afterwards the selection is set.
 */
export const openArrivedTrace = (nav: Nav, snapshot: Snapshot): Nav => {
    const screen = top(nav);
    if (screen._tag !== "Trace" || screen.idIsPrefix || Option.isSome(screen.view.selected)) {
        return nav;
    }
    const trace = snapshot.traces.get(screen.traceId);
    if (trace === undefined) {
        return nav;
    }
    const opening = openingFor(trace, parse(screen.view.search));
    return update(nav, "Trace", (view) => ({
        ...view,
        selected: Option.some(opening.selected),
        openGroups: HashSet.union(view.openGroups, opening.openGroups),
    }));
};
