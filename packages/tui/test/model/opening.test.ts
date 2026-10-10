import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, HashSet } from "effect";

import { openingFor, treeOrder } from "../../src/model/opening.ts";
import { TreeRow } from "../../src/nav/Screen.ts";
import { parse } from "../../src/query/Query.ts";
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

describe("treeOrder", () => {
    it("walks depth first from the top, children by start, then the orphan groups", () => {
        expect(Arr.fromIterable(treeOrder(tree))).toEqual(["root", "auth", "pay", "charge", "stop"]);
        const orphans = traceOf([span("top", null, 1000), span("lost", "absent", 1001), span("under", "lost", 1002)]);
        expect(Arr.fromIterable(treeOrder(orphans))).toEqual(["top", "lost", "under"]);
    });
});

describe("openingFor", () => {
    it("opens on the first span matching every term of the seeded search", () => {
        expect(openingFor(tree, parse("visa")).selected).toEqual(TreeRow.Span({ spanId: "pay" }));
    });

    it("falls through when no single span matches every term", () => {
        const opening = openingFor(tree, parse("visa is:interrupted"));
        expect(opening.selected, "the failure origin").toEqual(TreeRow.Span({ spanId: "charge" }));
    });

    it("opens on the failure origin, not a span the failure only passed through", () => {
        expect(openingFor(tree, []).selected).toEqual(TreeRow.Span({ spanId: "charge" }));
    });

    it("opens on the first interrupted span, then the root", () => {
        const interrupted = traceOf([span("root", null, 1000), span("a", "root", 1001, { exit: "Interrupted" })]);
        expect(openingFor(interrupted, []).selected).toEqual(TreeRow.Span({ spanId: "a" }));
        const clean = traceOf([span("root", null, 1000), span("a", "root", 1001)]);
        expect(openingFor(clean, []).selected).toEqual(TreeRow.Span({ spanId: "root" }));
    });

    it("opens a partial trace on its missing-parent row", () => {
        const partial = traceOf([span("lost", "absent", 1001)]);
        expect(openingFor(partial, []).selected).toEqual(TreeRow.Missing({ parentId: "absent" }));
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

        it("opens the groups that would hide a seeded search's span or its ancestors", () => {
            const opening = openingFor(grouped, parse("row.index=12"));
            expect(opening.selected).toEqual(TreeRow.Span({ spanId: "row12" }));
            expect(opening.openGroups).toEqual(HashSet.make("import|import.row", "root|batch"));
        });

        it("leaves groups closed for a failure, whose failed lineage a closed group shows anyway", () => {
            const opening = openingFor(grouped, []);
            expect(opening.selected).toEqual(TreeRow.Span({ spanId: "row7" }));
            expect(opening.openGroups).toEqual(HashSet.empty());
        });
    });
});
