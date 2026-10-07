import { Console, Effect, FileSystem, Path, PlatformError, Ref } from "effect";

import { toLines } from "./Jsonl.ts";

import type { Span } from "./TraceData.ts";

export interface JsonlSinkOptions {
    // Created with its parent directories if missing. Each batch is appended, so an existing file is kept.
    readonly file: string;
    // The `run` value of every record this sink writes.
    readonly runId: string;
}

// Opens a sink that appends each batch of spans to `file`, one line per span. The returned writer never
// fails. Its first write failure stops all further writes and prints one warning, because a run emits
// thousands of spans and one warning is enough.
//
// Unnamed, so that opening the sink adds no span to the trace it writes.
export const make = Effect.fn(function* (options: JsonlSinkOptions) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const writing = yield* Ref.make(true);
    const stopWriting = (error: PlatformError.PlatformError) =>
        Effect.andThen(
            Ref.set(writing, false),
            Console.error(`otelscope: stopped writing ${options.file}: ${error.message}`),
        );

    yield* fs.makeDirectory(path.dirname(options.file), { recursive: true }).pipe(Effect.catch(stopWriting));

    return (spans: ReadonlyArray<Span>): Effect.Effect<void> =>
        Effect.flatMap(Ref.get(writing), (enabled) =>
            enabled && spans.length > 0
                ? fs
                      .writeFileString(options.file, toLines(options.runId, spans), { flag: "a" })
                      .pipe(Effect.catch(stopWriting))
                : Effect.void,
        );
});
