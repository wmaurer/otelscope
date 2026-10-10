import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Order, Schema } from "effect";

import { defaultPanes } from "../../src/model/panes.ts";
import { resizeName, resizeSplit, splitAt, traceLayout } from "../../src/model/traceLayout.ts";

import type { Rect } from "../../src/model/traceLayout.ts";

const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

/** The screen row of the body's first row: the breadcrumb and trace header sit above it. */
const BODY_TOP = 2;

const cellsOf = (rect: Rect): ReadonlyArray<string> =>
    Arr.flatMap(Arr.range(0, rect.height - 1), (dy) =>
        rect.width < 1 || rect.height < 1
            ? []
            : Arr.map(Arr.range(0, rect.width - 1), (dx) => `${rect.x + dx},${rect.y + dy}`),
    );

describe("traceLayout", () => {
    it("puts tree | details over a 30% logs strip at 120×40", () => {
        expect(traceLayout({ width: 120, height: 40 }, defaultPanes)).toEqual({
            mode: "wide",
            body: { x: 0, y: 0, width: 120, height: 37 },
            tree: { x: 0, y: 0, width: 60, height: 26 },
            details: { x: 60, y: 0, width: 60, height: 26 },
            logs: { x: 0, y: 26, width: 120, height: 11 },
            grip: { x: 59, y: 0, width: 2, height: 26 },
            nameColumn: 32,
            barWidth: 14,
            treeRows: 23,
            detailsRows: 24,
            detailsWidth: 58,
            logsRows: 9,
            logsWidth: 118,
        });
    });

    it("stacks the tree over details | logs at 80×24", () => {
        expect(traceLayout({ width: 80, height: 24 }, defaultPanes)).toEqual({
            mode: "stacked",
            body: { x: 0, y: 0, width: 80, height: 21 },
            tree: { x: 0, y: 0, width: 80, height: 11 },
            details: { x: 0, y: 11, width: 40, height: 10 },
            logs: { x: 40, y: 11, width: 40, height: 10 },
            grip: { x: 0, y: 10, width: 80, height: 2 },
            nameColumn: 32,
            barWidth: 34,
            treeRows: 8,
            detailsRows: 8,
            detailsWidth: 38,
            logsRows: 8,
            logsWidth: 38,
        });
    });

    it("goes wide at 100 columns", () => {
        expect(traceLayout({ width: 99, height: 40 }, defaultPanes).mode).toBe("stacked");
        expect(traceLayout({ width: 100, height: 40 }, defaultPanes).mode).toBe("wide");
    });

    it("gives the logs strip at least 6 rows", () => {
        expect(traceLayout({ width: 120, height: 20 }, defaultPanes).logs).toEqual({
            x: 0,
            y: 11,
            width: 120,
            height: 6,
        });
    });

    it("splits by width when wide and by height when stacked, clamped to 25..80", () => {
        expect(traceLayout({ width: 120, height: 40 }, { split: 70, nameColumn: 32 }).tree.width).toBe(84);
        expect(traceLayout({ width: 120, height: 40 }, { split: 10, nameColumn: 32 }).tree.width).toBe(30);
        expect(traceLayout({ width: 120, height: 40 }, { split: 95, nameColumn: 32 }).tree.width).toBe(96);
        expect(traceLayout({ width: 80, height: 24 }, { split: 80, nameColumn: 32 }).tree.height).toBe(17);
        expect(traceLayout({ width: 80, height: 24 }, { split: 0, nameColumn: 32 }).tree.height).toBe(5);
    });

    it("clamps the name column to 16..tree width − 18, leaving a 4-cell bar at the maximum", () => {
        const wide = { width: 120, height: 40 };
        expect(traceLayout(wide, { split: 50, nameColumn: 5 })).toMatchObject({ nameColumn: 16, barWidth: 30 });
        expect(traceLayout(wide, { split: 50, nameColumn: 100 })).toMatchObject({ nameColumn: 42, barWidth: 4 });
        expect(traceLayout({ width: 100, height: 40 }, { split: 25, nameColumn: 32 })).toMatchObject({
            nameColumn: 16,
            barWidth: 0,
        });
    });

    it.prop(
        "covers every body cell with exactly one pane",
        [between(40, 200), between(10, 80), between(25, 80), between(0, 200)],
        ([width, height, split, nameColumn]) => {
            const layout = traceLayout({ width, height }, { split, nameColumn });
            const cells = Arr.flatMap([layout.tree, layout.details, layout.logs], cellsOf);
            expect(new Set(cells).size).toBe(cells.length);
            expect(Arr.sort(cells, Order.String)).toEqual(Arr.sort(cellsOf(layout.body), Order.String));
            expect(layout.barWidth).toBeGreaterThanOrEqual(0);
        },
    );
});

