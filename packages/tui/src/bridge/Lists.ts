import { Effect, Equal, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { assemble, layoutOf, listKey, stageOf } from "../model/screenList.ts";
import { top } from "../nav/Nav.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { ScreenList } from "../model/screenList.ts";
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

export const listAtom = (
    snapshot: Atom.Atom<Snapshot>,
    nav: Atom.Atom<Nav>,
    now: Atom.Atom<number>,
    filter: Atom.Atom<string>,
): Atom.Atom<ScreenList> => {
    const key = Atom.make((get) => listKey(top(get(nav)), get(filter), get(snapshot), get(now))).pipe(
        Atom.withEquality(Equal.equals),
    );
    const stage = Atom.make((get) => stageOf(get(key), get(snapshot)));
    const layout = Atom.make((get) => layoutOf(get(stage), top(get(nav)))).pipe(Atom.withEquality(Equal.equals));
    return Atom.make((get) => assemble(get(stage), get(layout)));
};
