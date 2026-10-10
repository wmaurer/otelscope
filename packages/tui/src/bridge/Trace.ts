import { Array as Arr, Equal, Option } from "effect";
import { Atom } from "effect/reactivity";

import { bodiesOf } from "../model/bodies.ts";
import { chosenOf, logsKeyOf, logsOfKey, shownSpan } from "../model/traceModel.ts";
import { flatten, visibilityOf } from "../model/tree.ts";
import { factsOf } from "../model/treeFacts.ts";
import { searchOf } from "../model/treeSearch.ts";
import { top } from "../nav/Nav.ts";

import type { Snapshot, Trace } from "../data/Snapshot.ts";
import type { BodyStats } from "../model/traceFrame.ts";
import type { TraceModel } from "../model/traceModel.ts";
import type { Nav } from "../nav/Nav.ts";
import type { TraceView } from "../nav/Screen.ts";
import type { AsyncResult } from "effect/reactivity";

/**
 * The top Trace screen's model, in stages that each rebuild only when their own inputs change. The facts follow the
 * trace, the rows follow the visibility, and the logs follow their key. Visibility and key compare structurally, so
 * moving the cursor rebuilds neither.
 */
export const traceModelAtom = (
    snapshot: Atom.Atom<Snapshot>,
    nav: Atom.Atom<Nav>,
    logFilter: Atom.Atom<string>,
): Atom.Atom<Option.Option<TraceModel>> => {
    const trace = Atom.make((get): Trace | undefined => {
        const screen = top(get(nav));
        return screen._tag === "Trace" ? get(snapshot).traces.get(screen.traceId) : undefined;
    });
    const view = Atom.make((get): TraceView | undefined => {
        const screen = top(get(nav));
        return screen._tag === "Trace" ? screen.view : undefined;
    });
    const facts = Atom.make((get) => {
        const found = get(trace);
        return found === undefined ? undefined : factsOf(found);
    });
    const visibility = Atom.make((get) => {
        const shown = get(facts);
        const current = get(view);
        return shown === undefined || current === undefined ? undefined : visibilityOf(shown, current);
    }).pipe(Atom.withEquality(Equal.equals));
    const tree = Atom.make((get) => {
        const shown = get(facts);
        const visible = get(visibility);
        return shown === undefined || visible === undefined ? undefined : flatten(shown, visible);
    });
    const searchText = Atom.make((get) => get(view)?.search ?? "");
    const search = Atom.make((get) => {
        const shown = get(facts);
        return shown === undefined ? undefined : searchOf(shown, get(searchText));
    });
    const chosen = Atom.make((get) => {
        const shown = get(facts);
        const rows = get(tree);
        const current = get(view);
        return shown === undefined || rows === undefined || current === undefined
            ? undefined
            : chosenOf(shown, rows, current);
    });
    const logsKey = Atom.make((get) => {
        const current = get(view);
        const picked = get(chosen);
        return current === undefined || picked === undefined
            ? undefined
            : logsKeyOf(current, picked.entry, get(logFilter));
    }).pipe(Atom.withEquality(Equal.equals));
    const logs = Atom.make((get) => {
        const shown = get(facts);
        const rows = get(tree);
        const key = get(logsKey);
        return shown === undefined || rows === undefined || key === undefined ? undefined : logsOfKey(shown, rows, key);
    });
    return Atom.make((get) => {
        const shown = get(facts);
        const rows = get(tree);
        const matched = get(search);
        const picked = get(chosen);
        const listed = get(logs);
        return shown === undefined ||
            rows === undefined ||
            matched === undefined ||
            picked === undefined ||
            listed === undefined
            ? Option.none()
            : Option.some({ facts: shown, tree: rows, search: matched, ...picked, logs: listed });
    });
};

const sameStats = (a: BodyStats, b: BodyStats): boolean =>
    a.size === b.size && Arr.every(Array.from(a), ([sha256, result]) => b.get(sha256) === result);

/** `Bodies.stat` for each body of the span the selection shows, by sha256; empty on any other row. */
export const bodyStatsAtom = (
    model: Atom.Atom<Option.Option<TraceModel>>,
    bodyStat: (sha256: string) => Atom.Atom<AsyncResult.AsyncResult<Option.Option<number>>>,
): Atom.Atom<BodyStats> =>
    Atom.make((get): BodyStats => {
        const span = Option.flatMap(get(model), shownSpan);
        const bodies = Option.match(span, { onNone: () => [], onSome: bodiesOf });
        return new Map(Arr.map(bodies, (body) => [body.sha256, get(bodyStat(body.sha256))] as const));
    }).pipe(Atom.withEquality(sameStats));
