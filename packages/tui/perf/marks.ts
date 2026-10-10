import { Schema } from "effect";

/** What perf/startup.ts prints: `process.hrtime` marks, and memory after a full index under `--no-follow`. */
export const Marks = Schema.Struct({
    firstFrame: Schema.BigIntFromString,
    firstRows: Schema.BigIntFromString,
    indexed: Schema.optional(
        Schema.Struct({ done: Schema.BigIntFromString, heapUsed: Schema.Finite, rss: Schema.Finite }),
    ),
});

export type Marks = typeof Marks.Type;

export const MarksJson = Schema.fromJsonString(Marks);
