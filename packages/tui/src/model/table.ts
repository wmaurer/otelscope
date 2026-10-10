import { Array as Arr } from "effect";

import { clip } from "../query/Highlight.ts";
import { count } from "./format.ts";
import { chunk, underlay } from "./Role.ts";
import { cells, cut, lineCells } from "./text.ts";

import type { Ranges } from "../query/Highlight.ts";
import type { Chunk, Line, Role } from "./Role.ts";

type Align = "left" | "right";

type Width = { readonly fixed: number } | { readonly flex: number; readonly min: number };

export interface Column<Id extends string> {
    readonly id: Id;
    readonly title: string;
    readonly align: Align;
    readonly width: Width;
}

export interface Placed<Id extends string> {
    readonly id: Id;
    readonly title: string;
    readonly align: Align;
    readonly width: number;
}

const MARGIN = 1;
export const GAP = 1;

const fixedOf = (width: Width): number => ("fixed" in width ? width.fixed : width.min);

const needed = <Id extends string>(columns: ReadonlyArray<Column<Id>>): number =>
    MARGIN + Arr.reduce(columns, 0, (sum, column) => sum + fixedOf(column.width)) + GAP * (columns.length - 1);

export const layout = <Id extends string>(
    columns: ReadonlyArray<Column<Id>>,
    width: number,
    dropOrder: ReadonlyArray<Id>,
): ReadonlyArray<Placed<Id>> => {
    const kept = Arr.reduce(dropOrder, columns, (current, id) =>
        needed(current) > width ? Arr.filter(current, (column) => column.id !== id) : current,
    );
    const spare = Math.max(0, width - needed(kept));
    const shares = Arr.reduce(kept, 0, (sum, column) => sum + ("flex" in column.width ? column.width.flex : 0));
    const extra = (flex: number) => (shares === 0 ? 0 : Math.floor((spare * flex) / shares));
    const given = Arr.reduce(kept, 0, (sum, column) => sum + ("flex" in column.width ? extra(column.width.flex) : 0));
    const firstFlex = Arr.findFirstIndex(kept, (column) => "flex" in column.width);
    return Arr.map(kept, (column, i) => ({
        id: column.id,
        title: column.title,
        align: column.align,
        width:
            "fixed" in column.width
                ? column.width.fixed
                : column.width.min +
                  extra(column.width.flex) +
                  (firstFlex._tag === "Some" && firstFlex.value === i ? spare - given : 0),
    }));
};

const pad = (n: number): Chunk => chunk(" ".repeat(Math.max(0, n)), "text");

export const cell = (text: string, width: number, align: Align, role: Role, ranges: Ranges = []): Line => {
    const kept = cut(text, width);
    const shown = clip(ranges, kept === text ? kept.length : kept.length - 1);
    const parts: Array<Chunk> = [];
    let at = 0;
    for (const [start, end] of shown) {
        if (start > at) {
            parts[parts.length] = chunk(kept.slice(at, start), role);
        }
        parts[parts.length] = { text: kept.slice(start, end), role, bg: "matchBg" };
        at = end;
    }
    if (at < kept.length) {
        parts[parts.length] = chunk(kept.slice(at), role);
    }
    const room = width - cells(kept);
    return align === "right" ? [pad(room), ...parts] : [...parts, pad(room)];
};

export const row = (cellLines: ReadonlyArray<Line>, width: number, selected: boolean): Line => {
    const joined = Arr.flatMap(cellLines, (line, i) => (i === 0 ? [pad(MARGIN), ...line] : [pad(GAP), ...line]));
    const line = [...joined, pad(width - lineCells(joined))];
    return selected ? underlay(line, "selectionBg") : line;
};

export const header = <Id extends string>(
    placed: ReadonlyArray<Placed<Id>>,
    sorted: Id,
    reverse: boolean,
    width: number,
): Line =>
    row(
        Arr.map(placed, (column) =>
            cell(
                column.id === sorted ? `${column.title} ${reverse ? "▴" : "▾"}` : column.title,
                column.width,
                column.align,
                "muted",
            ),
        ),
        width,
        false,
    );

export const countText = (n: number): string => (n === 0 ? "" : count(n));
