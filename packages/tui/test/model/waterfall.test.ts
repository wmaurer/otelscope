import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Schema } from "effect";

import {
    axisSegments,
    Bar,
    barSegments,
    barStart,
    markersOf,
    MIN_TICK_CELLS,
    scaleOf,
    tickMs,
} from "../../src/model/waterfall.ts";
import { exception, log, record } from "../support/records.ts";

import type { Marker, Scale, Segment, Tone } from "../../src/model/waterfall.ts";

const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

/** 10 cells over 100 ms: one cell is 10 ms, an eighth is 1.25 ms. */
const ten: Scale = { startMs: 0, endMs: 100, width: 10 };

const span = (startMs: number, ms: number, markers: ReadonlyArray<Marker> = [], tone: Tone = "success"): Bar =>
    Bar.Span({ startMs, ms, tone, markers });

/** The interval just below `interval` in the 1, 2, 5 sequence. */
const previous = (interval: number): number => {
    const digit = Math.round(interval / 10 ** Math.floor(Math.log10(interval) + 1e-9));
    return digit === 5 ? interval * 0.4 : interval / 2;
};

const cellsOf = (segments: ReadonlyArray<Segment>): ReadonlyArray<number> =>
    Arr.flatMap(segments, (segment) => Arr.makeBy(segment.text.length, (i) => segment.x + i));

describe("tickMs", () => {
    it("takes the smallest of 1, 2 and 5 × 10ⁿ ms spaced at least 10 cells apart", () => {
        expect(tickMs(1240, 62)).toBe(200);
        expect(tickMs(100, 100)).toBe(10);
        expect(tickMs(150, 100)).toBe(20);
        expect(tickMs(300, 100)).toBe(50);
        expect(tickMs(600, 100)).toBe(100);
        expect(tickMs(0.03, 100)).toBe(0.005);
    });

    it("stops at 1 µs", () => {
        expect(tickMs(0.001, 100)).toBe(0.001);
        expect(tickMs(0.000_01, 100)).toBe(0.001);
    });

    it.prop(
        "spaces ticks at least 10 cells apart, and the next smaller interval would not",
        [between(100, 999), between(-3, 6), between(10, 200)],
        ([mantissa, exponent, width]) => {
            const range = (mantissa / 100) * 10 ** exponent;
            const interval = tickMs(range, width);
            expect((interval / range) * width).toBeGreaterThanOrEqual(MIN_TICK_CELLS - 1e-9);
            if (interval > 0.001) expect((previous(interval) / range) * width).toBeLessThan(MIN_TICK_CELLS);
        },
    );
});

describe("scaleOf", () => {
    it("keeps a finished trace's end, and floors an empty range at 1 µs", () => {
        expect(scaleOf(1_000, 1_237, false, 50)).toEqual({ startMs: 1_000, endMs: 1_237, width: 50 });
        expect(scaleOf(1_000, 1_000, false, 50).endMs).toBeGreaterThan(1_000);
        expect(scaleOf(0, 0, false, 50).endMs).toBe(0.001);
    });

    it("rounds a running trace's end up to the next tick, so it rescales only when it crosses one", () => {
        expect(scaleOf(0, 4.1, true, 100).endMs).toBe(4.5);
        expect(scaleOf(0, 4.4, true, 100).endMs).toBe(4.5);
        expect(scaleOf(0, 4.6, true, 100).endMs).toBe(5);
    });

    it("rounds to a tick of the rounded range's own axis", () => {
        // At 27 cells, 4.1 ms rounds to 6 on 2 ms ticks, but 6 ms ticks at 5; and 5 ms ticks at 2.
        const scale = scaleOf(0, 4.1, true, 27);
        expect(scale.endMs).toBe(10);
        expect(tickMs(scale.endMs, 27)).toBe(5);
    });

    it.prop(
        "a running end is a tick of its own axis, and any end up to it gives the same scale",
        [between(1, 100_000), between(0, 1_000), between(10, 200)],
        ([tenths, later, width]) => {
            const range = tenths / 10;
            const end = scaleOf(0, range, true, width).endMs;
            const ticks = end / tickMs(end, width);
            expect(end).toBeGreaterThanOrEqual(range);
            expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-6);
            expect(scaleOf(0, range + ((end - range) * later) / 1_000, true, width).endMs).toBe(end);
        },
    );
});

