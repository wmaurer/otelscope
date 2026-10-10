import { Array as Arr } from "effect";

import { ranges } from "../query/Highlight.ts";
import { count, duration, shortId } from "./format.ts";
import { chunk, underlay } from "./Role.ts";
import { cells } from "./text.ts";
import { hiddenText } from "./treeSearch.ts";

import type { Ranges } from "../query/Highlight.ts";
import type { Chunk, Line, Role } from "./Role.ts";
import type { Fold, Rails, TreeEntry } from "./tree.ts";
import type { SpanKind, TreeFacts } from "./treeFacts.ts";
import type { SpanSearch } from "./treeSearch.ts";

const GUTTER = 1;
const GLYPH = 2;
const DURATION = 8;

/** The cells left of the bar column: gutter, exit glyph, the name column, the duration and a space. */
export const leftWidth = (nameColumn: number): number => GUTTER + GLYPH + nameColumn + DURATION + 1;

/** Levels of guides drawn in full; deeper rows show `⋯<depth>` and the innermost ones. */
const SHOWN_LEVELS = 4;

export interface TreeLineEnv {
    readonly facts: TreeFacts;
    readonly search: SpanSearch;
    /** The guides-and-name column, already clamped by the layout. */
    readonly nameColumn: number;
}

const railCells = (rails: Rails | undefined, levels: number): string => {
    let text = "";
    let rail = rails;
    for (let i = 0; i < levels && rail !== undefined; i++) {
        text = `${rail.more ? "│ " : "  "}${text}`;
        rail = rail.up;
    }
    return text;
};

/** `│ ` or `  ` per ancestor level and `├ ` or `└ ` for the row's own; past 4 levels `⋯<depth> ` and the innermost 4. */
export const guides = (entry: TreeEntry): string => {
    if (entry._tag === "Missing" || entry.depth === 0) {
        return "";
    }
    const own = entry.last ? "└ " : "├ ";
    if (entry.depth <= SHOWN_LEVELS) {
        return `${railCells(entry.rails, entry.depth - 1)}${own}`;
    }
    return `⋯${entry.depth} ${railCells(entry.rails, SHOWN_LEVELS - 1)}${own}`;
};

const foldMark = (fold: Fold): string => (fold === "open" ? "▾" : fold === "folded" ? "▸" : " ");

const glyphs = {
    origin: chunk("✗ ", "failure"),
    propagated: chunk("✗ ", "failurePropagated"),
    interrupted: chunk("⊘ ", "interrupted"),
    ok: chunk("  ", "text"),
} satisfies Readonly<Record<SpanKind, Chunk>>;

const blank = (width: number): Chunk => chunk(" ".repeat(Math.max(0, width)), "text");

/** `text` in `role`, with its `highlights` on the match background. */
const highlighted = (text: string, role: Role, highlights: Ranges): Line => {
    const parts: Array<Chunk> = [];
    let at = 0;
    for (const [start, end] of highlights) {
        if (start > at) {
            parts[parts.length] = chunk(text.slice(at, start), role);
        }
        parts[parts.length] = { text: text.slice(start, end), role, bg: "matchBg" };
        at = end;
    }
    if (at < text.length) {
        parts[parts.length] = chunk(text.slice(at), role);
    }
    return parts;
};

/** The label cut to `room` cells, ending in `…` when it did not fit. */
const fitLabel = (label: Line, room: number): Line => {
    const total = Arr.reduce(label, 0, (sum, part) => sum + cells(part.text));
    if (total <= room) {
        return label;
    }
    const parts: Array<Chunk> = [];
    let left = room - 1;
    for (const part of label) {
        if (left <= 0) {
            break;
        }
        parts[parts.length] = { ...part, text: part.text.slice(0, left) };
        left -= cells(part.text);
    }
    return room <= 0 ? [] : [...parts, chunk("…", "muted")];
};

/** Guides, fold mark and label filling the name column, with ` · 3 matches` kept in view when matches hide. */
const nameCells = (guide: string, mark: string, label: Line, hidden: number, width: number): Line => {
    const suffix = hidden > 0 ? [chunk(hiddenText(hidden), "accent")] : [];
    const room = Math.max(0, width - cells(guide) - cells(mark) - 1 - (hidden > 0 ? cells(hiddenText(hidden)) : 0));
    const fitted = fitLabel(label, room);
    const shown = [chunk(guide, "faint"), chunk(`${mark} `, "muted"), ...fitted, ...suffix];
    return [...shown, blank(width - Arr.reduce(shown, 0, (sum, part) => sum + cells(part.text)))];
};

const durationCells = (text: string): Chunk => chunk(`${text.padStart(DURATION)} `, "text");

/** Gutter · exit glyph · guides, fold mark and name (`nameColumn` cells) · duration (8, right-aligned) · a space. */
export const treeLeft = (entry: TreeEntry, env: TreeLineEnv, selected: boolean): Line => {
    const { facts, search, nameColumn } = env;
    const line = ((): Line => {
        switch (entry._tag) {
            case "Span": {
                const span = facts.trace.spans.get(entry.spanId);
                const name = span?.name ?? entry.spanId;
                const kind = facts.kind(entry.spanId);
                const matched = search.matches(entry.spanId);
                const hidden = entry.fold === "folded" ? search.below(entry.spanId) : 0;
                return [
                    matched ? chunk("▌", "accent") : blank(GUTTER),
                    glyphs[kind],
                    ...nameCells(
                        guides(entry),
                        foldMark(entry.fold),
                        highlighted(
                            name,
                            kind === "origin" ? "failure" : "text",
                            search.active ? ranges(search.query, name) : [],
                        ),
                        hidden,
                        nameColumn,
                    ),
                    durationCells(span === undefined ? "" : duration(span.ms)),
                ];
            }
            case "Group": {
                const { group } = entry;
                const problems = [
                    ...(group.failed > 0 ? [chunk(` · ${count(group.failed)} failed`, "failure")] : []),
                    ...(group.interrupted > 0
                        ? [chunk(` · ${count(group.interrupted)} interrupted`, "interrupted")]
                        : []),
                ];
                const hidden = entry.open ? 0 : search.hiddenIn(group, entry.shown);
                return [
                    blank(GUTTER + GLYPH),
                    ...nameCells(
                        guides(entry),
                        entry.open ? "▾" : "▸",
                        [
                            ...highlighted(group.name, "text", search.active ? ranges(search.query, group.name) : []),
                            chunk(` ×${count(group.members.length)}`, "muted"),
                            ...problems,
                        ],
                        hidden,
                        nameColumn,
                    ),
                    durationCells(duration(group.endMs - group.startMs)),
                ];
            }
            case "Missing":
                return [
                    blank(GUTTER + GLYPH),
                    ...nameCells(
                        "",
                        foldMark(entry.fold),
                        [chunk(`⋯ missing parent ${shortId(entry.parentId)}…`, "muted")],
                        entry.fold === "folded" ? search.belowMissing(entry.parentId) : 0,
                        nameColumn,
                    ),
                    durationCells(""),
                ];
        }
    })();
    return selected ? underlay(line, "selectionBg") : line;
};

/**
 * What a click at `column` (from the row's left) hits: anywhere on a group row, or a row's fold mark, toggles it;
 * anything else selects the row.
 */
export const hitOf = (entry: TreeEntry, column: number): "mark" | "row" => {
    if (entry._tag === "Group") {
        return "mark";
    }
    if (entry._tag === "Span" && entry.fold === "leaf") {
        return "row";
    }
    const mark = GUTTER + GLYPH + cells(guides(entry));
    return column === mark ? "mark" : "row";
};
