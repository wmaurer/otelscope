import { Number as Num, Option } from "effect";

import { matchesIn } from "./bodySearch.ts";
import { below } from "./stops.ts";

import type { BodyView } from "../nav/Screen.ts";
import type { BodyDoc } from "./bodyDoc.ts";
import type { BodyMatches } from "./bodySearch.ts";
import type { Chunk, Line } from "./Role.ts";

/** The rendered rows of a doc: row i shows `text[start[i], end[i])`. */
export interface BodyRows {
    readonly count: number;
    readonly start: ReadonlyArray<number>;
    readonly end: ReadonlyArray<number>;
    /** The longest logical line: how far the rows scroll sideways with wrapping off. */
    readonly widest: number;
    /** The row showing `offset`; a space dropped at a wrap belongs to the row before it. */
    readonly rowAt: (offset: number) => number;
}

/** The last space within `width` of `from`, or None when the word is longer than the width. */
const breakAt = (text: string, from: number, width: number): Option.Option<number> => {
    for (let at = from + width; at > from; at--) {
        if (text.charCodeAt(at) === 32) {
            return Option.some(at);
        }
    }
    return Option.none();
};

const build = (doc: BodyDoc, width: number, wrap: boolean): BodyRows => {
    const { text, lineStarts } = doc;
    const start: Array<number> = [];
    const end: Array<number> = [];
    const push = (from: number, to: number) => {
        start[start.length] = from;
        end[end.length] = to;
    };
    let widest = 0;
    for (let line = 0; line < lineStarts.length - 1; line++) {
        const from = lineStarts[line] ?? 0;
        const to = (lineStarts[line + 1] ?? 0) - 1;
        widest = Math.max(widest, to - from);
        let at = from;
        while (wrap && to - at > width) {
            const space = breakAt(text, at, width);
            push(
                at,
                Option.getOrElse(space, () => at + width),
            );
            at = Option.match(space, { onNone: () => at + width, onSome: (s) => s + 1 });
        }
        if (at < to || at === from) {
            push(at, to);
        }
    }
    return {
        count: start.length,
        start,
        end,
        widest,
        rowAt: (offset) => Math.max(0, below(start, offset + 1) - 1),
    };
};

interface RowsMemo {
    readonly width: number;
    readonly wrap: boolean;
    readonly rows: BodyRows;
}

// oxlint-disable-next-line effect-native/imperative-collection-build -- a cache: filling it is the design.
const memo = new WeakMap<BodyDoc, RowsMemo>();

/**
 * One row per line, or with `wrap` lines broken at the last space that fits (dropping it), and a word longer than
 * `width` broken hard. Memoized per doc for the last width and wrap, which the frame and the keys both ask for.
 */
export const rowsOf = (doc: BodyDoc, width: number, wrap: boolean): BodyRows => {
    const columns = Math.max(1, width);
    const cached = memo.get(doc);
    if (cached !== undefined && cached.wrap === wrap && (!wrap || cached.width === columns)) {
        return cached.rows;
    }
    const rows = build(doc, columns, wrap);
    memo.set(doc, { width: columns, wrap, rows });
    return rows;
};

export const SIDEWAYS = 8;

/** The view's scroll position clamped to the rows, as every reader sees it. The stored view is never rewritten. */
export interface Clamped {
    readonly top: number;
    readonly left: number;
    readonly maxTop: number;
    readonly maxLeft: number;
}

export const clampedView = (view: BodyView, rows: BodyRows, viewport: number, width: number): Clamped => {
    const maxTop = Math.max(0, rows.count - viewport);
    const maxLeft = view.wrap ? 0 : Math.max(0, rows.widest - width);
    return {
        top: Num.clamp(view.topLine, { minimum: 0, maximum: maxTop }),
        left: Num.clamp(view.leftCol, { minimum: 0, maximum: maxLeft }),
        maxTop,
        maxLeft,
    };
};

/** One cell per character: a tab shows as a space, any other control character as `·`. */
// oxlint-disable-next-line no-control-regex -- replacing control characters is the point.
const drawn = (text: string): string => text.replace(/[\u0000-\u001f]/g, (char) => (char === "\t" ? " " : "·"));

interface Window {
    readonly left: number;
    readonly width: number;
}

/** A visible row, coloured by the doc's runs, with every match on `matchBg` and the current one on `currentMatchBg`. */
export const rowLine = (
    doc: BodyDoc,
    rows: BodyRows,
    matches: BodyMatches,
    current: Option.Option<number>,
    row: number,
    window: Window,
): Line => {
    const from = (rows.start[row] ?? 0) + window.left;
    const to = Math.min(rows.end[row] ?? 0, from + window.width);
    if (to <= from) {
        return [];
    }
    const { runs } = doc;
    const found = matchesIn(matches, from, to);
    const parts: Array<Chunk> = [];
    let run = below(runs.end, from + 1);
    let match = 0;
    for (let at = from; at < to;) {
        const runStart = runs.start[run] ?? Infinity;
        const matchStart = found[match] ?? Infinity;
        const inRun = runStart <= at;
        const inMatch = matchStart <= at;
        const next = Math.min(
            to,
            inRun ? (runs.end[run] ?? to) : runStart,
            inMatch ? matchStart + matches.length : matchStart,
        );
        const text = drawn(doc.text.slice(at, next));
        const role = inRun ? (runs.role[run] ?? "text") : "text";
        parts[parts.length] = inMatch
            ? { text, role, bg: Option.contains(current, matchStart) ? "currentMatchBg" : "matchBg" }
            : { text, role };
        at = next;
        if (next === runs.end[run]) {
            run++;
        }
        if (next === matchStart + matches.length) {
            match++;
        }
    }
    return parts;
};
