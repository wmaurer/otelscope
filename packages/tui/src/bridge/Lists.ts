import { Effect, Equal, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { assemble, layoutOf, listKey, stageOf } from "../model/screenList.ts";
import { top } from "../nav/Nav.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { ListKey, ScreenList, Stage } from "../model/screenList.ts";
import type { Nav } from "../nav/Nav.ts";

export const SEARCH_DEBOUNCE_MILLIS = 150;

interface Typed {
    readonly screen: string;
    readonly filter: string;
}

const typedOf = (nav: Nav): Typed => {
    const screen = top(nav);
    const depth = nav.stack.length;
    switch (screen._tag) {
        case "Runs":
            return { screen: `${depth}`, filter: screen.view.filter };
        case "Traces":
            return { screen: `${depth}:${screen.runId}`, filter: screen.view.filter };
        case "Trace":
            return { screen: `${depth}:${screen.traceId}`, filter: screen.view.logFilter };
        case "Body":
            return { screen: `${depth}`, filter: "" };
    }
};

/**
 * The filter a list (or the Trace screen's logs) is built with. Typing on one screen settles once it pauses; a push, a
 * Back or an emptied filter applies at once, so a screen never shows a filter typed on an earlier visit.
 */
export const settledFilter = (nav: Atom.Atom<Nav>): Atom.Atom<string> => {
    const typed = Atom.map(nav, typedOf).pipe(Atom.withEquality(Equal.equals));
    const settled = Atom.make((get) => {
        const next = get(typed);
        const shown = Option.flatMap(get.self<AsyncResult.AsyncResult<Typed>>(), AsyncResult.value);
        return Option.exists(shown, (last) => last.screen === next.screen) && next.filter !== ""
            ? Effect.as(Effect.sleep(SEARCH_DEBOUNCE_MILLIS), next)
            : Effect.succeed(next);
    });
    return Atom.map(settled, (result) =>
        Option.match(AsyncResult.value(result), { onNone: () => "", onSome: (done) => done.filter }),
    );
};

interface Staged {
    readonly key: ListKey;
    readonly snapshot: Snapshot;
    readonly stage: Stage;
}

/** Whether a stage built from `before` holds for `after`: the parts of a snapshot that `stageOf` reads are the same. */
const sameLists = (before: Snapshot, after: Snapshot): boolean =>
    before.runs === after.runs &&
    before.runOrder === after.runOrder &&
    before.traces === after.traces &&
    before.status.phase === after.status.phase;

export const listAtom = (
    snapshot: Atom.Atom<Snapshot>,
    nav: Atom.Atom<Nav>,
    now: Atom.Atom<number>,
    filter: Atom.Atom<string>,
): Atom.Atom<ScreenList> => {
    const key = Atom.make((get) => listKey(top(get(nav)), get(filter), get(snapshot), get(now))).pipe(
        Atom.withEquality(Equal.equals),
    );
    // A publish that changed no trace, such as the one at each `CaughtUp` while following, keeps the stage, so a list
    // over every trace of a run is not built again for the status bar's sake.
    const staged = Atom.make((get): Staged => {
        const next = get(key);
        const latest = get(snapshot);
        const shown = get.self<Staged>();
        return Option.isSome(shown) && Equal.equals(shown.value.key, next) && sameLists(shown.value.snapshot, latest)
            ? shown.value
            : {
                  key: next,
                  snapshot: latest,
                  stage: stageOf(
                      next,
                      latest,
                      Option.map(shown, (staged) => staged.stage),
                  ),
              };
    });
    const stage = Atom.map(staged, (current) => current.stage);
    const layout = Atom.make((get) => layoutOf(get(stage), top(get(nav)))).pipe(Atom.withEquality(Equal.equals));
    return Atom.make((get) => assemble(get(stage), get(layout)));
};
