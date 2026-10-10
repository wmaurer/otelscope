import { describe, expect, it } from "@effect/vitest";

import { inputBar } from "../../src/model/statusBar.ts";
import { lineText } from "../../src/model/text.ts";

describe("inputBar", () => {
    it("draws the cursor in the text and the count on the right", () => {
        const text = lineText(inputBar("payment declined", 7, "12 of 3000 traces", 50));
        expect(text).toMatch(/^\/ payment▏ declined +12 of 3000 traces$/);
        expect(text.length).toBe(50);
    });

    it("drops the count before it cuts the text", () => {
        expect(lineText(inputBar("payment declined", 16, "12 of 3000 traces", 25))).toBe("/ payment declined▏      ");
    });

    it("scrolls a long text to keep the cursor in view, marking the cut ends", () => {
        const end = lineText(inputBar("abcdefghijklmnopqrstuvwxyz", 26, "", 12));
        expect(end).toBe("/ …stuvwxyz▏");
        const start = lineText(inputBar("abcdefghijklmnopqrstuvwxyz", 0, "", 12));
        expect(start).toBe("/ ▏abcdefgh…");
    });
});
