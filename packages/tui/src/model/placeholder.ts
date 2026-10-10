import { Option } from "effect";

import { clockTime, shortId } from "./format.ts";
import { chunk } from "./Role.ts";

import type { Presence } from "../nav/Resolve.ts";
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
    switch (presence._tag) {
        case "Present":
            return Option.none();
        case "Loading":
            return Option.some([
                [chunk(`Loading… looking for ${presence.noun} ${shown(presence.id)}`, "text")],
                goBack,
            ]);
        case "Ambiguous":
            return Option.some([[chunk(`${presence.id} matches ${presence.count} ${presence.noun}s`, "text")], goBack]);
        case "NotInFile": {
            const reset = Option.match(presence.resetAt, {
                onNone: () => "",
                onSome: (at) => ` (file reset at ${clockTime(at)})`,
            });
            return Option.some([
                [chunk(`${capitalized(presence.noun)} ${shown(presence.id)} is not in the file${reset}`, "text")],
                goBack,
            ]);
        }
    }
};
