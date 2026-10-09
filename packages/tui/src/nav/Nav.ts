import { Array as Arr } from "effect";

import { defaultRunsView, Screen } from "./Screen.ts";

import type { RunsScreen, ScreenTag, ViewOf } from "./Screen.ts";

/**
 * The screen stack. Every operation returns `nav` itself when it changes nothing, so writing the result to an atom
 * is free.
 */
export interface Nav {
    readonly stack: readonly [RunsScreen, ...ReadonlyArray<Screen>];
}

export const initial: Nav = { stack: [Screen.Runs({ view: defaultRunsView })] };

export const top = (nav: Nav): Screen => Arr.lastNonEmpty(nav.stack);

export const depth = (nav: Nav): number => nav.stack.length;

export const push = (nav: Nav, screen: Screen): Nav => ({ stack: [...nav.stack, screen] });

/** Swaps the top screen. On `[Runs]` only another Runs screen may take its place. */
export const replace = (nav: Nav, screen: Screen): Nav => {
    const [head, ...rest] = nav.stack;
    if (rest.length > 0) {
        return { stack: [head, ...Arr.dropRight(rest, 1), screen] };
    }
    return screen._tag === "Runs" ? { stack: [screen] } : nav;
};

export const back = (nav: Nav): Nav => {
    const [head, ...rest] = nav.stack;
    return rest.length > 0 ? { stack: [head, ...Arr.dropRight(rest, 1)] } : nav;
};

const updateAt = <T extends ScreenTag>(nav: Nav, index: number, tag: T, f: (view: ViewOf<T>) => ViewOf<T>): Nav => {
    const screen = nav.stack[index];
    if (index < 0 || screen === undefined || screen._tag !== tag) {
        return nav;
    }
    // SAFETY: the `_tag` check above narrows the union to the variant tagged `T`, whose view is `ViewOf<T>`.
    const current = screen.view as ViewOf<T>;
    const view = f(current);
    if (view === current) {
        return nav;
    }
    const [head, ...rest] = nav.stack;
    // SAFETY: the same variant with its view replaced by one of the same type.
    const next = { ...screen, view } as Screen;
    if (index === 0) {
        return next._tag === "Runs" ? { stack: [next, ...rest] } : nav;
    }
    return { stack: [head, ...Arr.map(rest, (s, i) => (i === index - 1 ? next : s))] };
};

/**
 * Applies `f` to the top screen's view when the top is a `tag` screen. A handler that raced a push and expects
 * another screen changes nothing.
 */
export const update = <T extends ScreenTag>(nav: Nav, tag: T, f: (view: ViewOf<T>) => ViewOf<T>): Nav =>
    updateAt(nav, nav.stack.length - 1, tag, f);

/** The same for the screen under the top. */
export const updateBelow = <T extends ScreenTag>(nav: Nav, tag: T, f: (view: ViewOf<T>) => ViewOf<T>): Nav =>
    updateAt(nav, nav.stack.length - 2, tag, f);
