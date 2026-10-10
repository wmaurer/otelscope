import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";
import type { Option } from "effect";

export type RunId = string;
export type TraceId = string;
export type SpanId = string;
export type Exit = JsonlSpanRecord["exit"];

export type ResetReason = "truncated" | "replaced" | "removed";

export type Phase = "waiting" | "loading" | "following" | "done";

export interface Status {
    readonly phase: Phase;
    readonly bytesRead: number;
    readonly bytesTotal: number;
    readonly lastRecordAt: Option.Option<number>;
    readonly lastReset: Option.Option<{ readonly reason: ResetReason; readonly at: number }>;
    readonly error: Option.Option<string>;
}

export interface BadLine {
    readonly line: number;
    readonly offset: number;
    readonly issue: string;
    readonly text: string;
}

export interface BadLines {
    readonly legacy: number;
    readonly malformed: number;
    readonly samples: ReadonlyArray<BadLine>;
}

export interface Run {
    readonly id: RunId;
    readonly service: string;
    readonly firstStartMs: number;
    readonly lastEndMs: number;
    readonly traceIds: ReadonlyArray<TraceId>;
    readonly spanCount: number;
    readonly failedTraces: number;
    readonly failedSpans: number;
    readonly interruptedSpans: number;
    readonly logs: number;
    readonly lastArrivalAt: Option.Option<number>;
}

export interface FirstError {
    readonly type: string;
    readonly message: string;
}

export interface Trace {
    readonly id: TraceId;
    readonly runs: ReadonlyArray<RunId>;
    readonly root: Option.Option<SpanId>;
    readonly headName: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly spanCount: number;
    readonly failedSpans: number;
    readonly interruptedSpans: number;
    readonly logs: number;
    readonly rootExit: Option.Option<Exit>;
    readonly firstError: Option.Option<FirstError>;
    readonly lastArrivalAt: Option.Option<number>;
    readonly spans: ReadonlyMap<SpanId, JsonlSpanRecord>;
    readonly children: ReadonlyMap<SpanId | null, ReadonlyArray<SpanId>>;
    readonly topLevel: ReadonlyArray<SpanId>;
    readonly missingParents: ReadonlyArray<SpanId>;
}

/**
 * The traces frozen anew since the snapshot of version `since`, of the same epoch. Every other trace is the same object
 * in each snapshot from that version to this one, so a view built from any of them needs only these.
 */
export interface Changed {
    readonly since: number;
    readonly traces: ReadonlySet<TraceId>;
}

export interface Snapshot {
    readonly version: number;
    readonly epoch: number;
    readonly status: Status;
    readonly runs: ReadonlyMap<RunId, Run>;
    readonly runOrder: ReadonlyArray<RunId>;
    readonly traces: ReadonlyMap<TraceId, Trace>;
    readonly changed: Changed;
    readonly traceOrder: ReadonlyArray<TraceId>;
    readonly spanCount: number;
    readonly badLines: BadLines;
}
