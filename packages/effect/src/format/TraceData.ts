import { Array as Arr, pipe, Schema, SchemaTransformation } from "effect";

// The OTLP/JSON trace payload, limited to the fields that `OtlpTracer` from `effect/observability` writes.
// `OtlpResource.unknownToAttributeValue` produces only these five value kinds.
export interface AnyValue {
    readonly stringValue?: string;
    readonly boolValue?: boolean;
    readonly intValue?: string | number;
    readonly doubleValue?: number | null;
    readonly arrayValue?: { readonly values: ReadonlyArray<AnyValue> };
}

// `OtlpSerialization.layerJson` writes a non-finite double as the string OTLP/JSON prescribes, `"NaN"`,
// `"Infinity"` or `"-Infinity"`. `JSON.stringify` alone writes it as `null`.
export interface AnyValueEncoded {
    readonly stringValue?: string;
    readonly boolValue?: boolean;
    readonly intValue?: string | number;
    readonly doubleValue?: number | "NaN" | "Infinity" | "-Infinity" | null;
    readonly arrayValue?: { readonly values: ReadonlyArray<AnyValueEncoded> };
}

const NonFinite = Schema.Literals(["NaN", "Infinity", "-Infinity"]).pipe(
    Schema.decodeTo(
        // @effect-diagnostics-next-line schemaNumber:off
        Schema.Number,
        SchemaTransformation.transform({
            decode: (text) => Number(text),
            encode: (value) => (Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity"),
        }),
    ),
);

export const AnyValue: Schema.Codec<AnyValue, AnyValueEncoded> = Schema.Struct({
    stringValue: Schema.optionalKey(Schema.String),
    boolValue: Schema.optionalKey(Schema.Boolean),
    intValue: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
    doubleValue: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null, NonFinite])),
    arrayValue: Schema.optionalKey(
        Schema.Struct({
            values: Schema.Array(Schema.suspend((): Schema.Codec<AnyValue, AnyValueEncoded> => AnyValue)),
        }),
    ),
});

export const KeyValue = Schema.Struct({ key: Schema.String, value: AnyValue });
export type KeyValue = typeof KeyValue.Type;

const Attributes = Schema.Array(KeyValue);

export const SpanEvent = Schema.Struct({
    name: Schema.String,
    timeUnixNano: Schema.String,
    attributes: Attributes,
    droppedAttributesCount: Schema.Finite,
});

export const Span = Schema.Struct({
    traceId: Schema.String,
    spanId: Schema.String,
    parentSpanId: Schema.optionalKey(Schema.String),
    name: Schema.String,
    kind: Schema.Finite,
    startTimeUnixNano: Schema.String,
    endTimeUnixNano: Schema.String,
    attributes: Attributes,
    droppedAttributesCount: Schema.Finite,
    events: Schema.Array(SpanEvent),
    droppedEventsCount: Schema.Finite,
    status: Schema.Struct({ code: Schema.Literals([0, 1, 2]), message: Schema.optionalKey(Schema.String) }),
    links: Schema.Array(
        Schema.Struct({
            traceId: Schema.String,
            spanId: Schema.String,
            attributes: Attributes,
            droppedAttributesCount: Schema.Finite,
        }),
    ),
    droppedLinksCount: Schema.Finite,
});
export type Span = typeof Span.Type;

export const TraceData = Schema.Struct({
    resourceSpans: Schema.Array(
        Schema.Struct({
            resource: Schema.Struct({ attributes: Attributes, droppedAttributesCount: Schema.Finite }),
            scopeSpans: Schema.Array(
                Schema.Struct({ scope: Schema.Struct({ name: Schema.String }), spans: Schema.Array(Span) }),
            ),
        }),
    ),
});
export type TraceData = typeof TraceData.Type;

export const spansOf = (data: TraceData): ReadonlyArray<Span> =>
    pipe(
        data.resourceSpans,
        Arr.flatMap((resource) => resource.scopeSpans),
        Arr.flatMap((scope) => scope.spans),
    );
