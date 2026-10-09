import { describe, expect, it } from "@effect/vitest";

import { splitLines } from "../../src/data/Lines.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const none = new Uint8Array(0);

describe("splitLines", () => {
    it("splits complete lines with their byte offsets and holds back the rest", () => {
        expect(splitLines(none, bytes("ab\nü\ncd"), 100, 7)).toEqual({
            lines: ["ab", "ü"],
            offsets: [100, 103],
            firstLine: 7,
            pending: bytes("cd"),
            nextLine: 9,
        });
    });

    it("keeps an empty line as an empty string, so line numbers stay exact", () => {
        const split = splitLines(none, bytes("a\n\nb\n"), 0, 1);
        expect(split.lines).toEqual(["a", "", "b"]);
        expect(split.offsets).toEqual([0, 2, 3]);
        expect(split.nextLine).toBe(4);
    });

    it("completes a pending line from the next chunk, at the pending line's offset", () => {
        const first = splitLines(none, bytes("one\ntw"), 0, 1);
        const second = splitLines(first.pending, bytes("o\n"), 4, first.nextLine);
        expect(second).toEqual({ lines: ["two"], offsets: [4], firstLine: 2, pending: none, nextLine: 3 });
    });

    it("decodes a multi-byte character cut between two chunks once its line is complete", () => {
        const euro = bytes("€\n");
        const first = splitLines(none, euro.subarray(0, 2), 0, 1);
        expect(first.lines).toEqual([]);
        expect(first.pending).toEqual(euro.subarray(0, 2));
        const second = splitLines(first.pending, euro.subarray(2), 0, first.nextLine);
        expect(second.lines).toEqual(["€"]);
    });

    it("returns no lines for a chunk without a newline", () => {
        expect(splitLines(none, bytes("partial"), 0, 1)).toEqual({
            lines: [],
            offsets: [],
            firstLine: 1,
            pending: bytes("partial"),
            nextLine: 1,
        });
    });
});
