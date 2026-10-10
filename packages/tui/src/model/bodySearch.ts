import { Option } from "effect";

import { foldInPlace } from "../query/Highlight.ts";
import { needle } from "../query/Query.ts";
import { count } from "./format.ts";
import { below, indexIn } from "./stops.ts";

import type { BodyDoc } from "./bodyDoc.ts";

/** Where one plain substring occurs in a doc's text. Every match has the search's length. */
export interface BodyMatches {
    readonly search: string;
    /** Sorted and non-overlapping: a scan resumes at the end of each match. */
    readonly starts: ReadonlyArray<number>;
    readonly length: number;
}

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const folded = new WeakMap<BodyDoc, string>();

const foldedOf = (doc: BodyDoc): string => {
    const cached = folded.get(doc);
    if (cached !== undefined) {
        return cached;
    }
    const text = foldInPlace(doc.text);
    folded.set(doc, text);
    return text;
};

/** Case-insensitive unless `search` holds a capital letter. Spaces are part of the substring. */
export const matchesOf = (doc: BodyDoc, search: string): BodyMatches => {
    const starts: Array<number> = [];
    if (search !== "") {
        const sought = needle(search);
        const [hay, text] = sought._tag === "Exact" ? [doc.text, sought.text] : [foldedOf(doc), sought.lower];
        for (let at = hay.indexOf(text); at >= 0; at = hay.indexOf(text, at + text.length)) {
            starts[starts.length] = at;
        }
    }
    return { search, starts, length: search.length };
};

/** The starts of the matches that overlap `[from, to)`. */
export const matchesIn = (matches: BodyMatches, from: number, to: number): ReadonlyArray<number> =>
    matches.starts.slice(below(matches.starts, from - matches.length + 1), below(matches.starts, to));

/** `current` while a match starts there; any other offset is no current match. */
export const currentOf = (matches: BodyMatches, current: Option.Option<number>): Option.Option<number> =>
    Option.filter(current, (at) => indexIn(matches.starts, at) >= 0);

/** `match 3/41` on a current match, else `41 matches` or `no matches`. */
export const matchText = (matches: BodyMatches, current: Option.Option<number>): string => {
    const total = matches.starts.length;
    if (total === 0) {
        return "no matches";
    }
    return Option.match(currentOf(matches, current), {
        onNone: () => (total === 1 ? "1 match" : `${count(total)} matches`),
        onSome: (at) => `match ${count(indexIn(matches.starts, at) + 1)}/${count(total)}`,
    });
};
