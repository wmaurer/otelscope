import { describe, expect, it } from "@effect/vitest";
import { Array as Arr } from "effect";

import { clip, ranges, shift } from "../../src/query/Highlight.ts";
import { has } from "../../src/query/Match.ts";
import { needle, parse } from "../../src/query/Query.ts";

describe("ranges", () => {
    it("finds every occurrence and merges overlapping and touching ones", () => {
        expect(ranges(parse("ab"), "xabyab")).toEqual([
            [1, 3],
            [4, 6],
        ]);
        expect(ranges(parse("aa"), "aaa"), "overlapping occurrences").toEqual([[0, 3]]);
        expect(ranges(parse("ab bc"), "abc"), "two terms overlapping").toEqual([[0, 3]]);
        expect(ranges(parse("a b"), "ab"), "touching").toEqual([[0, 2]]);
    });

    it("applies smart case", () => {
        expect(ranges(parse("post"), "POST /orders")).toEqual([[0, 4]]);
        expect(ranges(parse("Post"), "POST /orders")).toEqual([]);
    });

    it("highlights every match the search finds, folding case as the search does", () => {
        const cases = [
            ["status", "ſtatus"],
            ["μs", "took 12 µs"],
            ["σοφίας", "ΣΟΦΊΑΣ"],
        ] as const;
        for (const [term, text] of cases) {
            expect(has(text, needle(term)), `${term} matches ${text}`).toBe(true);
        }
        expect(Arr.map(cases, ([term, text]) => ranges(parse(term), text))).toEqual([[[0, 6]], [[8, 10]], [[0, 6]]]);
    });

    it("keeps indices where lowercasing changes a character's length", () => {
        expect(ranges(parse("stan"), "İstanbul")).toEqual([[1, 5]]);
    });

    it("never highlights key=value or is: terms", () => {
        expect(ranges(parse("route=orders is:failed"), "route=orders is:failed")).toEqual([]);
    });
});

describe("clip and shift", () => {
    it("keeps only the part of each range inside the kept characters", () => {
        expect(
            clip(
                [
                    [0, 2],
                    [4, 9],
                    [10, 12],
                ],
                6,
            ),
        ).toEqual([
            [0, 2],
            [4, 6],
        ]);
    });

    it("moves ranges right", () => {
        expect(shift([[1, 2]], 2)).toEqual([[3, 4]]);
    });
});
