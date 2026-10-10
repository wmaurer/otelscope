import { Array as Arr, Data, Option, Order, pipe } from "effect";

import { duration } from "./format.ts";
import { levelOf, levelRole, severity } from "./levels.ts";

import type { LogLevel } from "./levels.ts";
import type { Role } from "./Role.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export interface Scale {
    readonly startMs: number;
    readonly endMs: number;
    readonly width: number;
}

/** A run of equal-role cells, x relative to the bar column's left. Blank cells are never segments. */
export interface Segment {
    readonly x: number;
    readonly text: string;
    readonly role: Role;
}

export const MIN_TICK_CELLS = 10;

const MIN_RANGE_MS = 0.001;

/** Absorbs float error in tick arithmetic, so a whole number of ticks is not rounded up one and a tick on a cell edge is not drawn a cell early. */
const EPSILON = 1e-9;

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/** 1, 2 and 5 × 10ⁿ ms from 1 µs up; n < 0 divides, so 0.002 is the double nearest to it. */
const INTERVALS: ReadonlyArray<number> = Arr.flatMap(Arr.range(-3, 15), (n) =>
    Arr.map([1, 2, 5], (m) => (n < 0 ? m / 10 ** -n : m * 10 ** n)),
);

/** Smallest 1, 2 or 5 × 10ⁿ ms (n ≥ -3, so 1 µs is the floor) whose spacing is at least 10 cells. */
export const tickMs = (rangeMs: number, width: number): number =>
    pipe(
        INTERVALS,
        Arr.findFirst((interval) => interval * width >= MIN_TICK_CELLS * rangeMs),
        Option.getOrElse(() => INTERVALS[INTERVALS.length - 1] ?? 1),
    );

/** The least multiple of `interval`, from `rangeMs` up, whose own axis ticks at `interval`. None when none does. */
const endingOn = (rangeMs: number, width: number, interval: number): Option.Option<number> => {
    for (let k = Math.max(1, Math.ceil(rangeMs / interval - EPSILON)); ; k += 1) {
        const tick = tickMs(k * interval, width);
        if (tick === interval) return Option.some(k * interval);
        if (tick > interval) return Option.none();
    }
};

/**
 * The least range from `rangeMs` up that ends on a tick of its own axis, so the scale stays put until the trace crosses
 * that tick. Under MIN_TICK_CELLS cells no range does (the axis has only its first tick), and the next tick of the
 * unrounded range is used.
 */
const roundedRange = (rangeMs: number, width: number): number => {
    const first = tickMs(rangeMs, width);
    const plain = (): number => Math.ceil(rangeMs / first - EPSILON) * first;
    return width < MIN_TICK_CELLS
        ? plain()
        : pipe(
              INTERVALS,
              Arr.filter((interval) => interval >= first),
              Arr.findFirst((interval) => endingOn(rangeMs, width, interval)),
              Option.getOrElse(plain),
          );
};

/** `running` (a live trace with no root) rounds `endMs` up to the next tick, stable: the interval computed from the rounded range is the one rounded to. */
export const scaleOf = (startMs: number, endMs: number, running: boolean, width: number): Scale => {
    const range = Math.max(endMs - startMs, MIN_RANGE_MS);
    return { startMs, endMs: startMs + (running ? roundedRange(range, width) : range), width };
};

export const xOf = (scale: Scale, atMs: number): number =>
    ((atMs - scale.startMs) / (scale.endMs - scale.startMs)) * scale.width;

const lastCell = (scale: Scale): number => Math.max(0, scale.width - 1);

export const startCell = (scale: Scale, atMs: number): number =>
    clamp(Math.floor(xOf(scale, atMs)), 0, lastCell(scale));

export type Tone = "success" | "origin" | "propagated" | "interrupted";

export type MarkerKind = "exception" | "other" | LogLevel;

export interface Marker {
    readonly atMs: number;
    readonly kind: MarkerKind;
}

/** Every event of the span: `exception` events are "exception", log events their level, anything else "other". */
export const markersOf = (span: JsonlSpanRecord): ReadonlyArray<Marker> =>
    Arr.map(span.events, (event) => ({
        atMs: span.startMs + event.offsetMs,
        kind:
            event.name === "exception"
                ? "exception"
                : Option.getOrElse(levelOf(event.attrs), (): MarkerKind => "other"),
    }));

export type Bar = Data.TaggedEnum<{
    Span: {
        readonly startMs: number;
        readonly ms: number;
        readonly tone: Tone;
        readonly markers: ReadonlyArray<Marker>;
    };
    /** A same-name group row: `░`, muted. */
    Envelope: { readonly startMs: number; readonly endMs: number };
    /** A missing-parent row: nothing drawn. */
    None: {};
}>;

export const Bar = Data.taggedEnum<Bar>();

