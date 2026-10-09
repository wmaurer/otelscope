# Span capture

A program provided with `JsonlTrace.layer` appends one JSON line per finished span to the configured file. Runs
that share a file stay apart by `run`, children point at their parent, `Effect.log*` calls inside a span become
its events, and `exit` says whether the span succeeded, failed or was interrupted.

## Sub-features

- `capture-record` writes the record shape from README.md: `run`, `service`, `trace`, `span`, `parent`, `name`,
  `startMs`, `ms`, `exit`, `site`, `def`, `fiber`, `attrs`, `events`, in that order.
- `capture-site` sets `site` to the line and column of each span's `Effect.withSpan` call in `program.ts`.
- `capture-fiber` sets `fiber` to the fiber that opened the span, equal to `effect.fiberId` on its logs.
- `capture-append` appends a second run to an existing file instead of replacing it.
- `capture-run-id` uses `runId` when given, and a sortable UTC timestamp such as
  `2026-10-09T11-57-44-896-db7d` when not.
- `capture-parent` sets `parent` to the enclosing span's id, and `null` on a root span.
- `capture-events` records each log inside a span as an event with `offsetMs` from the span's start.
- `capture-exit` reports `Success`, `Failure` and `Interrupted`.

## How to get to it (user POV)

- Provide `JsonlTrace.layer({ serviceName, file, runId? })` as the outermost layer, with `NodeServices.layer`
  under it, and run the program.

## Driving it with drive.sh

Preconditions:

- `$V/doctor.sh` prints `doctor: OK`.

- **Run two traced runs into one file.** Run `$V/drive.sh capture $V/programs/capture.ts`. `exit.txt` is `0`,
  `stderr.txt` is empty, `files.txt` lists only `out/spans.jsonl`, and stdout shows `loading cart` and
  `charge failed` twice.
- **Check records.** Run
  `jq -c '{run, service, span, name, parent, exit, site, fiber, attrs, ev: [.events[] | [.name, .offsetMs, .attrs["effect.fiberId"]]]}' <run>/out/spans.jsonl`.
  Eight lines: four with `"run":"verify-a"`, then four with `"run":"verify-b"`. In each run, `checkout` has
  `"parent":null`, `attrs` `{"user.id":"u-42"}` and events `[["loading cart",<0-2>,<fiber>],["charge failed",<20-30>,<fiber>]]`;
  `load-cart`, `charge` and `abandoned` have `parent` equal to that run's `checkout` `span`; `charge` has
  `"exit":"Failure"` and one `exception` event; `abandoned` has `"exit":"Interrupted"`. Every record has
  `"service":"verify-capture"` and `"def":null`. `site.file` is the run's `program.ts`, and `site.line` is 13 for
  `load-cart`, 15 for `charge`, 18 for `abandoned` and 21 for `checkout`. `checkout`, `load-cart` and `charge`
  share one `fiber`, equal to the `effect.fiberId` of `checkout`'s two log events. `abandoned` has a different
  `fiber`, the forked one. Run `jq -c 'keys_unsorted' <run>/out/spans.jsonl | sort -u`. One line: the fourteen
  keys of the record shape, in order.
- **Default run id.** Run `DEFAULT_RUN_ID=1 $V/drive.sh capture-default $V/programs/capture.ts`, then
  `jq -r .run <run>/out/spans.jsonl | uniq -c`. Two values, four records each, both matching
  `^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$`. The timestamp is UTC, so it differs from the
  local times in `stdout.txt` by the UTC offset.
- **Append across processes.** Run
  `CAPTURE_SEED="$PWD/<first capture run>/out/spans.jsonl" $V/drive.sh capture-append $V/programs/capture.ts`.
  The new `out/spans.jsonl` has 16 lines, and `head -8` of it is byte-identical to the seed
  (`head -8 <run>/out/spans.jsonl | cmp - <seed>` prints nothing). The seed itself is only read.

## Gotchas

- Records are written when the exporter flushes, so a child usually appears before its parent. Assert by
  `parent` and `span`, never by line order.
- `startMs`, `ms` and `offsetMs` are milliseconds to the microsecond and differ on every run. Assert ranges, not
  exact values.
- An interrupted span carries extra attributes from Effect (`span.label`, `status.interrupted`). They are
  Effect's, not this package's.
