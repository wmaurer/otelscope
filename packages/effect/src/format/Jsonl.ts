import { Array as Arr } from "effect";

import type { AnyValue, KeyValue, Span } from "./TraceData.ts";

export type AttributeValue = string | number | boolean | null | ReadonlyArray<AttributeValue>;

export interface Attributes {
    readonly [key: string]: AttributeValue;
}

// Effect's logger records every `Effect.log*` call made inside a span as an event on it, carrying the log
// annotations plus `effect.fiberId` and `effect.logLevel`. An error span also carries an `exception` event.
export interface JsonlSpanEvent {
    readonly name: string;
    // Milliseconds from the start of the enclosing span, not a wall clock: this file reports every other
    // time as a whole-millisecond duration, and the offset is what tells retries apart from each other.
    readonly offsetMs: number;
    readonly attrs: Attributes;
}

export interface JsonlSpanRecord {
    readonly run: string;
    readonly trace: string;
    readonly span: string;
    readonly parent: string | null;
    readonly name: string;
    readonly ms: number;
    readonly exit: "Success" | "Failure" | "Interrupted";
    readonly attrs: Attributes;
    readonly events: ReadonlyArray<JsonlSpanEvent>;
}

const STATUS_ERROR = 2;

// OTLP times are nanoseconds since the epoch, as decimal strings past `Number.MAX_SAFE_INTEGER`. The
// difference is taken exactly and rounded once.
const millisBetween = (startNanos: string, endNanos: string): number =>
    Math.round(Number(BigInt(endNanos) - BigInt(startNanos)) / 1_000_000);

const plainValue = (value: AnyValue): AttributeValue => {
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.boolValue !== undefined) return value.boolValue;
    if (value.intValue !== undefined) return Number(value.intValue);
    if (value.doubleValue !== undefined) return value.doubleValue;
    if (value.arrayValue !== undefined) return Arr.map(value.arrayValue.values, plainValue);
    return null;
};

export const plainAttributes = (attributes: ReadonlyArray<KeyValue>): Attributes =>
    Object.fromEntries(Arr.map(attributes, (attribute) => [attribute.key, plainValue(attribute.value)]));

const exitOf = (span: Span, attrs: Attributes): JsonlSpanRecord["exit"] => {
    if (span.status.code === STATUS_ERROR) return "Failure";
    // Effect's tracer reports an interrupted span with status Ok and this attribute.
    return attrs["status.interrupted"] === true ? "Interrupted" : "Success";
};

export const toRecord = (runId: string, span: Span): JsonlSpanRecord => {
    const attrs = plainAttributes(span.attributes);
    return {
        run: runId,
        trace: span.traceId,
        span: span.spanId,
        parent: span.parentSpanId ?? null,
        name: span.name,
        ms: millisBetween(span.startTimeUnixNano, span.endTimeUnixNano),
        exit: exitOf(span, attrs),
        attrs,
        events: Arr.map(span.events, (event) => ({
            name: event.name,
            offsetMs: millisBetween(span.startTimeUnixNano, event.timeUnixNano),
            attrs: plainAttributes(event.attributes),
        })),
    };
};

export const toLines = (runId: string, spans: ReadonlyArray<Span>): string =>
    Arr.join(
        Arr.map(spans, (span) => `${JSON.stringify(toRecord(runId, span))}\n`),
        "",
    );
