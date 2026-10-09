import { Array as Arr } from "effect";

import type { SpanId, Trace } from "../data/Snapshot.ts";

export const isPropagated = (trace: Trace, spanId: SpanId): boolean =>
    trace.spans.get(spanId)?.exit === "Failure" &&
    Arr.some(trace.children.get(spanId) ?? [], (child) => trace.spans.get(child)?.exit === "Failure");
