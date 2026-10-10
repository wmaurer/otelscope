import { Array as Arr, Option, Order } from "effect";

import { originOf } from "../model/cause.ts";
import { shownSpan } from "../model/traceModel.ts";
import { BINDINGS, focusOf } from "./Bindings.ts";
import { lookup, scopesFor } from "./Dispatch.ts";
import { keyLabel } from "./Key.ts";

import type { TraceModel } from "../model/traceModel.ts";
import type { Nav } from "../nav/Nav.ts";
import type { Binding, HintScope, Mode } from "./Bindings.ts";

export interface HintFacts {
    readonly toOrigin: boolean;
}

/**
 * `toOrigin`: `o` would move the selection, because the row it shows as (the one `o` acts on) is a span whose cause
 * origin is another span.
 */
export const hintFacts = (trace: Option.Option<TraceModel>): HintFacts => ({
    toOrigin: Option.exists(trace, (model) =>
        Option.exists(shownSpan(model), (span) =>
            Option.exists(originOf(model.facts, span.span), (origin) => origin !== span.span),
        ),
    ),
});

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
