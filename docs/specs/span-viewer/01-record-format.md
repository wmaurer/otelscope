# 01 · Record format 0.3.0

`@wmaurer/otelscope-effect` goes from 0.2.0 to **0.3.0** in one release that carries every format change the viewer
needs, so readers see one break. It is built first and published before the viewer
([README](README.md#order-of-work)).

Sources: [Shape of the start-time field](../../../.wayfinder/span-viewer-tui/tickets/01-start-time-field.md),
[Data layer](../../../.wayfinder/span-viewer-tui/tickets/08-data-layer-design.md),
[Source locations](../../../.wayfinder/span-viewer-tui/tickets/11-source-locations.md),
[Run identity](../../../.wayfinder/span-viewer-tui/tickets/14-run-identity.md), and the assembly decisions in the
[README](README.md#settled-while-assembling).

## The record

Fields in this order (the writer emits them in this order; readers must not depend on it):

```ts
interface Location {
    readonly file: string; // absolute path; a `file://` URL is converted to a path
    readonly line: number;
    readonly col: number;
}

interface JsonlSpanEvent {
    readonly name: string;
    // Milliseconds from the span's `startMs`, to the microsecond. The event's wall-clock time is
    // `startMs + offsetMs`.
    readonly offsetMs: number;
    readonly attrs: Attributes;
}

interface JsonlSpanRecord {
    readonly run: string;
    // `service.name` of the program that wrote the record: the `serviceName` given to `JsonlTrace.layer`.
    readonly service: string;
    readonly trace: string;
    readonly span: string;
    readonly parent: string | null;
    readonly name: string;
    // Wall-clock start in milliseconds since the Unix epoch, to the microsecond (`1791295407070.068`).
    readonly startMs: number;
    // Duration in milliseconds, to the microsecond (`2.355`). Not an integer. The end is `startMs + ms`.
    readonly ms: number;
    readonly exit: "Success" | "Failure" | "Interrupted";
    // Where the span was opened: the call site of its `withSpan`, or of the call to an `Effect.fn`.
    // `null` when Effect captured none.
    readonly site: Location | null;
    // `Effect.fn` spans only: where the function is defined. `null` for every other span.
    readonly def: Location | null;
    // The id of the fiber the span was opened on, as `effect.fiberId` on its logs. `null` when the hook did not
    // see the span run.
    readonly fiber: number | null;
    readonly attrs: Attributes;
    readonly events: ReadonlyArray<JsonlSpanEvent>;
}
```

Every field is always present. `site`, `def` and `fiber` are `null` rather than absent, like `parent`. An empty
`service` is written as is (tracing never fails the program); the viewer shows it as `(unnamed)`.

### Times

OTLP times are nanosecond strings. They are rounded to whole microseconds in BigInt, which a double holds exactly,
and only then scaled to milliseconds:

```ts
const toMillis = (nanos: bigint): number => Number((nanos + 500n) / 1_000n) / 1_000;

const millisBetween = (startNanos: string, endNanos: string): number =>
    toMillis(BigInt(endNanos) - BigInt(startNanos));
```

`startMs` is `toMillis(BigInt(span.startTimeUnixNano))`. `ms` and every `offsetMs` use `millisBetween`. Tests that
assert whole-millisecond values change with it.

## The Schema

`packages/effect/src/format/Jsonl.ts` defines the format as Schemas and derives the interfaces from them. The writer
keeps working on the derived types; the viewer imports the Schemas from `@wmaurer/otelscope-effect/format`.

```ts
export type AttributeValue = string | number | boolean | null | ReadonlyArray<AttributeValue>;

export const AttributeValue: Schema.Codec<AttributeValue> = Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(Schema.suspend((): Schema.Codec<AttributeValue> => AttributeValue)),
]);

export const Attributes = Schema.Record(Schema.String, AttributeValue);
export type Attributes = typeof Attributes.Type;

export const Location = Schema.Struct({ file: Schema.String, line: Schema.Finite, col: Schema.Finite });
export type Location = typeof Location.Type;

export const JsonlSpanEvent = Schema.Struct({ name: Schema.String, offsetMs: Schema.Finite, attrs: Attributes });
export type JsonlSpanEvent = typeof JsonlSpanEvent.Type;