describe("barSegments", () => {
    it("fills whole cells and ends in the eighth block of x(end)", () => {
        expect(barSegments(ten, span(0, 100), 0)).toEqual([{ x: 0, text: "██████████", role: "bar" }]);
        expect(
            Arr.map(Arr.range(1, 7), (eighths) => barSegments(ten, span(0, 10 + eighths * 1.25), 0)[0]?.text),
        ).toEqual(["█▏", "█▎", "█▍", "█▌", "█▋", "█▊", "█▉"]);
        expect(barSegments(ten, span(25, 20), 0)).toEqual([{ x: 2, text: "██▌", role: "bar" }]);
    });

    it("rounds the end to the nearest eighth", () => {
        expect(barSegments(ten, span(0, 29.5), 0)).toEqual([{ x: 0, text: "███", role: "bar" }]);
        expect(barSegments(ten, span(0, 20.7), 0)).toEqual([{ x: 0, text: "██▏", role: "bar" }]);
    });

    it("draws `┃` for a bar under an eighth of a cell, and an eighth block from there up", () => {
        expect(barSegments(ten, span(31, 1), 0)).toEqual([{ x: 3, text: "┃", role: "bar" }]);
        expect(barSegments(ten, span(30, 1.25), 0)).toEqual([{ x: 3, text: "▏", role: "bar" }]);
    });

    it("clamps to the column at both edges", () => {
        expect(barSegments(ten, span(-50, 80), 0)).toEqual([{ x: 0, text: "███", role: "bar" }]);
        expect(barSegments(ten, span(95, 50), 0)).toEqual([{ x: 9, text: "█", role: "bar" }]);
        expect(barSegments(ten, span(150, 10), 0)).toEqual([{ x: 9, text: "█", role: "bar" }]);
        expect(barSegments(ten, span(-80, 2), 0)).toEqual([{ x: 0, text: "▏", role: "bar" }]);
    });

    it("starts no left of the floor, and still draws a cell when the floor passes its end", () => {
        expect(barSegments(ten, span(20, 30), 3)).toEqual([{ x: 3, text: "██", role: "bar" }]);
        expect(barSegments(ten, span(20, 10), 5)).toEqual([{ x: 5, text: "▏", role: "bar" }]);
        expect(barSegments(ten, span(60, 10), 2)).toEqual([{ x: 6, text: "█", role: "bar" }]);
    });

    it("colours a bar by its exit", () => {
        const roleOf = (tone: Tone) => barSegments(ten, span(0, 10, [], tone), 0)[0]?.role;
        expect(Arr.map(["success", "origin", "propagated", "interrupted"] as const, roleOf)).toEqual([
            "bar",
            "failure",
            "failurePropagated",
            "interrupted",
        ]);
    });

    it("draws markers over the bar in the event's colour", () => {
        expect(barSegments(ten, span(0, 100, [{ atMs: 55, kind: "INFO" }]), 0)).toEqual([
            { x: 0, text: "█████", role: "bar" },
            { x: 5, text: "◆", role: "logInfo" },
            { x: 6, text: "████", role: "bar" },
        ]);
        expect(
            barSegments(
                ten,
                span(0, 30, [
                    { atMs: 5, kind: "exception" },
                    { atMs: 15, kind: "other" },
                    { atMs: 25, kind: "FATAL" },
                ]),
                0,
            ),
        ).toEqual([
            { x: 0, text: "✗", role: "failure" },
            { x: 1, text: "◆", role: "muted" },
            { x: 2, text: "◆", role: "logFatal" },
        ]);
    });

    it("collapses markers in one cell: `✗` wins, else the most severe level, else muted", () => {
        const at = (kinds: ReadonlyArray<Marker["kind"]>) =>
            barSegments(
                ten,
                span(
                    0,
                    10,
                    Arr.map(kinds, (kind) => ({ atMs: 4, kind })),
                ),
                0,
            );
        expect(at(["ERROR", "exception", "other"])).toEqual([{ x: 0, text: "✗", role: "failure" }]);
        expect(at(["INFO", "WARN", "DEBUG", "other"])).toEqual([{ x: 0, text: "◆", role: "logWarn" }]);
        expect(at(["other", "other"])).toEqual([{ x: 0, text: "◆", role: "muted" }]);
    });

    it("clamps markers to the column", () => {
        expect(
            barSegments(
                ten,
                span(40, 10, [
                    { atMs: -30, kind: "other" },
                    { atMs: 300, kind: "exception" },
                ]),
                0,
            ),
        ).toEqual([
            { x: 0, text: "◆", role: "muted" },
            { x: 4, text: "█", role: "bar" },
            { x: 9, text: "✗", role: "failure" },
        ]);
    });

    it("draws a group's envelope in `░` from its start cell up to ⌈x(end)⌉, at least one cell", () => {
        expect(barSegments(ten, Bar.Envelope({ startMs: 25, endMs: 41 }), 0)).toEqual([
            { x: 2, text: "░░░", role: "muted" },
        ]);
        expect(barSegments(ten, Bar.Envelope({ startMs: 20, endMs: 20 }), 0)).toEqual([
            { x: 2, text: "░", role: "muted" },
        ]);
        expect(barSegments(ten, Bar.Envelope({ startMs: 0, endMs: 200 }), 6)).toEqual([
            { x: 6, text: "░░░░", role: "muted" },
        ]);
    });

    it("draws nothing for a missing-parent row", () => {
        expect(barSegments(ten, Bar.None(), 0)).toEqual([]);
    });

    it("draws nothing in a column of no cells", () => {
        expect(barSegments({ startMs: 0, endMs: 100, width: 0 }, span(0, 100), 0)).toEqual([]);
    });
});

