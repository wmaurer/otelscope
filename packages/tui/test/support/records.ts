import type { JsonlSpanEvent, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export const record = (over: Partial<JsonlSpanRecord> & { readonly span: string }): JsonlSpanRecord => ({
    run: "run-1",
    service: "api",
    trace: "trace-1",
    parent: null,
    name: over.span,
    startMs: 1_000,
    ms: 1,
    exit: "Success",
    site: null,
    def: null,
    fiber: null,
    attrs: {},
    events: [],
    ...over,
});

export const line = (value: JsonlSpanRecord): string => JSON.stringify(value);

export const exception = (type: string, message: string): JsonlSpanEvent => ({
    name: "exception",
    offsetMs: 0,
    attrs: { "exception.type": type, "exception.message": message, "exception.stacktrace": `${type}: ${message}` },
});

export const log = (message: string, level = "INFO"): JsonlSpanEvent => ({
    name: message,
    offsetMs: 0,
    attrs: { "effect.fiberId": 1, "effect.logLevel": level },
});
