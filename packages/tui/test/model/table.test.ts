import { describe, expect, it } from "@effect/vitest";
import { Array as Arr } from "effect";

import { runLayout } from "../../src/model/runList.ts";
import { cell, countText, header, row } from "../../src/model/table.ts";
import { lineText } from "../../src/model/text.ts";
import { traceLayout } from "../../src/model/traceLine.ts";

import type { Line } from "../../src/model/Role.ts";

const matchedText = (line: Line) =>
    Arr.map(
        Arr.filter(line, (c) => c.bg === "matchBg"),
        (c) => c.text,
    );
const ids = (placed: ReadonlyArray<{ readonly id: string }>) => Arr.map(placed, (column) => column.id);
const total = (placed: ReadonlyArray<{ readonly width: number }>) =>
    1 + Arr.reduce(placed, 0, (sum, column) => sum + column.width) + placed.length - 1;

describe("layout", () => {
    it("shows every Runs column at 120 and drops only the run id at 80", () => {
        expect(ids(runLayout(120))).toContain("run");
        expect(ids(runLayout(80))).toEqual([
            "marks",
            "service",
            "started",
            "duration",
            "traces",
            "failed",
            "spans",
            "logs",
        ]);
        expect(ids(runLayout(60))).not.toContain("logs");
        expect(total(runLayout(120))).toBe(120);
        expect(total(runLayout(80))).toBe(80);
    });

    it("drops the Traces logs column first, then spans, only as far as the flexible columns need", () => {
        expect(ids(traceLayout(120))).toContain("logs");
        expect(ids(traceLayout(85))).toEqual(["marks", "root", "started", "duration", "spans", "failed", "error"]);
        expect(ids(traceLayout(80))).toEqual(["marks", "root", "started", "duration", "failed", "error"]);
        expect(total(traceLayout(120))).toBe(120);
        expect(total(traceLayout(80))).toBe(80);
    });
});

describe("cells and rows", () => {
    it("aligns, cuts with …, and paints matched text on matchBg", () => {
        expect(lineText(cell("12", 5, "right", "text"))).toBe("   12");
        expect(lineText(cell("shop-api", 5, "left", "text"))).toBe("shop…");
        const matched = cell("shop-api", 10, "left", "text", [[5, 8]]);
        expect(matchedText(matched)).toEqual(["api"]);
        const cutMatch = cell("shop-api", 6, "left", "text", [[3, 8]]);
        expect(matchedText(cutMatch), "never the …").toEqual(["p-"]);
    });

    it("keeps matchBg under the selection background and fills the row to the width", () => {
        const line = row([cell("api", 3, "left", "text", [[0, 3]])], 10, true);
        expect(lineText(line)).toBe(" api      ");
        expect(Arr.map(line, (c) => c.bg)).toEqual(["selectionBg", "matchBg", "selectionBg", "selectionBg"]);
    });

    it("marks the sorted column, ▴ when reversed", () => {
        expect(lineText(header(runLayout(120), "started", false, 120))).toContain("started ▾");
        expect(lineText(header(runLayout(120), "started", true, 120))).toContain("started ▴");
    });

    it("leaves zero counts blank and groups thousands", () => {
        expect(countText(0)).toBe("");
        expect(countText(12480)).toBe("12,480");
    });
});
