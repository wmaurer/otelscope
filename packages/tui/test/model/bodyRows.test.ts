import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { detect, docOf } from "../../src/model/bodyDoc.ts";
import { clampedView, rowLine, rowsOf } from "../../src/model/bodyRows.ts";
import { matchesOf } from "../../src/model/bodySearch.ts";
import { defaultBodyView } from "../../src/nav/Screen.ts";

import type { BodyDoc } from "../../src/model/bodyDoc.ts";
import type { BodyRows } from "../../src/model/bodyRows.ts";

const textDoc = (text: string): BodyDoc => docOf(text, Option.none(), false);

const shown = (doc: BodyDoc, rows: BodyRows): ReadonlyArray<string> =>
    Arr.makeBy(rows.count, (i) => doc.text.slice(rows.start[i], rows.end[i]));

const wrapped = (text: string, width: number) => {
    const doc = textDoc(text);
    return shown(doc, rowsOf(doc, width, true));
};

describe("rowsOf", () => {
    it("breaks at the last space that fits and drops that space", () => {
        expect(wrapped("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
        expect(wrapped("aaaa bbbb", 4), "a space just past the width").toEqual(["aaaa", "bbbb"]);
    });

    it("breaks a word longer than the width hard", () => {
        expect(wrapped("abcdefghij xy", 4)).toEqual(["abcd", "efgh", "ij", "xy"]);
    });

    it("never makes a row wider than the width", () => {
        const doc = textDoc("lorem ipsum dolor sit amet, consectetur   adipiscing elit, sed do eiusmod tempor");
        const rows = rowsOf(doc, 7, true);
        expect(
            Arr.every(
                Arr.makeBy(rows.count, (i) => (rows.end[i] ?? 0) - (rows.start[i] ?? 0)),
                (n) => n <= 7,
            ),
        ).toBe(true);
    });

    it("keeps an empty line as one row and adds none for a trailing space", () => {
        expect(wrapped("ab\n\ncd", 10)).toEqual(["ab", "", "cd"]);
        expect(wrapped("abcd \nef", 4)).toEqual(["abcd", "ef"]);
    });

    it("keeps one row per line with wrapping off, and the widest line for sideways scrolling", () => {
        const doc = textDoc("short\na much longer line\nmid");
        const rows = rowsOf(doc, 5, false);
        expect(shown(doc, rows)).toEqual(["short", "a much longer line", "mid"]);
        expect(rows.widest).toBe(18);
    });

    it("finds the row holding an offset, the line's \\n and a dropped space included", () => {
        const doc = textDoc("the quick brown\nfox");
        const rows = rowsOf(doc, 10, true);
        expect(shown(doc, rows)).toEqual(["the quick", "brown", "fox"]);
        expect(rows.rowAt(0)).toBe(0);
        expect(rows.rowAt(9), "the dropped space").toBe(0);
        expect(rows.rowAt(10)).toBe(1);
        expect(rows.rowAt(15), "the \\n").toBe(1);
        expect(rows.rowAt(16)).toBe(2);
    });

    it("returns the same rows for the same doc, width and wrap", () => {
        const doc = textDoc("one two three");
        expect(rowsOf(doc, 5, true)).toBe(rowsOf(doc, 5, true));
        expect(rowsOf(doc, 5, false), "the width does not matter without wrapping").toBe(rowsOf(doc, 9, false));
        expect(rowsOf(doc, 5, true)).not.toBe(rowsOf(doc, 6, true));
    });
});

describe("clampedView", () => {
    it("clamps a top line and left column stored before a resize", () => {
        const rows = rowsOf(textDoc("a\nb\nc\nd\nwide line here"), 80, false);
        const view = { ...defaultBodyView, wrap: false, topLine: 40, leftCol: 99 };
        expect(clampedView(view, rows, 3, 10)).toEqual({ top: 2, left: 4, maxTop: 2, maxLeft: 4 });
        expect(clampedView({ ...view, wrap: true }, rows, 3, 10).left, "no sideways scroll with wrapping on").toBe(0);
    });
});

describe("rowLine", () => {
    const window = { left: 0, width: 80 };

    it("colours a JSON row by its runs", () => {
        const text = '{"n":1}';
        const doc = docOf(text, detect(text), false);
        const rows = rowsOf(doc, 80, true);
        const none = matchesOf(doc, "");
        expect(rowLine(doc, rows, none, Option.none(), 1, window)).toEqual([
            { text: "  ", role: "text" },
            { text: '"n"', role: "jsonKey" },
            { text: ": ", role: "text" },
            { text: "1", role: "jsonNumber" },
        ]);
    });

    it("highlights a match crossing a wrapped row on both rows, the current one marked", () => {
        const doc = textDoc("aaaaefgbbbbbbbbbefgc");
        const rows = rowsOf(doc, 5, true);
        expect(shown(doc, rows)).toEqual(["aaaae", "fgbbb", "bbbbb", "befgc"]);
        const matches = matchesOf(doc, "efg");
        expect(matches.starts).toEqual([4, 16]);
        const current = Option.some(16);
        expect(rowLine(doc, rows, matches, current, 0, window)).toEqual([
            { text: "aaaa", role: "text" },
            { text: "e", role: "text", bg: "matchBg" },
        ]);
        expect(rowLine(doc, rows, matches, current, 1, window)).toEqual([
            { text: "fg", role: "text", bg: "matchBg" },
            { text: "bbb", role: "text" },
        ]);
        expect(rowLine(doc, rows, matches, current, 2, window)).toEqual([{ text: "bbbbb", role: "text" }]);
        expect(rowLine(doc, rows, matches, current, 3, window)).toEqual([
            { text: "b", role: "text" },
            { text: "efg", role: "text", bg: "currentMatchBg" },
            { text: "c", role: "text" },
        ]);
    });

    it("splits a coloured run at a match's edges", () => {
        const text = '{"key":"some value"}';
        const doc = docOf(text, detect(text), false);
        const rows = rowsOf(doc, 80, true);
        expect(rowLine(doc, rows, matchesOf(doc, "me va"), Option.none(), 1, window)).toEqual([
            { text: "  ", role: "text" },
            { text: '"key"', role: "jsonKey" },
            { text: ": ", role: "text" },
            { text: '"so', role: "jsonString" },
            { text: "me va", role: "jsonString", bg: "matchBg" },
            { text: 'lue"', role: "jsonString" },
        ]);
    });

    it("shows the columns from `left` with wrapping off", () => {
        const doc = textDoc("0123456789abcdef");
        const rows = rowsOf(doc, 4, false);
        expect(rowLine(doc, rows, matchesOf(doc, ""), Option.none(), 0, { left: 8, width: 4 })).toEqual([
            { text: "89ab", role: "text" },
        ]);
    });

    it("draws a tab as a space and other control characters as ·, one cell each", () => {
        const doc = textDoc("a\tb\u0007c\r");
        const line = rowLine(doc, rowsOf(doc, 80, true), matchesOf(doc, ""), Option.none(), 0, window);
        expect(line).toEqual([{ text: "a b·c·", role: "text" }]);
        expect(doc.text, "search and copy keep the text").toBe("a\tb\u0007c\r");
    });
});
