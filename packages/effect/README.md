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
| `serviceName` | The OTLP resource service name.                                                                                     |
| `file`        | The JSONL file. Created with its parent directories if missing; each batch is appended.                             |
| `runId`       | Optional. The `run` value of every record. Defaults to a sortable timestamp such as `2026-10-06T14-03-27-412-9f3a`. |
| `bodies`      | Optional. `true` moves the text of every `.body` attribute to a file in `bodies/`. See [Bodies](#bodies).           |

Because batches are appended, several runs can share one file and stay apart by `run`.

## Record format

Each line is a `JsonlSpanRecord`:

```ts
interface JsonlSpanRecord {
    run: string;
    trace: string;
    span: string;
    parent: string | null;
    name: string;
    ms: number; // duration in whole milliseconds
    exit: "Success" | "Failure" | "Interrupted";
    attrs: Record<string, AttributeValue>;
    events: Array<{ name: string; offsetMs: number; attrs: Record<string, AttributeValue> }>;
}
```

Every `Effect.log*` call made inside a span is recorded as an event on it, with `offsetMs` measured from the
start of the span.

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
reads the JSONL file: `JsonlSpanRecord` and its parts, the OTLP `TraceData` schema, and the bodies convention
(`slimSpan`, `SlimSpan`, `BODY_SUFFIX`). The main entry re-exports the same names.

```ts
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";
```

## Failure behaviour

Tracing never fails the program. If the file or a body cannot be written, the first failure prints one
warning to stderr and all further writes stop. A batch that cannot be decoded is reported on stderr and dropped.

## License

MIT
