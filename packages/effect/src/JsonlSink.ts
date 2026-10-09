import { Array as Arr, Console, Crypto, Effect, FileSystem, Path, PlatformError, Ref } from "effect";

import { type Body, type SlimSpan, slimSpan } from "./format/Bodies.ts";
import { toLines } from "./format/Jsonl.ts";

import type { Span } from "./format/TraceData.ts";

export interface JsonlSinkOptions {
    // Created with its parent directories if missing. Each batch is appended, so an existing file is kept.
    readonly file: string;
    // The `run` value of every record this sink writes.
    readonly runId: string;
    readonly service: string;
    // `true` moves the text of every `<prefix>.body` attribute to `bodies/<sha256>.txt` next to `file`, and
    // replaces the attribute with `<prefix>.sha256`, `<prefix>.bytes` and `<prefix>.preview`. Otherwise the
    // text stays inline in the record.
    readonly bodies?: boolean | undefined;
}

// Opens a sink that appends each batch of spans to `file`, one line per span. The returned writer never
// fails. Its first write failure stops all further writes and prints one warning, because a run emits
// thousands of spans and one warning is enough.
//
// Unnamed, so that opening the sink adds no span to the trace it writes.
export const make = Effect.fn(function* (options: JsonlSinkOptions) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The writer runs in the exporter's fiber, which does not carry the services this sink is opened with.
    const context = yield* Effect.context<Crypto.Crypto>();
    const bodiesDir = path.join(path.dirname(options.file), "bodies");

    const writing = yield* Ref.make(true);
    const stopWriting = (error: PlatformError.PlatformError) =>
        Effect.andThen(
            Ref.set(writing, false),
            Console.error(`otelscope: stopped writing ${options.file}: ${error.message}`),
        );

    yield* fs
        .makeDirectory(options.bodies === true ? bodiesDir : path.dirname(options.file), { recursive: true })
        .pipe(Effect.catch(stopWriting));

    // Content-addressed, so an identical body is stored once, also across runs that share the file.
    const writeBody = (body: Body) => {
        const file = path.join(bodiesDir, `${body.sha256}.txt`);
        return Effect.flatMap(fs.exists(file), (exists) =>
            exists ? Effect.void : fs.writeFileString(file, body.text),
        );
    };

    return (spans: ReadonlyArray<Span>): Effect.Effect<void> =>
        Effect.gen(function* () {
            if (spans.length === 0 || !(yield* Ref.get(writing))) {
                return;
            }
            const slim: ReadonlyArray<SlimSpan> =
                options.bodies === true
                    ? yield* Effect.forEach(spans, (span) => slimSpan(span))
                    : Arr.map(spans, (span) => ({ span, bodies: [] }));
            // Bodies first, so that no line refers to a body that is not on disk.
            yield* Effect.forEach(
                Arr.flatMap(slim, (s) => s.bodies),
                writeBody,
                { discard: true },
            );
            yield* fs.writeFileString(
                options.file,
                toLines(
                    options.runId,
                    options.service,
                    Arr.map(slim, (s) => s.span),
                ),
                { flag: "a" },
            );
        }).pipe(Effect.catch(stopWriting), Effect.provideContext(context));
});
