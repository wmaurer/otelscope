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
built. It needs `FileSystem` and `Path`, for example from `@effect/platform-node`:

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

## Failure behaviour

Tracing never fails the program. If the file cannot be written, the first failure prints one warning to
stderr and all further writes stop. A batch that cannot be decoded is reported on stderr and dropped.

## License

MIT