describe("barStart", () => {
    it("is the clamped start cell, or the floor when that is further right", () => {
        expect(barStart(ten, span(35, 10), 0)).toBe(3);
        expect(barStart(ten, span(35, 10), 6)).toBe(6);
        expect(barStart(ten, span(500, 10), 0)).toBe(9);
        expect(barStart(ten, Bar.Envelope({ startMs: -5, endMs: 10 }), 0)).toBe(0);
        expect(barStart(ten, Bar.None(), 4)).toBe(4);
    });
});

describe("markersOf", () => {
    it("places every event at the span's start plus its offset, by kind", () => {
        const events = [
            { ...exception("Boom", "it broke"), offsetMs: 2 },
            { ...log("charged", "WARN"), offsetMs: 3.5 },
            { name: "retry", offsetMs: 4, attrs: {} },
            { name: "odd level", offsetMs: 5, attrs: { "effect.logLevel": "LOUD" } },
        ];
        expect(markersOf(record({ span: "a", startMs: 1_000, events }))).toEqual([
            { atMs: 1_002, kind: "exception" },
            { atMs: 1_003.5, kind: "WARN" },
            { atMs: 1_004, kind: "other" },
            { atMs: 1_005, kind: "other" },
        ]);
    });
});

describe("axisSegments", () => {
    it("draws `│` and a duration label at each tick, the first labelled 0, and leaves off a label past the column", () => {
        expect(axisSegments({ startMs: 0, endMs: 1_240, width: 62 })).toEqual([
            { x: 0, text: "│0", role: "muted" },
            { x: 10, text: "│200ms", role: "muted" },
            { x: 20, text: "│400ms", role: "muted" },
            { x: 30, text: "│600ms", role: "muted" },
            { x: 40, text: "│800ms", role: "muted" },
            { x: 50, text: "│1.00s", role: "muted" },
            { x: 60, text: "│", role: "muted" },
        ]);
    });

    it("puts ticks at exact multiples of the interval from the trace start", () => {
        expect(axisSegments({ startMs: 1_700_000_000_000, endMs: 1_700_000_000_300, width: 46 })).toEqual([
            { x: 0, text: "│0", role: "muted" },
            { x: 15, text: "│100ms", role: "muted" },
            { x: 30, text: "│200ms", role: "muted" },
        ]);
    });

    it("labels microsecond ticks", () => {
        expect(axisSegments({ startMs: 0, endMs: 0.1, width: 50 })).toEqual([
            { x: 0, text: "│0", role: "muted" },
            { x: 10, text: "│20µs", role: "muted" },
            { x: 20, text: "│40µs", role: "muted" },
            { x: 30, text: "│60µs", role: "muted" },
            { x: 40, text: "│80µs", role: "muted" },
        ]);
    });

    it("keeps only the first tick in a column narrower than a tick", () => {
        expect(axisSegments({ startMs: 0, endMs: 100, width: 6 })).toEqual([{ x: 0, text: "│0", role: "muted" }]);
        expect(axisSegments({ startMs: 0, endMs: 100, width: 1 })).toEqual([{ x: 0, text: "│", role: "muted" }]);
        expect(axisSegments({ startMs: 0, endMs: 100, width: 0 })).toEqual([]);
    });

    it.prop(
        "draws ticks at least 10 cells apart, inside the column",
        [between(1, 1_000_000), between(1, 200), Schema.Boolean],
        ([tenths, width, running]) => {
            const scale = scaleOf(0, tenths / 10, running, width);
            const ticks = Arr.flatMap(axisSegments(scale), (segment) =>
                segment.text.startsWith("│") ? [segment.x] : [],
            );
            expect(ticks[0]).toBe(0);
            expect(Arr.every(Arr.zip(ticks, Arr.drop(ticks, 1)), ([a, b]) => b - a >= MIN_TICK_CELLS)).toBe(true);
            expect(Arr.every(cellsOf(axisSegments(scale)), (cell) => cell < width)).toBe(true);
        },
    );
});

