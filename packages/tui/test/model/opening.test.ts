import { describe, expect, it } from "@effect/vitest";
import { HashSet, Option } from "effect";

import { openingFor } from "../../src/model/opening.ts";
import { TreeRow } from "../../src/nav/Screen.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const span = (id: string, parent: string | null, startMs: number, over: Partial<JsonlSpanRecord> = {}) =>
    record({ span: id, parent, name: id, startMs, ...over });

const traceOf = (records: ReadonlyArray<JsonlSpanRecord>) => indexed(records).traces.get("trace-1")!;

const tree = traceOf([
    span("root", null, 1000, { exit: "Failure" }),
    span("auth", "root", 1001),
    span("pay", "root", 1002, { exit: "Failure", attrs: { "card.brand": "visa" } }),
    span("charge", "pay", 1003, { exit: "Failure" }),
    span("stop", "root", 1004, { exit: "Interrupted" }),
]);

describe("openingFor", () => {
    it("opens on the first span matching every term of the seeded search", () => {
        expect(openingFor(tree, "visa").selected).toEqual(Option.some(TreeRow.Span({ spanId: "pay" })));
    });

    it("falls through when no single span matches every term", () => {
        const opening = openingFor(tree, "visa is:interrupted");
        expect(opening.selected, "the failure origin").toEqual(Option.some(TreeRow.Span({ spanId: "charge" })));
    });

    it("opens on the failure origin, not a span the failure only passed through", () => {
        expect(openingFor(tree, "").selected).toEqual(Option.some(TreeRow.Span({ spanId: "charge" })));
    });

    it("opens on the first interrupted span, then the root", () => {
        const interrupted = traceOf([span("root", null, 1000), span("a", "root", 1001, { exit: "Interrupted" })]);
        expect(openingFor(interrupted, "").selected).toEqual(Option.some(TreeRow.Span({ spanId: "a" })));
        const clean = traceOf([span("root", null, 1000), span("a", "root", 1001)]);
        expect(openingFor(clean, "").selected).toEqual(Option.some(TreeRow.Span({ spanId: "root" })));
    });

    it("has no opening selection for a trace without a row", () => {
        expect(openingFor(traceOf([span("loop", "loop", 1000)]), "").selected).toEqual(Option.none());
    });

    it("opens a partial trace on its missing-parent row", () => {
        const partial = traceOf([span("lost", "absent", 1001)]);
        expect(openingFor(partial, "").selected).toEqual(Option.some(TreeRow.Missing({ parentId: "absent" })));
    });

    describe("same-name groups", () => {
        const rows = Array.from({ length: 20 }, (_, i) =>
            span(`row${i}`, "import", 1002 + i, {
                name: "import.row",
                exit: i === 7 ? "Failure" : "Success",
                attrs: { "row.index": i },
            }),
        );
        const batches = Array.from({ length: 20 }, (_, i) =>
            span(`batch${i}`, "root", 1001 + i, { name: "batch", exit: i === 3 ? "Failure" : "Success" }),
        );
        const importing = span("import", "batch3", 1001.5, { exit: "Failure" });
        const grouped = traceOf([span("root", null, 1000), ...batches, importing, ...rows]);

        it("opens the groups that would hide a seeded search's span or its ancestors, and no other", () => {
            const opening = openingFor(grouped, "row.index=12");
            expect(opening.selected).toEqual(Option.some(TreeRow.Span({ spanId: "row12" })));
            expect(opening.openGroups, "the failed batch3 shows under its closed group").toEqual(
                HashSet.make("import|import.row"),
            );
        });

        it("leaves groups closed for a failure, whose failed lineage a closed group shows anyway", () => {
            const opening = openingFor(grouped, "");
            expect(opening.selected).toEqual(Option.some(TreeRow.Span({ spanId: "row7" })));
            expect(opening.openGroups).toEqual(HashSet.empty());
        });
    });
});
