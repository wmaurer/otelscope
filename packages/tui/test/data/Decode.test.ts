import { describe, expect, it } from "@effect/vitest";

import { Classified, classify } from "../../src/data/Decode.ts";
import { record } from "../support/records.ts";

describe("classify", () => {
    it("decodes a 0.3 record and drops unknown keys", () => {
        const span = record({ span: "a1" });
        expect(classify(JSON.stringify({ ...span, futureField: 1 }))).toEqual(Classified.Span({ record: span }));
    });

    it("reports a line that is not JSON as malformed, with the parse error", () => {
        const result = classify("{not json");
        expect(result._tag).toBe("Malformed");
        expect(result._tag === "Malformed" && result.issue).toMatch(/JSON/u);
    });

    it("reads a 0.2.x line, with run, trace and span but no startMs, as legacy", () => {
        expect(classify(JSON.stringify({ run: "r", trace: "t", span: "s", start: "2026-01-01T00:00:00Z" }))).toEqual(
            Classified.Legacy(),
        );
    });

    it("reports a record that fails the Schema as malformed, with the issue on one line", () => {
        expect(classify(JSON.stringify({ ...record({ span: "a1" }), exit: "Exploded" }))).toEqual(
            Classified.Malformed({ issue: 'Expected "Success" | "Failure" | "Interrupted" at ["exit"]' }),
        );
    });

    it("reports a legacy-looking line with a startMs key as malformed, not legacy", () => {
        expect(classify(JSON.stringify({ run: "r", trace: "t", span: "s", startMs: "soon" }))._tag).toBe("Malformed");
    });

    it("reports JSON that is not an object as malformed", () => {
        expect(classify("42")._tag).toBe("Malformed");
    });
});
