import type { KeyValue, Span, TraceData } from "../../src/format/TraceData.ts";

// One OTLP span as `OtlpTracer` writes it. Times are nanoseconds since the epoch, as strings.
export const otlpSpan = (over: Partial<Span> & { readonly name: string; readonly spanId: string }): Span => ({
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    kind: 1,
    startTimeUnixNano: "1757000000500000000",
    endTimeUnixNano: "1757000000500000000",
    attributes: [],
    droppedAttributesCount: 0,
    events: [],
    droppedEventsCount: 0,
    status: { code: 1 },
    links: [],
    droppedLinksCount: 0,
    ...over,
});

export const traceData = (spans: ReadonlyArray<Span>): TraceData => ({
    resourceSpans: [
        {
            resource: {
                attributes: [{ key: "service.name", value: { stringValue: "test" } }],
                droppedAttributesCount: 0,
            },
            scopeSpans: [{ scope: { name: "test" }, spans }],
        },
    ],
});

export const str = (key: string, value: string): KeyValue => ({ key, value: { stringValue: value } });
