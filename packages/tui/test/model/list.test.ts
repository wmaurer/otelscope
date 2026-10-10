import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { indexer, newRowCount, newRowsText, newestStart, selectedIndex } from "../../src/model/list.ts";

import type { List } from "../../src/model/list.ts";

const keys = ["a", "b", "c", "d"];

const list = (over: Partial<List<{ readonly key: string }, string>> = {}): List<{ readonly key: string }, string> => {
    const rows = Arr.map(keys, (key) => ({ key }));
    return {
        rows,
        selectionOf: (row) => row.key,
        keyOf: (value) => value,
        indexOf: indexer(rows),
        stops: [],
        followIndex: 3,
        timeSort: true,
        newestEnd: "end",
        starts: [10, 20, 30, 40],
        filter: "",
        query: [],
        matched: 4,
        total: 4,
        ...over,
    };
};

const at = (selected: Option.Option<string>, newerThan: Option.Option<number> = Option.none()) => ({
    selected,
    newerThan,
});

describe("selectedIndex", () => {
    it("puts a following list on its follow row, and any other sort on the first row", () => {
        expect(selectedIndex(list(), at(Option.none()))).toBe(3);
        expect(selectedIndex(list({ timeSort: false }), at(Option.none()))).toBe(0);
    });

    it("finds a stored key, and shows the first row for a missing one", () => {
        expect(selectedIndex(list(), at(Option.some("c")))).toBe(2);
        expect(selectedIndex(list(), at(Option.some("gone")))).toBe(0);
    });

    it("is -1 on an empty list", () => {
        expect(selectedIndex(list({ rows: [], followIndex: -1 }), at(Option.none()))).toBe(-1);
    });
});

describe("new rows", () => {
    it("counts starts after newerThan once following stopped, under a time sort only", () => {
        expect(newRowCount(list(), at(Option.some("a"), Option.some(20)))).toBe(2);
        expect(newRowCount(list(), at(Option.some("a"), Option.some(40)))).toBe(0);
        expect(newRowCount(list(), at(Option.none(), Option.some(20))), "following").toBe(0);
        expect(newRowCount(list({ timeSort: false }), at(Option.some("a"), Option.some(20)))).toBe(0);
    });

    it("points the arrow at the newest end", () => {
        expect(newRowsText(list(), at(Option.some("a"), Option.some(10)))).toEqual(Option.some("↓ 3 new"));
        expect(newRowsText(list({ newestEnd: "start" }), at(Option.some("a"), Option.some(10)))).toEqual(
            Option.some("↑ 3 new"),
        );
        expect(newRowsText(list(), at(Option.some("a"), Option.some(40)))).toEqual(Option.none());
    });

    it("takes the newest start for newerThan", () => {
        expect(newestStart(list())).toEqual(Option.some(40));
        expect(newestStart(list({ starts: [] }))).toEqual(Option.none());
    });
});
