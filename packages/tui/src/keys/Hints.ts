import { Array as Arr, Option, Order } from "effect";

import { factsOf } from "../model/treeFacts.ts";
import { top } from "../nav/Nav.ts";
import { BINDINGS, focusOf } from "./Bindings.ts";
import { lookup, scopesFor } from "./Dispatch.ts";
import { keyLabel } from "./Key.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Nav } from "../nav/Nav.ts";
import type { Binding, HintScope, Mode } from "./Bindings.ts";

export interface HintFacts {
    readonly propagated: boolean;
}

/** `propagated`: the Trace screen's stored selection is a span the failure only passed through. */
export const hintFacts = (nav: Nav, snapshot: Snapshot): HintFacts => {
    const screen = top(nav);
    if (screen._tag !== "Trace") {
        return { propagated: false };
    }
    const trace = snapshot.traces.get(screen.traceId);
    return {
        propagated: Option.exists(
            screen.view.selected,
            (row) => row._tag === "Span" && trace !== undefined && factsOf(trace).kind(row.spanId) === "propagated",
        ),
    };
};

export interface HintItem {
    readonly key: string;
    readonly label: string;
    readonly sticky: boolean;
}

const hintScopeOf = (mode: Mode, nav: Nav): Option.Option<HintScope> => {
    switch (mode) {
        case "screen":
            return Option.some(focusOf(nav));
        case "help":
        case "badLines":
            return Option.some("overlay");
        case "input":
            return Option.none();
    }
};

/**
 * The bindings the hint line shows, in rank order. A binding shows its hint only when pressing its key now would run
 * it, so a shadowed or guarded-off binding never advertises itself.
 */
export const hintBindings = (mode: Mode, nav: Nav, facts: HintFacts): ReadonlyArray<Binding> =>
    Option.match(hintScopeOf(mode, nav), {
        onNone: () => [],
        onSome: (scope) => {
            const scopes = scopesFor(mode, nav);
            const rankOf = (binding: Binding) => binding.hint?.rank[scope];
            const shown = Arr.filter(
                BINDINGS,
                (binding) =>
                    rankOf(binding) !== undefined &&
                    (binding.hint?.when === undefined || facts[binding.hint.when]) &&
                    Option.exists(lookup(nav, scopes, binding.keys[0]), (found) => found === binding),
            );
            return Arr.sort(
                shown,
                Order.mapInput(Order.Number, (binding: Binding) => rankOf(binding) ?? 0),
            );
        },
    });

export const hintLine = (mode: Mode, nav: Nav, facts: HintFacts): ReadonlyArray<HintItem> =>
    Arr.map(hintBindings(mode, nav, facts), (binding) => ({
        key: keyLabel(binding.keys[0]),
        label: binding.hint?.label ?? binding.label,
        sticky: binding.hint?.sticky === true,
    }));

export const formatHint = (hint: HintItem): string => `${hint.key} ${hint.label}`;