/** The bar's start cell after clamping and the floor: max(startCell(start), floorCell). Children use it as their floor. */
export const barStart = (scale: Scale, bar: Bar, floorCell: number): number =>
    clamp(bar._tag === "None" ? floorCell : Math.max(startCell(scale, bar.startMs), floorCell), 0, lastCell(scale));

interface Cell {
    readonly char: string;
    readonly role: Role;
}

type Paint = (x: number) => Cell | undefined;

const EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;

const toneRole = {
    success: "bar",
    origin: "failure",
    propagated: "failurePropagated",
    interrupted: "interrupted",
} satisfies Readonly<Record<Tone, Role>>;

const markerRank = (kind: MarkerKind): number =>
    kind === "exception" ? Number.MAX_SAFE_INTEGER : kind === "other" ? -1 : severity(kind);

const markerCell = (kind: MarkerKind): Cell =>
    kind === "exception"
        ? { char: "✗", role: "failure" }
        : { char: "◆", role: kind === "other" ? "muted" : levelRole[kind] };

/** One marker per cell; sorted least first, so the Map keeps the strongest of a cell. */
const markerPaint = (scale: Scale, markers: ReadonlyArray<Marker>): Paint => {
    const byCell = new Map(
        pipe(
            markers,
            Arr.sort(Order.mapInput(Order.Number, (marker: Marker) => markerRank(marker.kind))),
            Arr.map((marker) => [startCell(scale, marker.atMs), markerCell(marker.kind)] as const),
        ),
    );
    return (x) => byCell.get(x);
};

const spanPaint = (scale: Scale, bar: Extract<Bar, { readonly _tag: "Span" }>, start: number): Paint => {
    const role = toneRole[bar.tone];
    if ((bar.ms / (scale.endMs - scale.startMs)) * scale.width < 1 / 8) {
        return (x) => (x === start ? { char: "┃", role } : undefined);
    }
    const end = Math.min(scale.width, xOf(scale, bar.startMs + bar.ms));
    const eighths = Math.max(1, Math.round((end - start) * 8));
    const full = start + Math.floor(eighths / 8);
    const part = EIGHTHS[(eighths % 8) - 1];
    return (x) =>
        x >= start && x < full
            ? { char: "█", role }
            : x === full && part !== undefined
              ? { char: part, role }
              : undefined;
};

const envelopePaint = (scale: Scale, bar: Extract<Bar, { readonly _tag: "Envelope" }>, start: number): Paint => {
    const end = Math.max(start + 1, Math.ceil(xOf(scale, bar.endMs)));
    return (x) => (x >= start && x < end ? { char: "░", role: "muted" } : undefined);
};

/** Consecutive cells of one role become one segment; blank cells end a run and are dropped. */
const runs = (width: number, paint: Paint): ReadonlyArray<Segment> =>
    width < 1
        ? []
        : pipe(
              Arr.makeBy(width, (x) => ({ x, cell: paint(x) })),
              Arr.groupWith((a, b) => a.cell?.role === b.cell?.role),
              Arr.flatMap((group): ReadonlyArray<Segment> => {
                  const { x, cell } = Arr.headNonEmpty(group);
                  return cell === undefined
                      ? []
                      : [
                            {
                                x,
                                text: Arr.join(
                                    Arr.map(group, (each) => each.cell?.char ?? ""),
                                    "",
                                ),
                                role: cell.role,
                            },
                        ];
              }),
          );

/** The bar column for one row, as runs. */
export const barSegments = (scale: Scale, bar: Bar, floorCell: number): ReadonlyArray<Segment> => {
    const start = barStart(scale, bar, floorCell);
    return Bar.$match(bar, {
        Span: (span) => {
            const markers = markerPaint(scale, span.markers);
            const body = spanPaint(scale, span, start);
            return runs(scale.width, (x) => markers(x) ?? body(x));
        },
        Envelope: (envelope) => runs(scale.width, envelopePaint(scale, envelope, start)),
        None: () => [],
    });
};

/** The sticky axis row over the bar column: `│` then the label at each tick; labels that would run into the next tick, or past the column, are left off (the `│` stays). The first label is `0`, the rest `duration(k × interval)`. */
export const axisSegments = (scale: Scale): ReadonlyArray<Segment> => {
    const range = scale.endMs - scale.startMs;
    const interval = tickMs(range, scale.width);
    const cells = Arr.makeBy(Math.ceil(range / interval - EPSILON), (k) =>
        Math.floor(((k * interval) / range) * scale.width + EPSILON),
    );
    const chars = new Map(
        Arr.flatMap(cells, (cell, k) => {
            const label = Arr.fromIterable(k === 0 ? "0" : duration(k * interval));
            const next = cells[k + 1] ?? scale.width;
            const shown = cell + label.length < next ? Arr.map(label, (char, i) => [cell + 1 + i, char] as const) : [];
            return Arr.prepend(shown, [cell, "│"] as const);
        }),
    );
    return runs(scale.width, (x) => {
        const char = chars.get(x);
        return char === undefined ? undefined : { char, role: "muted" };
    });
};
