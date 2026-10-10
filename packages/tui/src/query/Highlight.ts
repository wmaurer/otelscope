import { Array as Arr, Order } from "effect";

import type { Query } from "./Query.ts";

export type Ranges = ReadonlyArray<readonly [start: number, end: number]>;

export const none: Ranges = [];

const NON_ASCII = /[\u0080-\uffff]/;

/** Lowercases one character at a time, keeping any whose lowercase has another length, so indices stay `text`'s. */
export const foldInPlace = (text: string): string => {
    if (!NON_ASCII.test(text)) {
        return text.toLowerCase();
    }
    let out = "";
    for (const char of text) {
        const lower = char.toLowerCase();
        out += lower.length === char.length ? lower : char;
    }
    return out;
};

export const ranges = (query: Query, text: string): Ranges => {
    const found: Array<readonly [number, number]> = [];
    let folded: string | undefined;
    for (const term of query) {
        if (term._tag !== "Text") {
            continue;
        }
        const { needle } = term;
        const [hay, sought] =
            needle._tag === "Exact" ? [text, needle.text] : [(folded ??= foldInPlace(text)), needle.lower];
        for (let at = hay.indexOf(sought); at >= 0; at = hay.indexOf(sought, at + 1)) {
            found[found.length] = [at, at + sought.length];
        }
    }
    if (found.length === 0) {
        return none;
    }
    const sorted = Arr.sort(
        found,
        Order.mapInput(Order.Number, (range: readonly [number, number]) => range[0]),
    );
    const merged: Array<readonly [number, number]> = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last !== undefined && range[0] <= last[1]) {
            merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
        } else {
            merged[merged.length] = range;
        }
    }
    return merged;
};

export const clip = (ranges: Ranges, kept: number): Ranges => {
    const out: Array<readonly [number, number]> = [];
    for (const [start, end] of ranges) {
        if (start < kept) {
            out[out.length] = [start, Math.min(end, kept)];
        }
    }
    return out;
};

export const shift = (ranges: Ranges, by: number): Ranges =>
    by === 0 ? ranges : Arr.map(ranges, ([start, end]) => [start + by, end + by] as const);
