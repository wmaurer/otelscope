import {
    Array as Arr,
    Clock,
    Crypto,
    DateTime,
    Effect,
    FileSystem,
    Layer,
    MutableHashMap,
    Option,
    Path,
    Predicate,
    Record,
    Tracer,
} from "effect";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import {
    type Attributes,
    type AttributeValue,
    type JsonlSpanRecord,
    type Location,
    slimSpan,
    type Span,
    spansOf,
    toRecord,
} from "../../src/format/index.ts";
import * as ReceiverClient from "../../src/ReceiverClient.ts";
import { withSites } from "../../src/Sites.ts";

// Makes the fixture byte-stable across regenerations. Times are already fixed by `VirtualTime`. What is left:
// - trace, span and run ids, and fiber ids, are random or process-global, so they are renumbered in order of
//   first appearance;
// - absolute paths, in `site`, `def`, stack traces and causes, are made relative to the repo root.
export const makeNormaliser = (repoRoot: string) => {
    const ids = {
        run: MutableHashMap.empty<string, string>(),
        trace: MutableHashMap.empty<string, string>(),
        span: MutableHashMap.empty<string, string>(),
        fiber: MutableHashMap.empty<string, string>(),
    };
    const renumber = (kind: keyof typeof ids, id: string, make: (n: number) => string): string =>
        Option.getOrElse(MutableHashMap.get(ids[kind], id), () => {
            const fresh = make(MutableHashMap.size(ids[kind]) + 1);
            MutableHashMap.set(ids[kind], id, fresh);
            return fresh;
        });
    // Ids that look like real ones, so a screenshot taken from the fixture looks like a real trace.
    const hexId = (kind: string, length: number) => (n: number) => {
        let state = (n * 0x9e3779b1) ^ kind.length;
        let out = "";
        while (out.length < length) {
            state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
            out += state.toString(16).padStart(8, "0");
        }
        return out.slice(0, length);
    };
    const prefixes = [`file://${repoRoot}/`, `${repoRoot}/`];
    const relative = (text: string): string =>
        Arr.reduce(prefixes, text, (acc, prefix) => acc.replaceAll(prefix, "")).replace(
            /fiber #(\d+)/gi,
            (whole, id: string) => whole.replace(id, fiberId(id)),
        );
    const fiberId = (id: string): string => renumber("fiber", id, String);
    const value = (v: AttributeValue): AttributeValue =>
        Predicate.isString(v)
            ? relative(v)
            : Predicate.isNumber(v) || Predicate.isBoolean(v) || v === null
              ? v
              : Arr.map(v, value);
    const attributes = (attrs: Attributes): Attributes =>
        Record.map(attrs, (v, key) =>
            key === "effect.fiberId" && Predicate.isNumber(v) ? Number(fiberId(String(v))) : value(v),
        );
    const runId = (startMs: number) => (n: number) =>
        `${DateTime.formatIso(DateTime.makeUnsafe(Math.floor(startMs)))
            .replace(/[:.]/g, "-")
            .replace(/Z$/, "")}-${n.toString(16).padStart(4, "0")}`;
    const at = (loc: Location | null): Location | null => (loc === null ? null : { ...loc, file: relative(loc.file) });

    return (record: JsonlSpanRecord): JsonlSpanRecord => ({
        ...record,
        run: renumber("run", record.run, runId(record.startMs)),
        trace: renumber("trace", record.trace, hexId("trace", 32)),
        span: renumber("span", record.span, hexId("span", 16)),
        parent: record.parent === null ? null : renumber("span", record.parent, hexId("span", 16)),
        site: at(record.site),
        def: at(record.def),
        fiber: record.fiber === null ? null : Number(fiberId(String(record.fiber))),
        attrs: attributes(record.attrs),
        events: Arr.map(record.events, (event) => ({ ...event, attrs: attributes(event.attrs) })),
    });
};

export interface Options {
    readonly file: string;
    readonly service: string;
    readonly run: string;
    readonly normalise: (record: JsonlSpanRecord) => JsonlSpanRecord;
    // The live clock, read before the program was given virtual time.
    readonly liveClock: Clock.Clock;
    // Wraps each write, so virtual time stands still while it runs (see `VirtualTime`).
    readonly hold: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

const RECEIVER_URL = "http://otelscope.invalid/v1/traces";

// `JsonlTrace.layer` built from the same pieces, with what the fixture needs and that layer should not offer:
// - the exporter runs on the live clock (see `VirtualTime`);
// - it exports once, at shutdown, so no file I/O interleaves with the program while it runs;
// - each record is normalised before it is written;
// - each write is held, so virtual time stands still during file I/O. Without it, spans are dropped at shutdown.
export const layer = (options: Options): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path | Crypto.Crypto> =>
    Layer.unwrap(
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            // The writer runs in the exporter's fiber, which does not carry the services this layer is built with.
            const context = yield* Effect.context<Crypto.Crypto>();
            const bodiesDir = path.join(path.dirname(options.file), "bodies");
            yield* Effect.orDie(fs.makeDirectory(bodiesDir, { recursive: true }));

            const write = (spans: ReadonlyArray<Span>) =>
                Effect.gen(function* () {
                    const slim = yield* Effect.forEach(spans, (span) => slimSpan(span));
                    for (const body of Arr.flatMap(slim, (s) => s.bodies)) {
                        yield* fs.writeFileString(path.join(bodiesDir, `${body.sha256}.txt`), body.text);
                    }
                    const lines = Arr.map(
                        slim,
                        (s) => `${JSON.stringify(options.normalise(toRecord(options.run, options.service, s.span)))}\n`,
                    );
                    yield* fs.writeFileString(options.file, Arr.join(lines, ""), { flag: "a" });
                }).pipe(Effect.orDie, Effect.provideContext(context), options.hold);

            const otlp = OtlpTracer.layer({
                url: RECEIVER_URL,
                resource: { serviceName: options.service },
                exportInterval: "1 hour",
                maxBatchSize: 1_000_000,
                shutdownTimeout: "5 minutes",
            }).pipe(
                Layer.provide(OtlpSerialization.layerJson),
                Layer.provide(ReceiverClient.layer((data) => write(spansOf(data)))),
                Layer.provide(Layer.succeed(Clock.Clock, options.liveClock)),
            );
            return Layer.effect(Tracer.Tracer, Effect.map(Tracer.Tracer, withSites)).pipe(Layer.provide(otlp));
        }),
    );
