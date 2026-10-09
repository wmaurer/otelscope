import { Array as Arr } from "effect";

import { top } from "../nav/Nav.ts";
import { BINDINGS, holds } from "./Bindings.ts";
import { keyLabel } from "./Key.ts";

import type { Nav } from "../nav/Nav.ts";
import type { Pane } from "../nav/Screen.ts";
import type { Binding, Scope } from "./Bindings.ts";

export interface HelpRow {
    readonly keys: string;
    readonly label: string;
}

export interface HelpSection {
    readonly title: string;
    readonly focused: boolean;
    readonly rows: ReadonlyArray<HelpRow>;
}

const rowsOf = (nav: Nav, scopes: ReadonlyArray<Scope>): ReadonlyArray<HelpRow> =>
    Arr.reduce(
        Arr.filter(
            BINDINGS,
            (binding: Binding) =>
                Arr.contains(scopes, binding.scope) && (binding.when === undefined || holds(binding.when, nav)),
        ),
        Arr.empty<HelpRow>(),
        (rows, binding) => {
            const keys = Arr.join(Arr.map(binding.keys, keyLabel), "/");
            const last = Arr.last(rows);
            return last._tag === "Some" && last.value.label === binding.label
                ? [...Arr.dropRight(rows, 1), { keys: `${last.value.keys}/${keys}`, label: binding.label }]
                : [...rows, { keys, label: binding.label }];
        },
    );

const section = (nav: Nav, title: string, scopes: ReadonlyArray<Scope>, focused = false): HelpSection => ({
    title,
    focused,
    rows: rowsOf(nav, scopes),
});

const panes: ReadonlyArray<Pane> = ["tree", "details", "logs"];

export const helpSections = (nav: Nav): ReadonlyArray<HelpSection> => {
    const screen = top(nav);
    const screenSections =
        screen._tag === "Trace"
            ? [
                  section(nav, `Trace · ${screen.view.pane}`, [`Trace.${screen.view.pane}`], true),
                  section(nav, "Trace · any pane", ["Trace"]),
                  ...Arr.map(
                      Arr.filter(panes, (pane) => pane !== screen.view.pane),
                      (pane) => section(nav, `Trace · ${pane}`, [`Trace.${pane}`]),
                  ),
              ]
            : [section(nav, screen._tag, [screen._tag])];
    return [...screenSections, section(nav, "Movement", ["movement"]), section(nav, "Global", ["global", "always"])];
};
