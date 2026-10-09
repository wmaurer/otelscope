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
    Schema,
    Tracer,
} from "effect";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import {
    type Attributes,
    type AttributeValue,
    plainAttributes,
    slimSpan,
    type Span,
    spansOf,
} from "../../src/format/index.ts";
import * as ReceiverClient from "../../src/ReceiverClient.ts";

// A stand-in for `JsonlTrace.layer` as 0.3.0 will ship it, so the fixture has the 0.3.0 record format before
// that release is built: `service`, `startMs`, `site` and `def`, and `ms` and `offsetMs` to the microsecond.
// When 0.3.0 is built, the generator switches to `JsonlTrace.layer` and keeps only `normalise` from here.

interface Location {
    readonly file: string;
    readonly line: number;
    readonly col: number;
}

export interface Record03 {
    readonly run: string;
    readonly service: string;
    readonly trace: string;
    readonly span: string;
    readonly parent: string | null;
    readonly name: string;
    readonly startMs: number;
    readonly ms: number;
    readonly exit: "Success" | "Failure" | "Interrupted";
    readonly site: Location | null;
    readonly def: Location | null;
    readonly attrs: Attributes;
    readonly events: ReadonlyArray<{ readonly name: string; readonly offsetMs: number; readonly attrs: Attributes }>;
}

const SITE = ["code.file.path", "code.line.number", "code.column.number"] as const;
const DEF = ["otelscope.def.file.path", "otelscope.def.line.number", "otelscope.def.column.number"] as const;

// `at <anonymous> (/abs/path.ts:32:40)` under tsx, `at file:///abs/path.mjs:32:40` under plain Node ESM.
const FRAME = /^\s*at (?:.*? \()?(?:file:\/\/)?(\/[^)]+?):(\d+):(\d+)\)?\s*$/m;

const parseFrame = (stack: string | undefined): Location | undefined => {
    const match = stack === undefined ? null : FRAME.exec(stack);
    return match === null
        ? undefined
        : { file: decodeURI(match[1] ?? ""), line: Number(match[2]), col: Number(match[3]) };
};

const annotate = (span: Tracer.Span, keys: typeof SITE | typeof DEF, location: Location | undefined): void => {
    if (location === undefined) return;
    span.attribute(keys[0], location.file);
    span.attribute(keys[1], location.line);
    span.attribute(keys[2], location.col);
};

// Wraps `inner` with the `context` hook from "Source locations": Effect calls it for every primitive, and the
// first primitive evaluated inside a new span carries that span's call site as the fiber's stack frame.
const withSites = (inner: Tracer.Tracer): Tracer.Tracer => {
    const seen = new WeakSet<Tracer.Span>();
    return Tracer.make({
        span: (options) => inner.span(options),
        context: (primitive, fiber) => {
            const span = fiber.cache.span;
            const frame = fiber.cache.stackFrame;
            if (span?._tag === "Span" && frame?.name === span.name && !seen.has(span)) {
                seen.add(span);
                try {
                    annotate(span, SITE, parseFrame(frame.stack()));
                    if (frame.parent?.name === `${span.name} (definition)`) {
                        annotate(span, DEF, parseFrame(frame.parent.stack()));
                    }
                } catch {
                    // A span without a location is fine; failing the program is not.
                }
            }
            return primitive["~effect/Effect/evaluate"](fiber);
        },
    });
};

const STATUS_ERROR = 2;

const toMillis = (nanos: bigint): number => Number((nanos + 500n) / 1_000n) / 1_000;

const millisBetween = (startNanos: string, endNanos: string): number => toMillis(BigInt(endNanos) - BigInt(startNanos));

const decodeLocation = Schema.decodeUnknownOption(Schema.Tuple([Schema.String, Schema.Finite, Schema.Finite]));

const location = (attrs: Attributes, keys: typeof SITE | typeof DEF): Location | null =>
    Option.match(decodeLocation(Arr.map(keys, (key) => attrs[key])), {
        onNone: () => null,
        onSome: ([file, line, col]) => ({ file, line, col }),
    });

const toRecord = (run: string, service: string, span: Span): Record03 => {
    const all = plainAttributes(span.attributes);
    const lifted: ReadonlyArray<string> = [...SITE, ...DEF];
    const attrs = Record.filter(all, (_, key) => !Arr.contains(lifted, key));
    return {
        run,
        service,
        trace: span.traceId,
        span: span.spanId,
        parent: span.parentSpanId ?? null,
        name: span.name,
        startMs: toMillis(BigInt(span.startTimeUnixNano)),
        ms: millisBetween(span.startTimeUnixNano, span.endTimeUnixNano),
        exit:
            span.status.code === STATUS_ERROR
                ? "Failure"
                : attrs["status.interrupted"] === true
                  ? "Interrupted"
                  : "Success",
        site: location(all, SITE),
        def: location(all, DEF),
        attrs,
        events: Arr.map(span.events, (event) => ({
            name: event.name,
            offsetMs: millisBetween(span.startTimeUnixNano, event.timeUnixNano),
            attrs: plainAttributes(event.attributes),
        })),
    };
};

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

    return (record: Record03): Record03 => ({
        ...record,
        run: renumber("run", record.run, runId(record.startMs)),
        trace: renumber("trace", record.trace, hexId("trace", 32)),
        span: renumber("span", record.span, hexId("span", 16)),
        parent: record.parent === null ? null : renumber("span", record.parent, hexId("span", 16)),
        site: at(record.site),
        def: at(record.def),
        attrs: attributes(record.attrs),
        events: Arr.map(record.events, (event) => ({ ...event, attrs: attributes(event.attrs) })),
    });
};

export interface Options {
    readonly file: string;
    readonly service: string;
    readonly run: string;
    readonly normalise: (record: Record03) => Record03;
    // The live clock, read before the program was given virtual time.
    readonly liveClock: Clock.Clock;
    // Wraps each write, so virtual time stands still while it runs (see `VirtualTime`).
    readonly hold: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

const RECEIVER_URL = "http://otelscope.invalid/v1/traces";

// What `JsonlTrace.layer` does, with the 0.3.0 record and two changes the fixture needs:
// - the exporter runs on the live clock (see `VirtualTime`);
// - it exports once, at shutdown, so no file I/O interleaves with the program while it runs.
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
            return Layer.effect(
                Tracer.Tracer,
                Effect.gen(function* () {
                    return withSites(yield* Tracer.Tracer);
                }),
            ).pipe(Layer.provide(otlp));
        }),
    );
