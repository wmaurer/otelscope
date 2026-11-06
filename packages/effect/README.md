# @wmaurer/otelscope-effect

Write the spans of an [Effect](https://effect.website) program to a JSONL file, to an OTLP collector, or to both.

`OtelscopeTracer.layer` installs Effect's OTLP tracer. When you name a file, every span is appended to it as one
JSON line. When the standard `OTEL_*` variables name a collector, every span is also sent there. The file and the
collector are each optional.

## Install

```sh
pnpm add @wmaurer/otelscope-effect effect
```

`effect` (4.1 or later) is a peer dependency.

## Usage

Provide `OtelscopeTracer.layer` as the outermost layer, so the tracer is installed before any other layer is
built. It needs `FileSystem` and `Path`, which `NodeServices.layer` from `@effect/platform-node` provides, and an
`HttpClient`, which it uses only when the environment names a collector. A program that writes only the file
still provides one, for example `FetchHttpClient.layer`:

```ts
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtelscopeTracer } from "@wmaurer/otelscope-effect";

const program = Effect.log("hello").pipe(Effect.withSpan("greet"));

program.pipe(
    Effect.provide(OtelscopeTracer.layer({ serviceName: "my-app", file: "traces/spans.jsonl" })),
    Effect.provide([NodeServices.layer, FetchHttpClient.layer]),
    Effect.runPromise,
);
```

### Where spans go

| `file` option | Collector variables | Spans go to                                |
| ------------- | ------------------- | ------------------------------------------ |
| set           | not set             | the file                                   |
| not set       | set                 | the collector                              |
| set           | set                 | the file and the collector, with equal ids |
| not set       | not set             | nowhere. The layer installs no tracer.     |

With neither, Effect's native tracer stays, as with `OtlpTracer.layerFromConfig` when tracing is off. This is a
normal setup, so nothing is printed.

### Options

| Option        | Description                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `serviceName` | The OTLP resource service name, and the `service` value of every record.                                                |
| `file`        | Optional. The JSONL file. Created with its parent directories if missing; each batch is appended.                       |
| `runId`       | Optional. The `run` value of every record. Defaults to a sortable timestamp such as `2026-10-06T14-03-27-412-9f3a`.     |
| `bodies`      | Optional. `true` replaces every `.body` attribute by a reference, in the file and the collector. See [Bodies](#bodies). |

Because batches are appended, several runs can share one file and stay apart by `run`.

### The collector

The collector is configured only from the environment, with the rules of `OtlpTracer.layerFromConfig` in
Effect 4.1:

- Spans are sent only when `OTEL_TRACES_EXPORTER` lists `otlp`. **Effect's default is an empty list**, while the
  OpenTelemetry default is `otlp`. To send whenever an endpoint is set, add that default under your
  configuration with
  `Effect.provide(ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ OTEL_TRACES_EXPORTER: "otlp" })))`.
- `OTEL_SDK_DISABLED=true` turns the collector off.
- The endpoint is `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` as given, or else `OTEL_EXPORTER_OTLP_ENDPOINT` with
  `/v1/traces` appended. It must be an `http` or `https` URL, so `localhost:4318` is rejected.
- Headers come from `OTEL_EXPORTER_OTLP_TRACES_HEADERS`, or else `OTEL_EXPORTER_OTLP_HEADERS`, as
  percent-encoded `key=value` pairs separated by commas.
- Compression comes from `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION`, or else `OTEL_EXPORTER_OTLP_COMPRESSION`. It is
  `gzip` or `none`, and the default is `none`. A batch under 1 KB is sent uncompressed.
- `OTEL_BSP_SCHEDULE_DELAY` sets the export interval in milliseconds (default 5000), and
  `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` the largest batch (default 1000).
- `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`, or else `OTEL_EXPORTER_OTLP_TIMEOUT`, bounds each request in milliseconds
  (default 10000). The same value, or else `OTEL_BSP_EXPORT_TIMEOUT`, bounds the final flush (default 3000).
- `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` are merged into the resource as Effect merges them. The
  `serviceName` option wins over `OTEL_SERVICE_NAME`.

Spans are sent as OTLP/HTTP protobuf, with Effect's batching, retries and final flush. Two rules are stricter
than Effect's. An endpoint that is not http or https turns the collector off, where Effect would post to it. A
variable that is set but invalid also turns the collector off, where Effect dies while building its layer. Each
prints one line on stderr. An invalid `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_HEADERS`
is the exception. As in Effect, the base variable is used instead, without a line.

## Record format

Each line is a `JsonlSpanRecord`. The writer emits the fields in this order, but a reader must not depend on the
order:

```ts
interface JsonlSpanRecord {
    run: string;
    service: string;
    trace: string;
    span: string;
    parent: string | null;
    name: string;
    startMs: number; // wall-clock start, milliseconds since the Unix epoch, to the microsecond
    ms: number; // duration in milliseconds, to the microsecond
    exit: "Success" | "Failure" | "Interrupted";
    site: Location | null;
    def: Location | null;
    fiber: number | null;
    attrs: Record<string, AttributeValue>;
    events: Array<{ name: string; offsetMs: number; attrs: Record<string, AttributeValue> }>;
}

interface Location {
    file: string; // absolute path
    line: number;
    col: number;
}
```

Every field is always present. `parent`, `site`, `def` and `fiber` are `null` when they have no value.

`startMs` is a wall-clock time, such as `1791295407070.068`. `ms` is a duration, such as `2.355`, so the span ends at
`startMs + ms`. Both are exact to the microsecond.

Every `Effect.log*` call made inside a span is recorded as an event on it. An event's `offsetMs` is measured from
the span's `startMs`, to the microsecond.

`service` is the `serviceName` given to `OtelscopeTracer.layer`. An empty `serviceName` is written as an empty string.

`site` is where the span was opened: the call to `Effect.withSpan`, or the call to a function made with `Effect.fn`.
`def` is set only for an `Effect.fn` span, and is where that function is defined. Both come from the stack trace
that Effect captures when the span opens, and are `null` when Effect captured none:

- `captureStackTrace: false` in a span's options turns capture off for that span. Effect sets it on its own HTTP
  client, RPC, SQL, AI and workflow spans, so those spans never have a location.
- `Error.stackTraceLimit = 0` turns capture off for the whole process, and also saves its cost.
- A position is what Node's stack trace reports. Under `tsx` or `--enable-source-maps` that is the TypeScript
  position. Otherwise it is the position in the compiled JavaScript.

`fiber` is the id of the fiber that opened the span. It is the same number as `effect.fiberId` on the span's log
events. It is `null` when no fiber ran with the span as its current span.

### Changes in 0.5

- `JsonlTrace` is now `OtelscopeTracer`, with the same options and `makeRunId`. `file` is optional.
- The layer also sends spans to the collector named by the `OTEL_*` variables. It therefore needs an
  `HttpClient`, even when only the file is written.
- With neither a file nor a collector, the layer installs no tracer.
- With `bodies: true`, the collector receives the `.sha256`, `.bytes` and `.preview` attributes instead of the text.
- `JsonlSink` and `ReceiverClient` are no longer exported. A program that built its own tracer from them to
  also reach a collector can use `OtelscopeTracer.layer` instead.
- A span with a `NaN` or infinite number attribute no longer makes its whole batch undecodable. The record
  writes such a value as `null`. `AnyValue` decodes the strings `"NaN"`, `"Infinity"` and `"-Infinity"` that
  Effect 4.1 writes, and its encoded type is the new `AnyValueEncoded`.

### Changes in 0.4

- `effect` 4.1 or later is required. 4.1 removed the `Crypto` service that 0.3 imports, so 0.3 fails at import
  under 4.1.
- `JsonlTrace.layer` and `JsonlSink.make` no longer need `Crypto`, only `FileSystem` and `Path`. `slimSpan` needs
  `Digest` from `effect/crypto`.
- An interrupted span carries Effect's `effect.fiber.interrupted` attribute instead of `span.label` and
  `status.interrupted`. Its `exit` is still `Interrupted`.

### Changes in 0.3.1

- `withSites` is exported, for a program that builds its own tracer.

### Changes in 0.3

- `ms` is no longer a whole number. It is exact to the microsecond, as are `offsetMs` and the new `startMs`.
- `startMs`, `service`, `site`, `def` and `fiber` are new. A record without `startMs` comes from an earlier version.
- Spans are written about every second. Earlier versions wrote them every five seconds.

## Bodies

A prompt or a payload can be far too large for a trace viewer to show as an attribute. Give it a key that ends
in `.body`, such as `llm.request.body`, and pass `bodies: true`:

```ts
OtelscopeTracer.layer({ serviceName: "my-app", file: "traces/spans.jsonl", bodies: true });
```

Each `<prefix>.body` attribute is then replaced in the record by three attributes:

| Attribute          | Value                                   |
| ------------------ | --------------------------------------- |
| `<prefix>.sha256`  | The SHA-256 of the stored text, as hex. |
| `<prefix>.bytes`   | The UTF-8 length of the full text.      |
| `<prefix>.preview` | The first 200 characters.               |

The text itself is written to `bodies/<sha256>.txt`, in the directory of the JSONL file. It is written before
the line that refers to it, and an identical body is stored only once, also across runs that share the file.
A body over 1,000,000 characters is truncated before it is stored, so for such a body `sha256` addresses the
truncated text while `bytes` measures the full one.

A collector receives the same three attributes instead of the text. With no file, the text is dropped.

Without `bodies: true`, `.body` attributes stay inline like any other attribute, in the file and the collector.

## Reading the format

`@wmaurer/otelscope-effect/format` exports the record format without the writer's layers, for a program that
reads the JSONL file. It exports the `JsonlSpanRecord` Schema and its parts, the OTLP `TraceData` schema, and the
bodies convention (`slimSpan`, `SlimSpan`, `BODY_SUFFIX`). The main entry re-exports the same names.

Decode each line with the `JsonlSpanRecord` Schema. `Schema.fromJsonString` parses the JSON as part of the
decode, so a line that is not valid JSON gives a failure instead of a thrown `SyntaxError`:

```ts
import { Schema } from "effect";
import { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const decodeLine = Schema.decodeUnknownExit(Schema.fromJsonString(JsonlSpanRecord));

const record = decodeLine(line);
```

Decoding drops keys the Schema does not know, so a line from a newer version with extra fields still decodes.

## View the file

[`@wmaurer/otelscope`](https://www.npmjs.com/package/@wmaurer/otelscope) is a terminal viewer for the file. It needs
Node >= 26.9.

```sh
npx @wmaurer/otelscope traces/spans.jsonl
```

## Failure behaviour

Tracing never fails the program. Each problem below prints one line on stderr, once per process, and costs only
its own sink:

- The file or a body cannot be written. Writes to the file stop. The collector still receives every span.
- A collector variable is set but invalid, or the endpoint is not an http or https URL. The collector is off. The
  file is not affected.
- The collector answers an error or does not answer in time. Effect's exporter retries a transient failure up to
  three times, and after a failed export it pauses for 60 seconds and drops what it buffered. The file is not
  affected. The line is printed on the first failure, so it can appear for an error that a retry then recovers
  from.

A batch that cannot be decoded is reported on stderr and dropped.

## License

MIT