describe("bar properties", () => {
    const GeneratedBar = Schema.Struct({
        tag: Schema.Literals(["Span", "Envelope", "None"]),
        start: between(-300, 1_300),
        length: between(0, 1_500),
        tone: Schema.Literals(["success", "origin", "propagated", "interrupted"]),
        markers: Schema.Array(Schema.Struct({ offset: between(-100, 1_600), kind: between(0, 7) })).check(
            Schema.isMaxLength(6),
        ),
    });
    const kinds = ["exception", "other", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;

    /** Times in tenths of a millisecond, so bars end mid-cell. */
    const barOf = (seed: typeof GeneratedBar.Type): Bar => {
        const startMs = seed.start / 10;
        const ms = seed.length / 10;
        return seed.tag === "None"
            ? Bar.None()
            : seed.tag === "Envelope"
              ? Bar.Envelope({ startMs, endMs: startMs + ms })
              : Bar.Span({
                    startMs,
                    ms,
                    tone: seed.tone,
                    markers: Arr.map(seed.markers, (marker) => ({
                        atMs: startMs + marker.offset / 10,
                        kind: kinds[marker.kind] ?? "other",
                    })),
                });
    };

    it.prop(
        "keeps every segment inside the column, in order and never overlapping",
        [GeneratedBar, between(1, 1_000), between(0, 120), between(-5, 130), Schema.Boolean],
        ([seed, range, width, floor, running]) => {
            const segments = barSegments(scaleOf(0, range / 10, running, width), barOf(seed), floor);
            const cells = cellsOf(segments);
            expect(Arr.every(cells, (cell) => cell >= 0 && cell < width)).toBe(true);
            expect(Arr.every(Arr.zip(cells, Arr.drop(cells, 1)), ([a, b]) => b > a)).toBe(true);
            expect(Arr.every(segments, (segment) => segment.text.length > 0 && !segment.text.includes(" "))).toBe(true);
        },
    );

    it.prop(
        "never starts a child left of its parent, even one a skewed clock starts before it",
        [GeneratedBar, GeneratedBar, between(-1_500, 1_500), between(1, 1_000), between(1, 120)],
        ([parentSeed, childSeed, after, range, width]) => {
            const scale = scaleOf(0, range / 10, false, width);
            const parent = barOf({
                ...parentSeed,
                tag: "Span",
                markers: Arr.map(parentSeed.markers, (m) => ({ ...m, offset: Math.abs(m.offset) })),
            });
            // Markers keep their own cells, unfloored, so only the child's bar is checked.
            const child = barOf({ ...childSeed, tag: "Span", start: parentSeed.start + after, markers: [] });
            const first = (segments: ReadonlyArray<Segment>) => segments[0]?.x ?? -1;
            expect(first(barSegments(scale, child, barStart(scale, parent, 0)))).toBeGreaterThanOrEqual(
                first(barSegments(scale, parent, 0)),
            );
        },
    );
});
