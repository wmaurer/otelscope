import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { edit, HISTORY_MAX, insert, recall, remember } from "../../src/keys/Input.ts";

const line = (text: string, cursor = text.length) => ({ text, cursor });

describe("edit", () => {
    it("moves the cursor within the line, and is a no-op at the ends", () => {
        const start = line("abc", 0);
        expect(edit(start, "left")).toBe(start);
        expect(edit(line("abc"), "right")).toEqual(line("abc"));
        expect(edit(line("abc", 1), "home")).toEqual(line("abc", 0));
        expect(edit(line("abc", 1), "end")).toEqual(line("abc", 3));
    });

    it("deletes a character, a word with the spaces before it, and everything before the cursor", () => {
        expect(edit(line("abc", 2), "backspace")).toEqual(line("ac", 1));
        expect(edit(line("abc", 0), "backspace")).toEqual(line("abc", 0));
        expect(edit(line("card  declined  "), "deleteWord")).toEqual(line("card  ", 6));
        expect(edit(line("one two", 5), "deleteToStart")).toEqual(line("wo", 0));
    });

    it("inserts at the cursor", () => {
        expect(insert(line("ad", 1), "bc")).toEqual(line("abcd", 3));
    });
});

describe("history", () => {
    it("puts the newest first, collapses duplicates, skips empty queries and caps its length", () => {
        expect(remember(["a", "b"], "b")).toEqual(["b", "a"]);
        expect(remember(["a"], "")).toEqual(["a"]);
        const full = Arr.makeBy(HISTORY_MAX, (i) => `q${i}`);
        expect(remember(full, "new").length).toBe(HISTORY_MAX);
    });

    it("recalls older then newer entries and ends recall past the newest", () => {
        const history = ["pay", "shop"];
        const first = recall(history, "typed", Option.none(), "older");
        expect(first).toEqual({ text: "pay", recall: Option.some({ index: 0, typed: "typed" }) });
        const newer = recall(history, first.text, first.recall, "newer");
        expect(newer).toEqual({ text: "typed", recall: Option.none() });
        expect(recall(history, "typed", Option.none(), "newer")).toEqual({ text: "typed", recall: Option.none() });
        expect(recall([], "typed", Option.none(), "older").text).toBe("typed");
    });
});
