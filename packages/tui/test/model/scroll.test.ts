import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { deriveScroll, initialScroll, visibleOffset, wheeled } from "../../src/model/scroll.ts";

import type { Scroll } from "../../src/model/scroll.ts";

const frame = (selectedIndex: number, selectedKey: string, count = 100, viewport = 10) => ({
    count,
    viewport,
    selectedIndex,
    selectedKey,
});

const at = (offset: number, key: string, index: number): Scroll => ({ offset, key, index });

describe("deriveScroll", () => {
    it("starts with the selection in view with context", () => {
        expect(deriveScroll(initialScroll, frame(0, "r0")).offset).toBe(0);
        expect(deriveScroll(initialScroll, frame(50, "r50")).offset).toBe(43);
        expect(deriveScroll(initialScroll, frame(99, "r99")).offset, "the bottom of a following list").toBe(90);
    });

    it("does not scroll for a move inside the margin, and scrolls by one at it", () => {
        expect(deriveScroll(at(0, "r5", 5), frame(6, "r6")).offset).toBe(0);
        expect(deriveScroll(at(0, "r7", 7), frame(8, "r8")).offset).toBe(1);
        expect(deriveScroll(at(10, "r12", 12), frame(11, "r11")).offset).toBe(9);
    });

    it("keeps the selected row on its screen line when rows are inserted above it", () => {
        const next = deriveScroll(at(10, "r15", 15), frame(18, "r15"));
        expect(next.offset - 10).toBe(3);
        expect(next.index - next.offset).toBe(15 - 10);
    });

    it("keeps the top of a list pinned when the newest row is the selection at index 0", () => {
        expect(deriveScroll(at(0, "newest", 0), frame(0, "newer")).offset).toBe(0);
    });

    it("never scrolls a list shorter than the viewport", () => {
        expect(deriveScroll(at(0, "a", 0), frame(4, "e", 5, 10)).offset).toBe(0);
    });

    it("is the initial state for an empty list", () => {
        expect(deriveScroll(at(5, "a", 7), frame(-1, "", 0))).toEqual(initialScroll);
    });
});

describe("the wheel", () => {
    it("overrides the derived offset until the selection changes, clamped to the list", () => {
        const derived = at(20, "r25", 25);
        const wheel = wheeled(20, derived, 3, 100, 10);
        expect(visibleOffset(derived, Option.some(wheel))).toBe(23);
        expect(visibleOffset(at(21, "r26", 26), Option.some(wheel)), "a key move snaps back").toBe(21);
        expect(wheeled(95, derived, 3, 100, 10).offset).toBe(90);
        expect(wheeled(1, derived, -3, 100, 10).offset).toBe(0);
    });
});
