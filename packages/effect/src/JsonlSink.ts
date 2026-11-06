import { Array as Arr, Console, Effect, FileSystem, Path, PlatformError, Ref } from "effect";

import { toLines } from "./format/Jsonl.ts";

import type { Body } from "./format/Bodies.ts";
import type { Sink } from "./Sink.ts";

export interface JsonlSinkOptions {
    // Created with its parent directories if missing. Each batch is appended, so an existing file is kept.
    readonly file: string;
    // The `run` value of every record this sink writes.
    readonly runId: string;
    readonly service: string;
    // `true` creates `bodies/` next to `file`, where each batch's bodies are stored as `<sha256>.txt`. The
    // spans arrive already slimmed.
    readonly bodies: boolean;
}

// Opens a sink that appends each batch of spans to `file`, one line per span. Its first write failure stops
// all further writes and prints one warning, because a run emits thousands of spans and one warning is enough.
//
// Unnamed, so that opening the sink adds no span to the trace it writes.
export const make = Effect.fn(function* (options: JsonlSinkOptions) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const bodiesDir = path.join(path.dirname(options.file), "bodies");

    const writing = yield* Ref.make(true);
    const stopWriting = (error: PlatformError.PlatformError) =>
        Effect.andThen(
            Ref.set(writing, false),
            Console.error(`otelscope: stopped writing ${options.file}: ${error.message}`),
        );

    yield* fs
        .makeDirectory(options.bodies ? bodiesDir : path.dirname(options.file), { recursive: true })
        .pipe(Effect.catch(stopWriting));

    // Content-addressed, so an identical body is stored once, also across runs that share the file.
    const writeBody = (body: Body) => {
        const file = path.join(bodiesDir, `${body.sha256}.txt`);
        return Effect.flatMap(fs.exists(file), (exists) =>
            exists ? Effect.void : fs.writeFileString(file, body.text),
        );
    };

    return {
        write: (batch) =>
            Effect.gen(function* () {
                if (batch.length === 0 || !(yield* Ref.get(writing))) {
                    return;
                }
                // Bodies first, so that no line refers to a body that is not on disk.
                yield* Effect.forEach(
                    Arr.flatMap(batch, (s) => s.bodies),
                    writeBody,
                    { discard: true },
                );
                yield* fs.writeFileString(
                    options.file,
                    toLines(
                        options.runId,
                        options.service,
                        Arr.map(batch, (s) => s.span),
                    ),
                    { flag: "a" },
                );
            }).pipe(Effect.catch(stopWriting)),
    } satisfies Sink;
});