describe("resizeSplit", () => {
    it("moves the split by the step, within 25..80", () => {
        expect(resizeSplit(defaultPanes, 5)).toEqual({ split: 55, nameColumn: 32 });
        expect(resizeSplit({ split: 78, nameColumn: 32 }, 5)).toEqual({ split: 80, nameColumn: 32 });
        expect(resizeSplit({ split: 25, nameColumn: 32 }, -5)).toEqual({ split: 25, nameColumn: 32 });
    });
});

describe("resizeName", () => {
    const size = { width: 120, height: 40 };

    it("widens and narrows the effective column", () => {
        expect(resizeName(defaultPanes, traceLayout(size, defaultPanes), 5)).toEqual({ split: 50, nameColumn: 37 });
        expect(resizeName(defaultPanes, traceLayout(size, defaultPanes), -20)).toEqual({ split: 50, nameColumn: 16 });
    });

    it("changes nothing at the maximum, and narrows from what is shown, not from a stored value past it", () => {
        const atMax = { split: 50, nameColumn: 42 };
        expect(resizeName(atMax, traceLayout(size, atMax), 5)).toEqual(atMax);
        const beyond = { split: 50, nameColumn: 90 };
        expect(resizeName(beyond, traceLayout(size, beyond), -5)).toEqual({ split: 50, nameColumn: 37 });
    });
});

describe("splitAt", () => {
    const wide = { width: 120, height: 40 };
    const stacked = { width: 80, height: 24 };

    const borderColumn = (split: number) => {
        const { tree } = traceLayout(wide, { split, nameColumn: 32 });
        return tree.x + tree.width - 1;
    };
    const borderRow = (split: number) => {
        const { tree } = traceLayout(stacked, { split, nameColumn: 32 });
        return BODY_TOP + tree.y + tree.height - 1;
    };

    it("puts the tree's right border under the pointer when wide", () => {
        const layout = traceLayout(wide, defaultPanes);
        expect(Arr.map([40, 59, 61, 71, 90], (x) => borderColumn(splitAt(layout, wide, x, 5)))).toEqual([
            40, 59, 61, 71, 90,
        ]);
    });

    it("puts the tree's bottom border under the pointer when stacked", () => {
        const layout = traceLayout(stacked, defaultPanes);
        expect(Arr.map([7, 10, 12, 15, 18], (y) => borderRow(splitAt(layout, stacked, 10, y)))).toEqual([
            7, 10, 12, 15, 18,
        ]);
    });

    it("keeps the split within 25..80", () => {
        const layout = traceLayout(wide, defaultPanes);
        expect(splitAt(layout, wide, 0, 5)).toBe(25);
        expect(splitAt(layout, wide, 119, 5)).toBe(80);
    });

    it.prop(
        "lands the border within a cell of the pointer",
        [between(40, 200), between(10, 80), between(0, 199)],
        ([width, height, pointer]) => {
            const size = { width, height };
            const layout = traceLayout(size, defaultPanes);
            const wideMode = layout.mode === "wide";
            const length = wideMode ? width : layout.body.height;
            const target = pointer % length;
            const split = splitAt(layout, size, wideMode ? target : 0, wideMode ? 0 : BODY_TOP + target);
            const { tree } = traceLayout(size, { split, nameColumn: 32 });
            const border = wideMode ? tree.width - 1 : tree.height - 1;
            const reachable = target + 1 >= (length * 25) / 100 && target + 1 <= (length * 80) / 100;
            if (reachable) expect(Math.abs(border - target)).toBeLessThanOrEqual(Math.ceil(length / 200));
        },
    );
});
