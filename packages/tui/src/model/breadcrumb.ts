import { Array as Arr, Option } from "effect";

import { runLabel, shortId } from "./format.ts";
import { chunk } from "./Role.ts";
import { cells, cut } from "./text.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Nav } from "../nav/Nav.ts";
import type { Screen } from "../nav/Screen.ts";
import type { Line } from "./Role.ts";

const placeholderId = (id: string) => `${shortId(id)}…`;

const segment = (screen: Screen, snapshot: Snapshot, now: number): string => {
    switch (screen._tag) {
        case "Runs":
            return "Runs";
        case "Traces": {
            const run = snapshot.runs.get(screen.runId);
            return run === undefined ? placeholderId(screen.runId) : runLabel(run, now);
        }
        case "Trace": {
            const trace = snapshot.traces.get(screen.traceId);
            return trace === undefined ? placeholderId(screen.traceId) : `${trace.headName} ${shortId(trace.id)}`;
        }
        case "Body":
            return screen.prefix;
    }
};

export const segments = (nav: Nav, snapshot: Snapshot, now: number): Arr.NonEmptyReadonlyArray<string> =>
    Arr.map(nav.stack, (screen) => segment(screen, snapshot, now));

const SEPARATOR = " › ";
const CUT = "…";

const render = (before: ReadonlyArray<string>, current: string, cutLeft: boolean): Line => [
    ...(cutLeft ? [chunk(CUT, "muted"), chunk(SEPARATOR, "faint")] : []),
    ...Arr.flatMap(before, (text) => [chunk(text, "muted"), chunk(SEPARATOR, "faint")]),
    chunk(current, "accent"),
];

export const breadcrumb = (all: Arr.NonEmptyReadonlyArray<string>, width: number): Line => {
    const current = Arr.lastNonEmpty(all);
    const earlier = Arr.dropRight(all, 1);
    const fits = (dropped: number) =>
        Arr.reduce(Arr.drop(earlier, dropped), cells(current), (sum, text) => sum + cells(text) + cells(SEPARATOR)) +
            (dropped > 0 ? cells(CUT) + cells(SEPARATOR) : 0) <=
        width;
    return Option.match(Arr.findFirst(Arr.range(0, earlier.length), fits), {
        onNone: () => [chunk(cut(current, width), "accent")],
        onSome: (dropped) => render(Arr.drop(earlier, dropped), current, dropped > 0),
    });
};