export const JsonlSpanRecord = Schema.Struct({
    run: Schema.String,
    service: Schema.String,
    trace: Schema.String,
    span: Schema.String,
    parent: Schema.NullOr(Schema.String),
    name: Schema.String,
    startMs: Schema.Finite,
    ms: Schema.Finite,
    exit: Schema.Literals(["Success", "Failure", "Interrupted"]),
    site: Schema.NullOr(Location),
    def: Schema.NullOr(Location),
    fiber: Schema.NullOr(Schema.Finite),
    attrs: Attributes,
    events: Schema.Array(JsonlSpanEvent),
});
export type JsonlSpanRecord = typeof JsonlSpanRecord.Type;
```

- Unknown keys are dropped on decode, so a newer writer's extra fields still decode. A later optional field is not
  a format break.
- `AttributeValue` admits `Number` (not `Finite`) because JSON cannot carry a non-finite number anyway.
- `format/index.ts` already re-exports `Jsonl.ts`, so the Schemas are public through `./format` and the main entry.

## Writer changes

### `toRecord`

`toRecord(runId, service, span)` takes the service, writes the fields above, and lifts the location and fiber
attributes out of `attrs`, so they do not appear twice:

| Attributes set by the hook                                                            | Lifted into |
| ------------------------------------------------------------------------------------- | ----------- |
| `code.file.path`, `code.line.number`, `code.column.number`                            | `site`      |
| `otelscope.def.file.path`, `otelscope.def.line.number`, `otelscope.def.column.number` | `def`       |
| `otelscope.fiber.id`                                                                  | `fiber`     |

A location is built only when all three of its attributes decode (string, finite, finite); otherwise it is `null`
and the attributes are still removed. `fiber` is `null` unless `otelscope.fiber.id` is a finite number.
`packages/effect/scripts/fixture/Writer03.ts` has a working `toRecord` and `location` for `site` and `def`; move them
into `src` and add `fiber`.

### `JsonlSink`

`JsonlSink.make({ file, runId, service, bodies })` takes `service` and passes it to `toLines`, which stamps it on
every record like `run`.

### The tracer hook

`JsonlTrace.layer` wraps the tracer `OtlpTracer.layer` installs in one with a `context` hook, exactly as `withSites`
in `Writer03.ts` does today, plus the fiber id. It lives in an internal `src/Sites.ts`, so the fixture generator
can reuse it:

```ts
const withSites = (inner: Tracer.Tracer): Tracer.Tracer => {
    const located = new WeakSet<Tracer.Span>();
    const fibered = new WeakSet<Tracer.Span>();
    return Tracer.make({
        span: (options) => inner.span(options),
        context: (primitive, fiber) => {
            const span = fiber.cache.span;
            if (span?._tag === "Span") {
                if (!fibered.has(span)) {
                    fibered.add(span);
                    span.attribute("otelscope.fiber.id", fiber.id);
                }
                const frame = fiber.cache.stackFrame;
                if (frame?.name === span.name && !located.has(span)) {
                    located.add(span);
                    try {
                        annotate(span, SITE, parseFrame(frame.stack()));
                        if (frame.parent?.name === `${span.name} (definition)`) {
                            annotate(span, DEF, parseFrame(frame.parent.stack()));
                        }
                    } catch {
                        // A span without a location is fine; failing the program is not.
                    }
                }
            }
            return primitive["~effect/Effect/evaluate"](fiber);
        },
    });
};
```

- The first primitive evaluated with a span as `fiber.cache.span` runs on the fiber that opened it, so its
  `fiber.id` is the span's fiber. It equals the `effect.fiberId` Effect's logger puts on log events.
- A frame is parsed once, by the writer, so the viewer never parses stack strings for spans. Two forms occur:
  `at <anonymous> (/abs/path.ts:32:40)` (tsx, CommonJS) and `at file:///abs/path.mjs:32:40` (Node ESM). The
  function name is dropped. `FRAME` and `parseFrame` in `Writer03.ts` handle both.
- Cost: about 6 µs per span, 12 µs for an `Effect.fn` span. Always on; no option.
- The hook never fails the program.

The layer composition is `Writer03.ts`'s: `Layer.effect(Tracer.Tracer, Effect.map(Tracer.Tracer, withSites))`
provided with the OTLP layer.

### Export interval

