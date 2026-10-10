import { Array as Arr } from "effect";

import type { Ranges } from "../query/Highlight.ts";

export type Role =
    | "text"
    | "muted"
    | "faint"
    | "accent"
    | "focusBorder"
    | "selectionBg"
    | "matchBg"
    | "bar"
    | "failure"
    | "failurePropagated"
    | "interrupted"
    | "live"
    | "warning"
    | "logTrace"
    | "logDebug"
    | "logInfo"
    | "logWarn"
    | "logError"
    | "logFatal"
    | "jsonKey"
    | "jsonString"
    | "jsonNumber"
    | "jsonLiteral"
    | "overlayBg";

export interface Chunk {
    readonly text: string;
    readonly role: Role;
    readonly bold?: boolean;
    readonly bg?: Role;
}

export type Line = ReadonlyArray<Chunk>;

export const chunk = (text: string, role: Role, bold = false): Chunk => (bold ? { text, role, bold } : { text, role });

/** A section heading: the text in bold. */
export const heading = (text: string): Line => [chunk(text, "text", true)];

/** `text` in `role`, with its `highlights` on the match background. */
export const highlighted = (text: string, role: Role, highlights: Ranges, bold = false): Line => {
    const parts: Array<Chunk> = [];
    let at = 0;
    for (const [start, end] of highlights) {
        if (start > at) {
            parts[parts.length] = chunk(text.slice(at, start), role, bold);
        }
        parts[parts.length] = { ...chunk(text.slice(start, end), role, bold), bg: "matchBg" };
        at = end;
    }
    if (at < text.length) {
        parts[parts.length] = chunk(text.slice(at), role, bold);
    }
    return parts;
};

export const underlay = (line: Line, bg: Role): Line =>
    Arr.map(line, (part) => (part.bg === undefined ? { ...part, bg } : part));
