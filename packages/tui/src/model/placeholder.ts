import { Option } from "effect";

import { Presence } from "../nav/Resolve.ts";
import { clockTime, shortId } from "./format.ts";
import { chunk } from "./Role.ts";

import type { Line } from "./Role.ts";

const shown = (id: string) => `${shortId(id)}…`;

const capitalized = (noun: string) => `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;

/** A Body screen whose prefix is not among its span's bodies. */
export const noBodyLines = (prefix: string): ReadonlyArray<Line> => [
    [chunk(`No body ${prefix} on this span`, "text")],
    [chunk("Esc to go back", "muted")],
];

export const placeholderLines = (presence: Presence): Option.Option<ReadonlyArray<Line>> => {
    const goBack: Line = [chunk("Esc to go back", "muted")];
    return Presence.$match(presence, {
        Present: () => Option.none(),
        Loading: (loading) =>
            Option.some([[chunk(`Loading… looking for ${loading.noun} ${shown(loading.id)}`, "text")], goBack]),
        Ambiguous: (ambiguous) =>
            Option.some([[chunk(`${ambiguous.id} matches ${ambiguous.count} ${ambiguous.noun}s`, "text")], goBack]),
        NotInFile: (missing) => {
            const reset = Option.match(missing.resetAt, {
                onNone: () => "",
                onSome: (at) => ` (file reset at ${clockTime(at)})`,
            });
            return Option.some([
                [chunk(`${capitalized(missing.noun)} ${shown(missing.id)} is not in the file${reset}`, "text")],
                goBack,
            ]);
        },
    });
};
