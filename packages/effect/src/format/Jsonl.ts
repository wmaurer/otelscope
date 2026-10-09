import { Array as Arr, Option, Record, Schema } from "effect";

import { DEF, FIBER, type LocationKeys, SITE } from "../Sites.ts";

import type { AnyValue, KeyValue, Span } from "./TraceData.ts";

export type AttributeValue = string | number | boolean | null | ReadonlyArray<AttributeValue>;

export const AttributeValue: Schema.Codec<AttributeValue> = Schema.Union([
    Schema.String,
    // Not `Finite`: JSON cannot carry a non-finite number anyway.
    // @effect-diagnostics-next-line schemaNumber:off
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(Schema.suspend((): Schema.Codec<AttributeValue> => AttributeValue)),
]);

export const Attributes = Schema.Record(Schema.String, AttributeValue);
export type Attributes = typeof Attributes.Type;

export const Location = Schema.Struct({ file: Schema.String, line: Schema.Finite, col: Schema.Finite });
export type Location = typeof Location.Type;

// Effect's logger records every `Effect.log*` call made inside a span as an event on it, carrying the log
// annotations plus `effect.fiberId` and `effect.logLevel`. An error span also carries an `exception` event.
// `offsetMs` is measured from the span's `startMs`.
export const JsonlSpanEvent = Schema.Struct({ name: Schema.String, offsetMs: Schema.Finite, attrs: Attributes });
export type JsonlSpanEvent = typeof JsonlSpanEvent.Type;

// Decoding drops unknown keys, so a line from a newer writer with extra fields still decodes.
export const JsonlSpanRecord = Schema.Struct({
    run: Schema.String,
    service: Schema.String,
    trace: Schema.String,
    span: Schema.String,
    parent: Schema.NullOr(Schema.String),
    name: Schema.String,
    startMs: Schema.Finite,
    ms: Schema.Finite,
    exit: Schema.Literals(["Success", "Failure", "Interrupted"]),
    site: Schema.NullOr(Location),
    def: Schema.NullOr(Location),
    fiber: Schema.NullOr(Schema.Finite),
    attrs: Attributes,
    events: Schema.Array(JsonlSpanEvent),
});
export type JsonlSpanRecord = typeof JsonlSpanRecord.Type;

const STATUS_ERROR = 2;

// OTLP times are nanoseconds since the epoch, as decimal strings past `Number.MAX_SAFE_INTEGER`. Rounding to
// whole microseconds in BigInt first gives a value a double holds exactly.
const toMillis = (nanos: bigint): number => Number((nanos + 500n) / 1_000n) / 1_000;

const millisBetween = (startNanos: string, endNanos: string): number => toMillis(BigInt(endNanos) - BigInt(startNanos));

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

const LIFTED: ReadonlySet<string> = new Set([...SITE, ...DEF, FIBER]);

const decodeLocation = Schema.decodeUnknownOption(Schema.Tuple([Schema.String, Schema.Finite, Schema.Finite]));

const decodeFiber = Schema.decodeUnknownOption(Schema.Finite);

const location = (attrs: Attributes, keys: LocationKeys): Location | null =>
    Option.match(decodeLocation(Arr.map(keys, (key) => attrs[key])), {
        onNone: () => null,
        onSome: ([file, line, col]) => ({ file, line, col }),
    });

const exitOf = (span: Span, attrs: Attributes): JsonlSpanRecord["exit"] => {
    if (span.status.code === STATUS_ERROR) return "Failure";
    // Effect's tracer reports an interrupted span with status Ok and this attribute.
    return attrs["status.interrupted"] === true ? "Interrupted" : "Success";
};

export const toRecord = (run: string, service: string, span: Span): JsonlSpanRecord => {
    const all = plainAttributes(span.attributes);
    const attrs = Record.filter(all, (_, key) => !LIFTED.has(key));
    return {
        run,
        service,
        trace: span.traceId,
        span: span.spanId,
        parent: span.parentSpanId ?? null,
        name: span.name,
        startMs: toMillis(BigInt(span.startTimeUnixNano)),
        ms: millisBetween(span.startTimeUnixNano, span.endTimeUnixNano),
        exit: exitOf(span, attrs),
        site: location(all, SITE),
        def: location(all, DEF),
        fiber: Option.getOrNull(decodeFiber(all[FIBER])),
        attrs,
        events: Arr.map(span.events, (event) => ({
            name: event.name,
            offsetMs: millisBetween(span.startTimeUnixNano, event.timeUnixNano),
            attrs: plainAttributes(event.attributes),
        })),
    };
};

export const toLines = (run: string, service: string, spans: ReadonlyArray<Span>): string =>
    Arr.join(
        Arr.map(spans, (span) => `${JSON.stringify(toRecord(run, service, span))}\n`),
        "",
    );
