import { Array as Arr, Option, Order, Predicate, Record } from "effect";

import { LOG_LEVEL } from "../model/levels.ts";
import { classify } from "./Decode.ts";
import { LayeredMap } from "./LayeredMap.ts";
import { insertSorted, SortedIds } from "./SortedIds.ts";

import type {
    BadLine,
    BadLines,
    Changed,
    FirstError,
    Run,
    RunId,
    Snapshot,
    SpanId,
    Status,
    Trace,
    TraceId,
} from "./Snapshot.ts";
import type { Attributes, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const MAX_SAMPLES = 100;
const SAMPLE_CHARS = 200;

class TraceBuilder {
    readonly id: TraceId;
    runs: ReadonlyArray<RunId> = [];
    readonly spans = new Map<SpanId, JsonlSpanRecord>();
    readonly children = new Map<SpanId | null, Array<SpanId>>();
    readonly ownedSinceFreeze = new Set<SpanId | null>();
    readonly missing = new Set<SpanId>();
    startMs = Infinity;
    endMs = -Infinity;
    failedSpans = 0;
    interruptedSpans = 0;
    logs = 0;
    firstError = Option.none<FirstError>();
    lastArrivalAt = Option.none<number>();
    earliest: JsonlSpanRecord | undefined = undefined;
    failedRootRun: RunId | undefined = undefined;

    constructor(id: TraceId) {
        this.id = id;
    }

    readonly startOf = (span: SpanId): number => this.spans.get(span)?.startMs ?? 0;
}

class RunBuilder {
    readonly id: RunId;
    readonly service: string;
    firstStartMs = Infinity;
    lastEndMs = -Infinity;
    readonly traceIds = new SortedIds();
    spanCount = 0;
    failedTraces = 0;
    failedSpans = 0;
    interruptedSpans = 0;
    logs = 0;
    lastArrivalAt = Option.none<number>();
    serviceReported = false;

    constructor(id: RunId, service: string) {
        this.id = id;
        this.service = service;
    }
}

const startsBefore = (a: JsonlSpanRecord, b: JsonlSpanRecord): boolean =>
    a.startMs < b.startMs || (a.startMs === b.startMs && a.span < b.span);

const firstErrorOf = (record: JsonlSpanRecord): Option.Option<FirstError> => {
    for (const event of record.events) {
        if (event.name === "exception") {
            const type = event.attrs["exception.type"];
            const message = event.attrs["exception.message"];
            return Option.some({
                type: Predicate.isString(type) ? type : "",
                message: Predicate.isString(message) ? message : "",
            });
        }
    }
    return Option.none();
};

const logsOf = (record: JsonlSpanRecord): number => Arr.countBy(record.events, (event) => LOG_LEVEL in event.attrs);

const freezeTrace = (trace: TraceBuilder): Trace => {
    trace.ownedSinceFreeze.clear();
    const topLevel: ReadonlyArray<SpanId> = trace.children.get(null) ?? [];
    const rootId = Arr.head(topLevel);
    const root = Option.flatMapNullishOr(rootId, (id) => trace.spans.get(id));
    const byEarliestChild = Order.mapInput(
        Order.Tuple([Order.Number, Order.String]),
        (parent: SpanId) => [trace.startOf(trace.children.get(parent)?.[0] ?? ""), parent] as const,
    );
    return {
        id: trace.id,
        runs: trace.runs,
        root: rootId,
        headName: Option.getOrElse(root, () => trace.earliest)?.name ?? "",
        startMs: trace.startMs,
        endMs: trace.endMs,
        spanCount: trace.spans.size,
        failedSpans: trace.failedSpans,
        interruptedSpans: trace.interruptedSpans,
        logs: trace.logs,
        rootExit: Option.map(root, (span) => span.exit),
        firstError: trace.firstError,
        lastArrivalAt: trace.lastArrivalAt,
        spans: new Map(trace.spans),
        children: new Map(trace.children),
        topLevel,
        missingParents: Arr.sort(Array.from(trace.missing), byEarliestChild),
    };
};

const freezeRun = (run: RunBuilder): Run => ({
    id: run.id,
    service: run.service,
    firstStartMs: run.firstStartMs,
    lastEndMs: run.lastEndMs,
    traceIds: run.traceIds.freeze(),
    spanCount: run.spanCount,
    failedTraces: run.failedTraces,
    failedSpans: run.failedSpans,
    interruptedSpans: run.interruptedSpans,
    logs: run.logs,
    lastArrivalAt: run.lastArrivalAt,
});

/** Copies the previous map whole, which is cheaper than spreading it into entries, then replaces the touched values. */
const withFrozen = <K, B, A>(
    previous: ReadonlyMap<K, A>,
    dirty: ReadonlySet<B>,
    keyOf: (builder: B) => K,
    freeze: (builder: B) => A,
): ReadonlyMap<K, A> => {
    if (dirty.size === 0) {
        return previous;
    }
    // oxlint-disable-next-line effect-native/imperative-collection-build -- a copy-on-write publish: filling it is the design.
    const next = new Map(previous);
    for (const builder of dirty) {
        next.set(keyOf(builder), freeze(builder));
    }
    return next;
};

const emptyBadLines: BadLines = { legacy: 0, malformed: 0, samples: [] };

/**
 * One copy of each repeated string. `JSON.parse` shares object keys and values of up to about 10 characters, but makes a
 * new string for every longer value, so without this each record carries its own run, trace id, names, file paths and
 * attribute values.
 */
class Strings {
    // oxlint-disable-next-line effect-native/imperative-collection-build -- an intern table: filling it is the design.
    private readonly known = new Map<string, string>();

    readonly of = (text: string): string => {
        const found = this.known.get(text);
        if (found !== undefined) {
            return found;
        }
        this.known.set(text, text);
        return text;
    };
}

const internedAttrs = (strings: Strings, attrs: Attributes): Attributes =>
    Record.map(attrs, (value) => (Predicate.isString(value) ? strings.of(value) : value));

const interned = (strings: Strings, record: JsonlSpanRecord): JsonlSpanRecord => ({
    ...record,
    run: strings.of(record.run),
    service: strings.of(record.service),
    trace: strings.of(record.trace),
    parent: record.parent === null ? null : strings.of(record.parent),
    name: strings.of(record.name),
    site: record.site === null ? null : { ...record.site, file: strings.of(record.site.file) },
    def: record.def === null ? null : { ...record.def, file: strings.of(record.def.file) },
    events:
        record.events.length === 0
            ? record.events
            : Arr.map(record.events, (event) => ({
                  ...event,
                  name: strings.of(event.name),
                  attrs: internedAttrs(strings, event.attrs),
              })),
    attrs: internedAttrs(strings, record.attrs),
});

export class Index {
    private version = 0;
    private epoch = 0;
    /** The last version to freeze a trace, or the first after a reset. */
    private tracesFrozenAt = 0;
    private traces = new Map<TraceId, TraceBuilder>();
    private runs = new Map<RunId, RunBuilder>();
    private traceOrder = new SortedIds();
    private runOrder = new SortedIds();
    private dirtyTraces = new Set<TraceBuilder>();
    private dirtyRuns = new Set<RunBuilder>();
    private spanCount = 0;
    private badLines = emptyBadLines;
    private frozenTraces = LayeredMap.empty<TraceId, Trace>();
    private frozenRuns: ReadonlyMap<RunId, Run> = new Map();
    private strings = new Strings();

    ingest(text: string, line: number, offset: number, arrivalAt: Option.Option<number>): void {
        if (text.length === 0) {
            return;
        }
        const classified = classify(text);
        switch (classified._tag) {
            case "Span":
                return this.add(interned(this.strings, classified.record), line, offset, text, arrivalAt);
            case "Legacy":
                this.badLines = { ...this.badLines, legacy: this.badLines.legacy + 1 };
                return;
            case "Malformed":
                return this.malformed(line, offset, classified.issue, text);
        }
    }

    reset(): void {
        this.epoch += 1;
        this.tracesFrozenAt = this.version + 1;
        this.traces = new Map();
        this.runs = new Map();
        this.traceOrder = new SortedIds();
        this.runOrder = new SortedIds();
        this.dirtyTraces = new Set();
        this.dirtyRuns = new Set();
        this.spanCount = 0;
        this.badLines = emptyBadLines;
        this.frozenTraces = LayeredMap.empty();
        this.frozenRuns = new Map();
        this.strings = new Strings();
    }

    freeze(status: Status): Snapshot {
        this.version += 1;
        const changed: Changed = {
            since: this.tracesFrozenAt,
            traces: new Set(Arr.map(Array.from(this.dirtyTraces), (trace) => trace.id)),
        };
        if (this.dirtyTraces.size > 0) {
            this.tracesFrozenAt = this.version;
        }
        this.frozenTraces = this.frozenTraces.with(
            Arr.map(Array.from(this.dirtyTraces), (trace) => [trace.id, freezeTrace(trace)] as const),
        );
        this.frozenRuns = withFrozen(this.frozenRuns, this.dirtyRuns, (run) => run.id, freezeRun);
        this.dirtyTraces.clear();
        this.dirtyRuns.clear();
        return {
            version: this.version,
            epoch: this.epoch,
            status,
            runs: this.frozenRuns,
            runOrder: this.runOrder.freeze(),
            traces: this.frozenTraces,
            changed,
            traceOrder: this.traceOrder.freeze(),
            spanCount: this.spanCount,
            badLines: this.badLines,
        };
    }

    private malformed(line: number, offset: number, issue: string, text: string): void {
        const sample: BadLine = { line, offset, issue, text: text.slice(0, SAMPLE_CHARS) };
        const samples = this.badLines.samples;
        this.badLines = {
            ...this.badLines,
            malformed: this.badLines.malformed + 1,
            samples: samples.length < MAX_SAMPLES ? Arr.append(samples, sample) : samples,
        };
    }

    private add(
        record: JsonlSpanRecord,
        line: number,
        offset: number,
        text: string,
        arrivalAt: Option.Option<number>,
    ): void {
        const known = this.traces.get(record.trace);
        if (known?.spans.has(record.span) === true) {
            return this.malformed(line, offset, `duplicate span ${record.span.slice(0, 8)}…`, text);
        }
        const trace = known ?? new TraceBuilder(record.trace);
        if (known === undefined) {
            this.traces.set(trace.id, trace);
        }
        const run = this.runs.get(record.run) ?? new RunBuilder(record.run, record.service);
        if (!this.runs.has(run.id)) {
            this.runs.set(run.id, run);
        } else if (run.service !== record.service && !run.serviceReported) {
            run.serviceReported = true;
            this.malformed(
                line,
                offset,
                `run ${run.id}: service "${record.service}" differs from "${run.service}"`,
                text,
            );
        }

        const logs = logsOf(record);
        this.addSpan(trace, record, logs, arrivalAt);
        if (!Arr.contains(trace.runs, run.id)) {
            trace.runs = Arr.append(trace.runs, run.id);
            run.traceIds.upsert(trace.id, trace.startMs);
        }
        this.addToRun(run, record, logs, arrivalAt);
        this.moveFailedTraceCredit(trace);
        this.spanCount += 1;
        this.dirtyTraces.add(trace);
        this.dirtyRuns.add(run);
    }

    private addSpan(
        trace: TraceBuilder,
        record: JsonlSpanRecord,
        logs: number,
        arrivalAt: Option.Option<number>,
    ): void {
        trace.spans.set(record.span, record);
        const parent = record.parent;
        const shared = trace.children.get(parent);
        const siblings = trace.ownedSinceFreeze.has(parent) && shared !== undefined ? shared : (shared?.slice() ?? []);
        trace.children.set(parent, siblings);
        trace.ownedSinceFreeze.add(parent);
        insertSorted(siblings, record.span, record.startMs, trace.startOf);
        if (parent !== null && !trace.spans.has(parent)) {
            trace.missing.add(parent);
        }
        trace.missing.delete(record.span);

        if (record.startMs < trace.startMs) {
            trace.startMs = record.startMs;
            this.traceOrder.upsert(trace.id, trace.startMs);
            for (const runId of trace.runs) {
                this.runs.get(runId)?.traceIds.upsert(trace.id, trace.startMs);
            }
        }
        trace.endMs = Math.max(trace.endMs, record.startMs + record.ms);
        if (trace.earliest === undefined || startsBefore(record, trace.earliest)) {
            trace.earliest = record;
        }
        trace.failedSpans += record.exit === "Failure" ? 1 : 0;
        trace.interruptedSpans += record.exit === "Interrupted" ? 1 : 0;
        trace.logs += logs;
        if (Option.isNone(trace.firstError)) {
            trace.firstError = firstErrorOf(record);
        }
        if (Option.isSome(arrivalAt)) {
            trace.lastArrivalAt = arrivalAt;
        }
    }

    private addToRun(run: RunBuilder, record: JsonlSpanRecord, logs: number, arrivalAt: Option.Option<number>): void {
        if (record.startMs < run.firstStartMs) {
            run.firstStartMs = record.startMs;
            this.runOrder.upsert(run.id, run.firstStartMs);
        }
        run.lastEndMs = Math.max(run.lastEndMs, record.startMs + record.ms);
        run.spanCount += 1;
        run.failedSpans += record.exit === "Failure" ? 1 : 0;
        run.interruptedSpans += record.exit === "Interrupted" ? 1 : 0;
        run.logs += logs;
        if (Option.isSome(arrivalAt)) {
            run.lastArrivalAt = arrivalAt;
        }
    }

    private moveFailedTraceCredit(trace: TraceBuilder): void {
        const rootId = trace.children.get(null)?.[0];
        const root = rootId === undefined ? undefined : trace.spans.get(rootId);
        const credited = root?.exit === "Failure" ? root.run : undefined;
        if (credited === trace.failedRootRun) {
            return;
        }
        for (const [runId, change] of [
            [trace.failedRootRun, -1],
            [credited, 1],
        ] as const) {
            const run = runId === undefined ? undefined : this.runs.get(runId);
            if (run !== undefined) {
                run.failedTraces += change;
                this.dirtyRuns.add(run);
            }
        }
        trace.failedRootRun = credited;
    }
}
