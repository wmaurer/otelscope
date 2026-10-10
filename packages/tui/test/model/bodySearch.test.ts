import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { detect, docOf } from "../../src/model/bodyDoc.ts";
import { matchesIn, matchesOf, matchText } from "../../src/model/bodySearch.ts";

const textDoc = (text: string) => docOf(text, Option.none(), false);

describe("matchesOf", () => {
    it("ignores case for a lowercase search and respects it once the search holds a capital", () => {
        const doc = textDoc("Error error ERROR");
        expect(matchesOf(doc, "error").starts).toEqual([0, 6, 12]);
        expect(matchesOf(doc, "Error").starts).toEqual([0]);
    });

    it("counts matches without overlaps", () => {
        expect(matchesOf(textDoc("aaaaa"), "aa").starts).toEqual([0, 2]);
    });

    it("matches spaces as part of the substring", () => {
        expect(matchesOf(textDoc("a b ab a  b"), "a b").starts).toEqual([0]);
    });

    it("finds nothing for an empty search", () => {
        expect(matchesOf(textDoc("abc"), "").starts).toEqual([]);
    });

    it("searches the text as shown: the formatted JSON, or the raw text", () => {
        const text = '{"a":"b"}';
        expect(matchesOf(docOf(text, detect(text), false), '"a": "b"').starts).toEqual([4]);
        expect(matchesOf(docOf(text, detect(text), true), '"a": "b"').starts).toEqual([]);
    });

    it("keeps offsets in the shown text when a character folds to another length", () => {
        expect(matchesOf(textDoc("İx ix"), "x").starts).toEqual([1, 4]);
    });
});

describe("matchesIn", () => {
    it("lists the matches overlapping a range, one that starts before it included", () => {
        const matches = matchesOf(textDoc("abc abc abc"), "abc");
        expect(matchesIn(matches, 2, 5)).toEqual([0, 4]);
        expect(matchesIn(matches, 3, 4)).toEqual([]);
    });
});

describe("matchText", () => {
    const matches = matchesOf(textDoc("x x x"), "x");

    it("numbers the current match", () => {
        expect(matchText(matches, Option.some(2))).toBe("match 2/3");
    });

    it("counts the matches when no match starts at the current offset", () => {
        expect(matchText(matches, Option.none())).toBe("3 matches");
        expect(matchText(matches, Option.some(1))).toBe("3 matches");
        expect(matchText(matchesOf(textDoc("x"), "x"), Option.none())).toBe("1 match");
        expect(matchText(matchesOf(textDoc("x"), "y"), Option.none())).toBe("no matches");
    });
});
