import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option, Order, Schema } from "effect";

import { Index } from "../../src/data/Index.ts";
import { exception, line, log, record } from "../support/records.ts";
import { indexed, ingestAll, plainTraces, status } from "../support/store.ts";

import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const trace = (snapshot: ReturnType<typeof indexed>, id = "trace-1") => {
    const found = snapshot.traces.get(id);
    expect(found, `trace ${id}`).toBeDefined();
    return found!;
};

describe("Index", () => {
    it("files children under parents that have not arrived and lists them as missing, by earliest child", () => {
        const orphans = indexed([
            record({ span: "grandchild", parent: "child", startMs: 30 }),
            record({ span: "child", parent: "root", startMs: 10 }),
        ]);
        expect(trace(orphans)).toMatchObject({
            root: Option.none(),
            headName: "child",
            topLevel: [],
            missingParents: ["root"],
            children: new Map([
                ["child", ["grandchild"]],
                ["root", ["child"]],
            ]),
        });

        const index = ingestAll(new Index(), [
            line(record({ span: "grandchild", parent: "child", startMs: 30 })),
            line(record({ span: "other", parent: "elsewhere", startMs: 20 })),
            line(record({ span: "child", parent: "root", startMs: 10 })),
        ]);
        expect(trace(index.freeze(status)).missingParents, "two orphan groups, by earliest child").toEqual([
            "root",
            "elsewhere",
        ]);
        index.ingest(line(record({ span: "root", name: "GET /", startMs: 5 })), 4, 0, Option.none());
        expect(trace(index.freeze(status)), "the parent's arrival relinks nothing").toMatchObject({
            root: Option.some("root"),
            headName: "GET /",
            topLevel: ["root"],
            missingParents: ["elsewhere"],
            children: new Map([
                [null, ["root"]],
                ["root", ["child"]],
                ["child", ["grandchild"]],
                ["elsewhere", ["other"]],
            ]),
        });
    });

    it("takes the earliest parent-less span as the root and lists the others after it", () => {
        const snapshot = indexed([
            record({ span: "late", startMs: 50 }),
            record({ span: "first", startMs: 10, exit: "Failure" }),
            record({ span: "tie-b", startMs: 50 }),
        ]);
        expect(trace(snapshot)).toMatchObject({
            root: Option.some("first"),
            rootExit: Option.some("Failure"),
            topLevel: ["first", "late", "tie-b"],
        });
    });

    it("keeps one trace across two runs, listed under both", () => {
        const snapshot = indexed([
            record({ run: "web", service: "web", span: "a", startMs: 10 }),
            record({ run: "worker", service: "worker", span: "b", parent: "a", startMs: 20 }),
        ]);
        expect(trace(snapshot).runs).toEqual(["web", "worker"]);
        expect(snapshot.traces.size).toBe(1);
        expect(snapshot.runs.get("web")?.traceIds).toEqual(["trace-1"]);
        expect(snapshot.runs.get("worker")?.traceIds).toEqual(["trace-1"]);
        expect(snapshot.runOrder).toEqual(["web", "worker"]);
    });

    it("aggregates traces and runs, with the first error in arrival order", () => {
        const snapshot = indexed([
            record({
                span: "child",
                parent: "root",
                startMs: 20,
                ms: 5,
                exit: "Failure",
                events: [exception("Inner", "boom")],
            }),
            record({
                span: "sibling",
                parent: "root",
                startMs: 15,
                ms: 1,
                exit: "Interrupted",
                events: [log("a"), log("b", "DEBUG")],
            }),
            record({ span: "root", startMs: 10, ms: 30, exit: "Failure", events: [exception("Outer", "wrapped")] }),
            record({ trace: "trace-2", span: "ok", startMs: 5, ms: 1 }),
            record({ run: "run-2", trace: "trace-3", span: "r3", startMs: 100, ms: 2, exit: "Failure" }),
            record({ run: "run-1", trace: "trace-3", span: "c3", parent: "r3", startMs: 101, ms: 1 }),
        ]);
        expect(trace(snapshot)).toMatchObject({
            startMs: 10,
            endMs: 40,
            spanCount: 3,
            failedSpans: 2,
            interruptedSpans: 1,
            logs: 2,
            rootExit: Option.some("Failure"),
            firstError: Option.some({ type: "Inner", message: "boom" }),
            lastArrivalAt: Option.none(),
        });
        expect(snapshot.runs.get("run-1")).toMatchObject({
            firstStartMs: 5,
            lastEndMs: 102,
            traceIds: ["trace-2", "trace-1", "trace-3"],
            spanCount: 5,
            failedTraces: 1,
            failedSpans: 2,
            interruptedSpans: 1,
            logs: 2,
        });
        expect(snapshot.runs.get("run-2"), "trace-3's failed root is in run-2").toMatchObject({
            failedTraces: 1,
            spanCount: 1,
        });
        expect(snapshot.traceOrder).toEqual(["trace-2", "trace-1", "trace-3"]);
        expect(snapshot.spanCount).toBe(6);
    });

    it("moves a failed trace's credit when an earlier root arrives", () => {
        const index = ingestAll(new Index(), [line(record({ span: "late", startMs: 20, exit: "Failure" }))]);
        expect(index.freeze(status).runs.get("run-1")?.failedTraces).toBe(1);
        index.ingest(line(record({ span: "early", startMs: 10 })), 2, 0, Option.none());
        const snapshot = index.freeze(status);
        expect(snapshot.runs.get("run-1")?.failedTraces, "the new root succeeded").toBe(0);
        expect(trace(snapshot).rootExit).toEqual(Option.some("Success"));
    });

    it("reorders a trace whose start moves earlier when its root arrives", () => {
        const index = ingestAll(new Index(), [
            line(record({ trace: "a", span: "a-child", parent: "a-root", startMs: 30 })),
            line(record({ trace: "b", span: "b-root", startMs: 20 })),
        ]);
        expect(index.freeze(status).traceOrder).toEqual(["b", "a"]);
        index.ingest(line(record({ trace: "a", span: "a-root", startMs: 10 })), 3, 0, Option.none());
        const snapshot = index.freeze(status);
        expect(snapshot.traceOrder).toEqual(["a", "b"]);
        expect(snapshot.runs.get("run-1")?.traceIds).toEqual(["a", "b"]);
    });

    it("reuses an untouched trace and run by reference and leaves a published snapshot unchanged", () => {
        const index = ingestAll(new Index(), [
            line(record({ run: "run-a", trace: "a", span: "a-root", startMs: 10 })),
            line(record({ run: "run-b", trace: "b", span: "b-root", startMs: 20 })),
        ]);
        const before = index.freeze(status);
        index.ingest(
            line(record({ run: "run-b", trace: "b", span: "b-child", parent: "b-root", startMs: 21 })),
            3,
            0,
            Option.none(),
        );
        const after = index.freeze(status);

        expect(after.traces.get("a"), "untouched trace").toBe(before.traces.get("a"));
        expect(after.runs.get("run-a"), "untouched run").toBe(before.runs.get("run-a"));
        expect(after.traceOrder, "unchanged order").toBe(before.traceOrder);
        expect(after.traces.get("b")).not.toBe(before.traces.get("b"));
        expect(after.traces.get("b")?.children.get("b-root")).toEqual(["b-child"]);
        expect(before.traces.get("b")?.children.has("b-root"), "the earlier snapshot is not mutated").toBe(false);
        expect(before.traces.get("b")?.spans.size).toBe(1);

        index.ingest(
            line(record({ run: "run-b", trace: "b", span: "b-child-2", parent: "b-root", startMs: 22 })),
            4,
            0,
            Option.none(),
        );
        index.freeze(status);
        expect(after.traces.get("b")?.children.get("b-root"), "a shared child list is copied before an insert").toEqual(
            ["b-child"],
        );
    });

    it("clears everything on reset and bumps the epoch", () => {
        const index = ingestAll(new Index(), [
            line(record({ span: "a" })),
            "not json",
            JSON.stringify({ run: "r", trace: "t", span: "s" }),
        ]);
        const before = index.freeze(status);
        index.reset();
        const after = index.freeze(status);
        expect(plainTraces(after)).toEqual({
            version: before.version + 1,
            epoch: before.epoch + 1,
            status,
            runs: new Map(),
            runOrder: [],
            traces: new Map(),
            traceOrder: [],
            spanCount: 0,
            badLines: { legacy: 0, malformed: 0, samples: [] },
        });
    });

    it("counts legacy and malformed lines and keeps the first 100 malformed ones, cut to 200 characters", () => {
        const malformed = Arr.makeBy(150, (i) => `{"broken": ${i} ${"x".repeat(300)}`);
        const legacy = Arr.replicate(JSON.stringify({ run: "r", trace: "t", span: "s", start: 1 }), 3);
        const { badLines, spanCount } = ingestAll(new Index(), [
            ...legacy,
            ...malformed,
            "",
            line(record({ span: "ok" })),
        ]).freeze(status);
        expect(spanCount, "an empty line is skipped").toBe(1);
        expect(badLines.legacy).toBe(3);
        expect(badLines.malformed).toBe(150);
        expect(badLines.samples).toHaveLength(100);
        expect(badLines.samples[0]).toMatchObject({ line: 4, offset: 3000, text: malformed[0].slice(0, 200) });
        expect(badLines.samples[99].line).toBe(103);
    });

    it("keeps the first of two spans with one id in a trace and counts the second as malformed", () => {
        const { badLines, spanCount, traces } = ingestAll(new Index(), [
            line(record({ span: "51e618f6b243c6b0", name: "first" })),
            line(record({ span: "51e618f6b243c6b0", name: "second" })),
            line(record({ trace: "trace-2", span: "51e618f6b243c6b0", name: "other trace" })),
        ]).freeze(status);
        expect(traces.get("trace-1")?.spans.get("51e618f6b243c6b0")?.name).toBe("first");
        expect(spanCount, "the same id in another trace is a different span").toBe(2);
        expect(badLines.malformed).toBe(1);
        expect(badLines.samples).toEqual([
            { line: 2, offset: 1000, issue: "duplicate span 51e618f6…", text: expect.stringContaining('"second"') },
        ]);
    });

    it("indexes a run whose service disagrees under its first service and counts it malformed once", () => {
        const { badLines, runs, spanCount } = indexed([
            record({ span: "a", service: "api" }),
            record({ span: "b", service: "worker" }),
            record({ span: "c", service: "worker" }),
        ]);
        expect(spanCount).toBe(3);
        expect(runs.get("run-1")?.service).toBe("api");
        expect(badLines.malformed).toBe(1);
        expect(badLines.samples[0]).toMatchObject({ line: 2, issue: 'run run-1: service "worker" differs from "api"' });
    });

    it("stamps arrivals on the trace and the run", () => {
        const snapshot = ingestAll(new Index(), [line(record({ span: "a" }))], Option.some(42)).freeze(status);
        expect(trace(snapshot).lastArrivalAt).toEqual(Option.some(42));
        expect(snapshot.runs.get("run-1")?.lastArrivalAt).toEqual(Option.some(42));
    });

    const between = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

    const GeneratedSpan = Schema.Struct({
        trace: between(0, 3),
        parent: between(-1, 30),
        startMs: between(0, 12),
        exit: Schema.Literals(["Success", "Failure", "Interrupted"]),
        logs: between(0, 2),
        shuffle: between(0, 1000),
        cut: Schema.Boolean,
    });

    const recordsOf = (seeds: ReadonlyArray<typeof GeneratedSpan.Type>): ReadonlyArray<JsonlSpanRecord> =>
        Arr.map(seeds, (seed, i) => {
            const firstInTrace = Arr.findFirstIndex(seeds, (other) => other.trace === seed.trace);
            return record({
                run: `run-${seed.trace % 2}`,
                service: `service-${seed.trace % 2}`,
                trace: `trace-${seed.trace}`,
                span: `span-${String(i).padStart(2, "0")}`,
                parent: seed.parent < 0 || seed.parent === i ? null : `span-${String(seed.parent).padStart(2, "0")}`,
                startMs: seed.startMs,
                ms: seed.logs + 1,
                exit: seed.exit,
                events: [
                    ...Array.from({ length: seed.logs }, () => log("tick")),
                    ...(Option.getOrUndefined(firstInTrace) === i ? [exception("Boom", `in ${i}`)] : []),
                ],
            });
        });

    it.prop(
        "gives the same final snapshot for the same records in any order and any chunking, apart from version",
        [Schema.Array(GeneratedSpan).check(Schema.isMaxLength(40))],
        ([seeds]) => {
            const records = recordsOf(seeds);
            const expected = indexed(records);

            const shuffled = Arr.sort(
                Arr.zip(records, seeds),
                Order.mapInput(
                    Order.Number,
                    ([, seed]: readonly [JsonlSpanRecord, typeof GeneratedSpan.Type]) => seed.shuffle,
                ),
            );
            const index = new Index();
            Arr.forEach(shuffled, ([span, seed], i) => {
                index.ingest(line(span), i + 1, i * 1000, Option.none());
                if (seed.cut) {
                    index.freeze(status);
                }
            });
            expect(plainTraces({ ...index.freeze(status), version: 0 })).toEqual(
                plainTraces({ ...expected, version: 0 }),
            );
        },
    );
});
