# @wmaurer/otelscope-effect

Write the spans of an [Effect](https://effect.website) program to a JSONL file.

`JsonlTrace.layer` installs Effect's OTLP tracer and answers its export requests in process, so no collector
or network is involved. Every exported span is appended to the file as one JSON line.

## Install

```sh
pnpm add @wmaurer/otelscope-effect effect
```

`effect` (v4) is a peer dependency.

## Usage

Provide `JsonlTrace.layer` as the outermost layer, so the tracer is installed before any other layer is
built. It needs `FileSystem`, `Path` and `Crypto`, which `NodeServices.layer` from `@effect/platform-node`
provides:

```ts
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { JsonlTrace } from "@wmaurer/otelscope-effect";

const program = Effect.log("hello").pipe(Effect.withSpan("greet"));

program.pipe(
    Effect.provide(JsonlTrace.layer({ serviceName: "my-app", file: "traces/spans.jsonl" })),
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
);
```

### Options

| Option        | Description                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `serviceName` | The OTLP resource service name, and the `service` value of every record.                                            |
| `file`        | The JSONL file. Created with its parent directories if missing; each batch is appended.                             |
| `runId`       | Optional. The `run` value of every record. Defaults to a sortable timestamp such as `2026-10-06T14-03-27-412-9f3a`. |
| `bodies`      | Optional. `true` moves the text of every `.body` attribute to a file in `bodies/`. See [Bodies](#bodies).           |

Because batches are appended, several runs can share one file and stay apart by `run`.

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

`service` is the `serviceName` given to `JsonlTrace.layer`. An empty `serviceName` is written as an empty string.

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

### Changes in 0.3

- `ms` is no longer a whole number. It is exact to the microsecond, as are `offsetMs` and the new `startMs`.
- `startMs`, `service`, `site`, `def` and `fiber` are new. A record without `startMs` comes from an earlier version.
- Spans are written about every second. Earlier versions wrote them every five seconds.

## Bodies

A prompt or a payload can be far too large for a trace viewer to show as an attribute. Give it a key that ends
in `.body`, such as `llm.request.body`, and pass `bodies: true`:

```ts
JsonlTrace.layer({ serviceName: "my-app", file: "traces/spans.jsonl", bodies: true });
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

Without `bodies: true`, `.body` attributes stay inline like any other attribute.

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

Tracing never fails the program. If the file or a body cannot be written, the first failure prints one
warning to stderr and all further writes stop. A batch that cannot be decoded is reported on stderr and dropped.

## License

MIT
