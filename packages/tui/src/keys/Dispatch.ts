import { Array as Arr, Option } from "effect";

import { depth } from "../nav/Nav.ts";
import { activeQuery } from "../nav/Query.ts";
import { Action } from "./Action.ts";
import { BINDINGS, focusOf, holds } from "./Bindings.ts";
import { normalize } from "./Key.ts";

import type { Nav } from "../nav/Nav.ts";
import type { Binding, Mode, Scope } from "./Bindings.ts";
import type { KeyPress } from "./Key.ts";

export const scopesFor = (mode: Mode, nav: Nav): ReadonlyArray<Scope> => {
    switch (mode) {
        case "input":
            return ["input", "always"];
        case "help":
        case "badLines":
            return ["overlay", "movement", "always"];
        case "screen": {
            const focus = focusOf(nav);
            return focus.startsWith("Trace.")
                ? [focus, "Trace", "movement", "global", "always"]
                : [focus, "movement", "global", "always"];
        }
    }
};

const has = (binding: Binding, key: string): boolean => Arr.some(binding.keys, (k) => k === key);

export const lookup = (nav: Nav, scopes: ReadonlyArray<Scope>, key: string): Option.Option<Binding> =>
    Arr.findFirst(scopes, (scope) =>
        Arr.findFirst(
            BINDINGS,
            (binding) =>
                binding.scope === scope &&
                has(binding, key) &&
                (binding.when === undefined || holds(binding.when, nav)),
        ),
    );

const opens = (mode: "help" | "badLines", key: string): boolean =>
    Arr.some(
        BINDINGS,
        (binding) =>
            binding.scope === "global" &&
            binding.action._tag === (mode === "help" ? "OpenHelp" : "OpenBadLines") &&
            has(binding, key),
    );

export const dispatch = (mode: Mode, nav: Nav, press: KeyPress): Option.Option<Action> => {
    const key = normalize(press);
    if ((mode === "help" || mode === "badLines") && opens(mode, key)) {
        return Option.some(Action.CloseOverlay());
    }
    return Option.flatMap(lookup(nav, scopesFor(mode, nav), key), ({ action }) => {
        if (action._tag !== "Peel") {
            return Option.some(action);
        }
        if (activeQuery(nav) !== "") {
            return Option.some(Action.ClearQuery());
        }
        return depth(nav) > 1 ? Option.some(Action.Back()) : Option.none();
    });
};
