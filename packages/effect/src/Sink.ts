import type { SlimSpan } from "./format/Bodies.ts";
import type { Effect } from "effect";

// One destination of the tracer's spans. `write` never fails: each sink reports its own first failure on
// stderr, so that one sink's failure costs no other sink its spans.
export interface Sink {
    readonly write: (batch: ReadonlyArray<SlimSpan>) => Effect.Effect<void>;
}