`OtlpTracer.layer` gets `exportInterval: "1 second"` (Effect's default is 5 s). Writes are local appends, so the
cost is negligible, spans reach a live viewer within about a second, and the viewer's 5-second live window covers
several batches instead of flickering between them. Keep `shutdownTimeout: "30 seconds"`.

### What leaves `site` and `def` at `null`

Documented in the README, not configurable:

- `captureStackTrace: false` in a span's options turns capture off for that span. Effect sets it on its own HTTP
  client, RPC, SQL, AI and workflow spans, so those never have a location.
- `Error.stackTraceLimit = 0` turns it off for the process, which also avoids the cost.
- Positions are what Node's stack traces report: TypeScript positions under tsx or `--enable-source-maps`, compiled
  JavaScript positions otherwise.

## Package changes

- `"version": "0.3.0"`.
- `"engines": { "node": ">=22.18" }`: the library's promise to npm users, now that the root moves to 26.
- **Source export condition.** Each `exports` entry gains a first condition naming the source file, which only this
  workspace asks for:

    ```json
    "exports": {
        ".": {
            "@otelscope/source": "./src/index.ts",
            "types": "./dist/index.d.ts",
            "default": "./dist/index.js"
        },
        "./format": {
            "@otelscope/source": "./src/format/index.ts",
            "types": "./dist/format/index.d.ts",
            "default": "./dist/format/index.js"
        }
    }
    ```

    `packages/tui` sets `customConditions: ["@otelscope/source"]` in its tsconfig and `resolve.conditions` in its
    vitest config ([02-package.md](02-package.md)). npm users never set the condition, so they get `dist/`. `src/` is
    already in `files`.

## Tests (`packages/effect/test`)

- `startMs`, `ms` and `offsetMs` to the microsecond, including the rounding (a nanosecond value ending in `500`
  rounds up).
- `service` stamped on every record.
- `site`, `def` and `fiber` lifted out of `attrs` and absent from it; a partial location gives `null`.
- The hook: a `withSpan` span has `site`; an `Effect.fn` span has `site` and `def`; a span with
  `captureStackTrace: false` has neither; `fiber` matches the `effect.fiberId` of a log in the span; a forked child
  span has its own fiber.
- The hook never throws into the program, even when `frame.stack()` throws.
- `JsonlSpanRecord` decodes every line the writer produces, rejects a 0.2-shaped line, and drops unknown keys.
- `exportInterval` is passed (assert on the layer's options or observe two batches about a second apart under
  `TestClock`).

## README (`packages/effect/README.md`)

- **Record format**: the interface above, with `startMs`, `ms` and `offsetMs` described as milliseconds to the
  microsecond, and a short paragraph each on `service`, `site`/`def` (with the three switches above) and `fiber`.
- **Changes in 0.3**: `ms` is no longer an integer; `startMs`, `service`, `site`, `def` and `fiber` are new; records
  without `startMs` come from earlier versions; spans are written about every second.
- **Reading the format**: names the `JsonlSpanRecord` Schema and shows a decode:
  `Schema.decodeUnknownExit(JsonlSpanRecord)(JSON.parse(line))`.
- **View the file**: one line, `npx @wmaurer/otelscope traces/spans.jsonl`.

## Fixture generator

Once 0.3.0 is built:

- The generator keeps its own writer layer, because it needs four things `JsonlTrace.layer` should not offer: the
  exporter on the live clock while the program runs on virtual time, a single export at shutdown, `normalise` applied
  to each record before it is written, and `hold` around each write so virtual time stands still during file I/O
  (without it, spans are dropped at shutdown). Rename `Writer03.ts` to `FixtureWriter.ts` and build its layer from
  0.3.0's own pieces in `src`: `toRecord`, `slimSpan`, `spansOf`, `ReceiverClient` and the tracer hook (moved to
  an internal `src/Sites.ts`, not exported from the package entry points). Delete its copies of `toRecord`,
  `location`, `FRAME`, `parseFrame`, `withSites` and `Record03`, so the fixture can't drift from the real record.
- `makeNormaliser` also renumbers `fiber`, with the same map as `effect.fiberId`.
- Add `HUGE` to `scenarios.ts` (about `{ orders: 28_000, wideChildren: 10_000 }`, tuned on first generation so that
  250,000 ≤ spans < 260,000) and a `huge` argument writing the gitignored `packages/tui/test/fixtures/huge/`. Record
  the final order count and span count in [12-performance.md](12-performance.md#fixture). No argument still writes
  only `sample` and `large`.
- Regenerate `sample`; its bytes change (`fiber` is new). Regenerate the viewer's frame snapshots with it.
