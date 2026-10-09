# Format entry

`@wmaurer/otelscope-effect/format` exports the record format without the writer's layers, for programs that
read the JSONL file: the `JsonlSpanRecord` Schema and its parts, the OTLP `TraceData` schema, and the bodies
convention (`BODY_SUFFIX`, `slimSpan`, `SlimSpan`). A reader built on it can decode every line and resolve each
body reference to its file.

## Sub-features

- `format-resolve` resolves the `/format` subpath through the exports map.
- `format-parse` decodes every line with the `JsonlSpanRecord` Schema, as README.md shows.
- `format-bodies` finds `bodies/<sha256>.txt` for every `<prefix>.sha256` attribute.

## How to get to it (user POV)

- `import { BODY_SUFFIX, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format"`, then
  `Schema.decodeUnknownExit(JsonlSpanRecord)(JSON.parse(line))`.

## Driving it with drive.sh

Preconditions:

- `$V/doctor.sh` prints `doctor: OK`, including the `/format` line.
- A bodies run exists. Run `$V/drive.sh bodies $V/programs/bodies.ts` if not.

- **Read the bodies output.** Run
  `OTELSCOPE_FILE="$PWD/<bodies run>/out/spans.jsonl" $V/drive.sh read-format $V/programs/read-format.ts`.
  `exit.txt` is `0` and `stderr.txt` is empty. A line that does not decode makes the program throw, naming the
  line, and exit non-zero.
- **Check the reader's view.** `stdout.txt` has four records ending `4 records, 1 runs`. Each line shows the
  run, the service `verify-bodies`, a `site <line>:<col>` and a `fiber <n>`. `ask` and `ask-again` show
  `llm.request.body=470 chars`, `upload` shows `http.request.body=1000023 chars`, and `session` shows `-` as its
  parent.
- **Read a multi-run file.** Point `OTELSCOPE_FILE` at a capture run's `out/spans.jsonl`. The last line is
  `8 records, 2 runs`.

## Gotchas

- `OTELSCOPE_FILE` must be absolute; the program runs inside its own run directory.
- A file written by 0.2.0 or earlier does not decode: its records have no `startMs`, `service`, `site`, `def` or
  `fiber`.
