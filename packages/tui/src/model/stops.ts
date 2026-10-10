import { Option } from "effect";

import type { Dir } from "../keys/Action.ts";

/** How many of the sorted `values` are strictly below `bound`. */
export const below = (values: ReadonlyArray<number>, bound: number): number => {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if ((values[mid] ?? 0) < bound) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
};

/** How many of the sorted `values` lie in `[from, to)`. */
export const countIn = (values: ReadonlyArray<number>, from: number, to: number): number =>
    to <= from ? 0 : below(values, to) - below(values, from);

/** The index of `value` in the sorted `values`, or -1. */
export const indexIn = (values: ReadonlyArray<number>, value: number): number => {
    const at = below(values, value);
    return values[at] === value ? at : -1;
};

/** The first stop at or after `anchor`, without wrapping. */
export const firstAtOrAfter = (stops: ReadonlyArray<number>, anchor: number): Option.Option<number> =>
    Option.fromUndefinedOr(stops[below(stops, anchor)]);

/** The next stop strictly after `anchor`, or the previous one strictly before it, wrapping at either end. */
export const nextStop = (stops: ReadonlyArray<number>, anchor: number, dir: Dir): Option.Option<number> => {
    if (dir === "next") {
        const after = below(stops, anchor + 0.25);
        return Option.fromUndefinedOr(stops[after] ?? stops[0]);
    }
    const before = below(stops, anchor) - 1;
    return Option.fromUndefinedOr(stops[before] ?? stops[stops.length - 1]);
};
