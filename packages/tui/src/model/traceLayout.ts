import type { Panes } from "./panes.ts";

export const WIDE_MIN = 100;
export const SPLIT_MIN = 25;
export const SPLIT_MAX = 80;
export const NAME_MIN = 16;
export const LOGS_MIN = 6;
/** Borders 2 + gutter 1 + glyph 2 + duration 8 + space 1 + a 4-cell bar. */
export const NAME_SLACK = 18;

/** The breadcrumb and the trace header above the body. */
const HEADER_ROWS = 2;
/** The status bar below the body. */
const FOOTER_ROWS = 1;
const LOGS_SHARE = 0.3;
/** Borders 2 + gutter 1 + glyph 2 + duration 8 + space 1: every tree-row cell outside the name and bar columns. */
const ROW_FIXED = 14;

/** Cells relative to the trace body: x from the screen's left, y from the row under the trace header (screen row 2). Outer, borders included. */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface TraceLayout {
    readonly mode: "wide" | "stacked";
    /** Everything between the header line and the status bar. */
    readonly body: Rect;
    readonly tree: Rect;
    readonly details: Rect;
    readonly logs: Rect;
    /** Where a divider drag starts: the two border columns between tree and details (wide), or the two border rows between the tree and the panes below (stacked). */
    readonly grip: Rect;
    readonly nameColumn: number;
    readonly barWidth: number;
    /** The tree's inner height minus the axis row. */
    readonly treeRows: number;
    readonly detailsRows: number;
    readonly detailsWidth: number;
    readonly logsRows: number;
    readonly logsWidth: number;
}

interface Size {
    readonly width: number;
    readonly height: number;
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

const clampSplit = (split: number): number => clamp(split, SPLIT_MIN, SPLIT_MAX);

const nameMax = (tree: Rect): number => Math.max(NAME_MIN, tree.width - NAME_SLACK);

const inner = (n: number): number => Math.max(0, n - 2);

/** The cells either side of the line at `at` along a length of `total`: the last of the first part and the first of the second. */
const borderPair = (at: number, total: number) => ({
    from: Math.max(0, at - 1),
    size: Math.min(at, 1) + Math.min(total - at, 1),
});

const panesOf = (
    size: Size,
    split: number,
    body: Rect,
): Pick<TraceLayout, "mode" | "tree" | "details" | "logs" | "grip"> => {
    if (size.width >= WIDE_MIN) {
        const logsHeight = Math.min(body.height, Math.max(LOGS_MIN, Math.round(body.height * LOGS_SHARE)));
        const top = body.height - logsHeight;
        const treeWidth = Math.round((size.width * split) / 100);
        const grip = borderPair(treeWidth, size.width);
        return {
            mode: "wide",
            tree: { x: 0, y: 0, width: treeWidth, height: top },
            details: { x: treeWidth, y: 0, width: size.width - treeWidth, height: top },
            logs: { x: 0, y: top, width: size.width, height: logsHeight },
            grip: { x: grip.from, y: 0, width: grip.size, height: top },
        };
    }
    const treeHeight = Math.round((body.height * split) / 100);
    const below = body.height - treeHeight;
    const detailsWidth = Math.floor(size.width / 2);
    const grip = borderPair(treeHeight, body.height);
    return {
        mode: "stacked",
        tree: { x: 0, y: 0, width: size.width, height: treeHeight },
        details: { x: 0, y: treeHeight, width: detailsWidth, height: below },
        logs: { x: detailsWidth, y: treeHeight, width: size.width - detailsWidth, height: below },
        grip: { x: 0, y: grip.from, width: size.width, height: grip.size },
    };
};

export const traceLayout = (size: Size, panes: Panes): TraceLayout => {
    const body: Rect = { x: 0, y: 0, width: size.width, height: Math.max(0, size.height - HEADER_ROWS - FOOTER_ROWS) };
    const { mode, tree, details, logs, grip } = panesOf(size, clampSplit(panes.split), body);
    const nameColumn = clamp(panes.nameColumn, NAME_MIN, nameMax(tree));
    return {
        mode,
        body,
        tree,
        details,
        logs,
        grip,
        nameColumn,
        barWidth: Math.max(0, tree.width - ROW_FIXED - nameColumn),
        treeRows: Math.max(0, tree.height - 3),
        detailsRows: inner(details.height),
        detailsWidth: inner(details.width),
        logsRows: inner(logs.height),
        logsWidth: inner(logs.width),
    };
};

export const resizeSplit = (panes: Panes, delta: number): Panes => ({
    ...panes,
    split: clampSplit(panes.split + delta),
});

/** From the effective (clamped) column, so `>` at the maximum changes nothing and the stored value never runs away. */
export const resizeName = (panes: Panes, layout: TraceLayout, delta: number): Panes => ({
    ...panes,
    nameColumn: clamp(layout.nameColumn + delta, NAME_MIN, nameMax(layout.tree)),
});

/** A divider drag at absolute screen cell (x, y): the whole percent that puts the tree's border under the pointer, clamped to 25..80. */
export const splitAt = (layout: TraceLayout, size: Size, x: number, y: number): number => {
    const [border, length] = layout.mode === "wide" ? [x, size.width] : [y - HEADER_ROWS, layout.body.height];
    return clampSplit(Math.round(((border + 1) * 100) / Math.max(1, length)));
};
