# Span viewer: v1 spec

The implementation spec for `@wmaurer/otelscope` (`packages/tui`), a terminal UI that opens one otelscope JSONL file
and lets you browse its runs, traces and spans, live or after the fact. It also covers the 0.3.0 record-format
release of `@wmaurer/otelscope-effect` (`packages/effect`), which the viewer needs.

Everything here is settled. Where a choice was made, the reason is given once, briefly; the full discussion is in the
wayfinder map, [Span viewer TUI for otelscope JSONL](../../../.wayfinder/span-viewer-tui/map.md), whose tickets are
the record of each decision. If this spec and a ticket disagree, this spec wins: it was assembled after every ticket
closed and resolves the places where they had drifted apart (see [Settled while assembling](#settled-while-assembling)).

## Files

| File                                           | Covers                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [01-record-format.md](01-record-format.md)     | `@wmaurer/otelscope-effect` 0.3.0: the record, the Schema, the writer changes |
| [02-package.md](02-package.md)                 | `packages/tui` layout, dependencies, runtime, bin shim, repo tooling, release |
| [03-data-layer.md](03-data-layer.md)           | `InputFile`, `SpanSource`, `SpanStore`, `Bodies`, the snapshot, the bridge    |
| [04-navigation.md](04-navigation.md)           | the typed screen stack, view state, placeholders, seeding                     |
| [05-list-screens.md](05-list-screens.md)       | the Runs and Traces screens                                                   |
| [06-trace-view.md](06-trace-view.md)           | the Trace screen: tree, waterfall, details, logs                              |
| [07-body-viewer.md](07-body-viewer.md)         | the Body screen                                                               |
| [08-search.md](08-search.md)                   | the `/` query language and how each screen applies it                         |
| [09-keys-and-chrome.md](09-keys-and-chrome.md) | binding table, dispatch, status bar, hints, help, mouse, theme, formatting    |
| [10-cli.md](10-cli.md)                         | arguments, startup checks, errors, exit codes                                 |
| [11-testing.md](11-testing.md)                 | test layers, fixtures, frame snapshots                                        |
| [12-performance.md](12-performance.md)         | budgets, the `perf` harness, approved remedies                                |

## Vocabulary

- **Run**: one program execution, the record's `run`. A file holds many runs. A run is labelled by its `service` and
  start time (`shop-api · 14:03:27`), not its id.
- **Trace**: every span with one trace id, from any run. A trace is keyed by trace id alone.
- **Span**: one record. `parent` builds the tree. `exit` is `Success`, `Failure` or `Interrupted`.
- **Root**: a span with `parent: null`. A trace with a root is **rooted**, otherwise **partial**.
- **Orphan group**: spans whose parent id is not (yet) in the trace, shown under a "missing parent" placeholder.
- **Event**: an entry in a span's `events`, timed by `offsetMs` from the span's start.
- **Log**: an event carrying `effect.logLevel`, written by `Effect.log*`. **Exception event**: an event named
  `exception`.
- **Failure origin**: a span with `exit: "Failure"` and no child with `exit: "Failure"`. A failed span with a failed
  child only **propagated** the failure.
- **Problem span**: a failure origin or an interrupted span.
- **Body**: a `<prefix>.body` attribute the writer moved to `bodies/<sha256>.txt`, leaving `<prefix>.sha256`,
  `<prefix>.bytes` and `<prefix>.preview` on the span.
- **Live**: a record arrived in the last 5 s while the viewer is following the file.
- **Snapshot**: the immutable view of the indexed file that the data layer publishes to React.

## Packages and pinned versions

| Package                     | Path               | Version         | Role                                      |
| --------------------------- | ------------------ | --------------- | ----------------------------------------- |
| `@wmaurer/otelscope-effect` | `packages/effect/` | `0.2.0 → 0.3.0` | writes the JSONL file; exports the Schema |
| `@wmaurer/otelscope`        | `packages/tui/`    | `0.1.0` (new)   | the viewer, bin `otelscope`               |

The viewer's dependencies are pinned as [02-package.md](02-package.md) lists. The ones that must move together:

- `effect`, `@effect/platform-node`, `@effect/atom-react` and `@effect/vitest` at **one exact version**, the one in
  the lockfile when work starts (4.0.1 today; `@effect/atom-react` 4.0.2 needs `effect ^4.0.2`, so bumping all four to
  4.0.2 together is fine). The Atom core is `effect/reactivity` inside `effect`; there is no separate atom package.
- `@opentui/core` and `@opentui/react` at the same exact version (0.5.14 today), with `react ~19.2.0`.

## Order of work

Each step leaves `pnpm pre-push` green.

1. **Repo on Node 26.** `.nvmrc`, `.npmrc`, root `engines` and `packages/effect` `engines`
   ([02-package.md](02-package.md#repo-changes)). Install Node 26 on the dev machine first; it has 24.21 today.
2. **`@wmaurer/otelscope-effect` 0.3.0** ([01-record-format.md](01-record-format.md)): the Schema, the new fields,
   the tracer hook, `exportInterval`, the source export condition, tests and README. Rebuild the fixture generator's writer from
   0.3.0's `src` pieces, regenerate the sample, and add the `HUGE` scale.
   Do not publish yet.
3. **`packages/tui` scaffold**: package, tsconfig, vitest, lint override, the bin shim and `main.ts` with the CLI
   parse and startup checks ([02-package.md](02-package.md), [10-cli.md](10-cli.md)). The renderer shows an empty
   frame.
4. **Data layer** ([03-data-layer.md](03-data-layer.md)): `InputFile`, `SpanSource`, `SpanStore`, `Bodies`, then the
   bridge atoms. Tested without a renderer.
5. **Navigation and chrome** ([04-navigation.md](04-navigation.md), [09-keys-and-chrome.md](09-keys-and-chrome.md)):
   `Nav`, the binding table and dispatch, the status bar, the help overlay, the bad-lines overlay, the theme.
6. **Screens**, in drill-down order: Runs and Traces ([05](05-list-screens.md)), Trace ([06](06-trace-view.md)), Body
   ([07](07-body-viewer.md)). Search ([08](08-search.md)) lands with each screen it touches.
7. **Golden smoke set, journeys and perf** ([11-testing.md](11-testing.md), [12-performance.md](12-performance.md)).
   `perf` must pass on the reference machine.
8. **READMEs and `AGENTS.md`** ([02-package.md](02-package.md#readme-the-npm-page)), and the screenshot.
9. **Release**: publish `@wmaurer/otelscope-effect@0.3.0`, then `@wmaurer/otelscope@0.1.0`. wmaurer publishes; an
   agent never does without being asked.

## Settled while assembling

These were open, or disagreed between tickets, when the map closed. They were settled with wmaurer on 2026-10-09
(the first five) or follow directly from what the tickets decided (the rest). Each is written into the file named.

- **State and tests use the Effect packages.** Atoms come from `effect/reactivity`, React binds them through
  `@effect/atom-react`, and every test file imports `describe`, `it` and `expect` from `@effect/vitest`, pure tests
  included. ([02](02-package.md), [11](11-testing.md))
- **Records carry the span's fiber id.** 0.3.0 adds `fiber: number | null`, read by the same tracer hook as `site`.
  The details header shows it for every span the hook saw run, and search matches `#n`. ([01](01-record-format.md))
- **The writer exports every second.** `JsonlTrace.layer` sets the OTLP `exportInterval` to 1 s. At Effect's default
  of 5 s, a running program's records land 5 s apart and the 5-second live mark would flicker. ([01](01-record-format.md))
- **The workspace reads the effect package's source.** `packages/effect` gains a `@otelscope/source` export
  condition, so `packages/tui` typechecks and tests without building it first. ([01](01-record-format.md),
  [02](02-package.md))
- **No TSX is loaded outside vitest without a build.** `main.ts` parses arguments and runs the startup checks before
  it `import()`s the app, so the spawned CLI tests run `src/bin.ts` under plain Node type stripping. The perf harness
  builds `dist/` and spawns the real `dist/bin.js`. ([02](02-package.md), [11](11-testing.md), [12](12-performance.md))
- **Problem spans are failure origins and interrupted spans.** The tree's `n`/`N` and the opening selection stop
  there, not on spans a failure only propagated through. ([06](06-trace-view.md))
- **Live means arrived while following.** Records indexed during the initial read never count as live, so opening a
  finished file does not mark every run live for 5 s. ([03](03-data-layer.md))
- **"New rows" counts rows newer than a watermark.** Runs and Traces views gain `newerThan`, the newest row's start
  time when following stopped. ([04](04-navigation.md), [05](05-list-screens.md))
- **A seeded trace not yet loaded gets its opening selection when it first appears.** ([04](04-navigation.md))
- **A one-run file opens on its traces only at the end of the initial read**, and only if no key was pressed and no
  `--run`/`--trace` was given. A 1 MB first chunk could hold one run of several. ([04](04-navigation.md))
- **`phase` gains `done`** for `--no-follow`, and the snapshot carries `epoch`, `lastRecordAt` and `error`.
  ([03](03-data-layer.md))
- **The logs pane lists logs only.** Exception events and other events appear in the details pane's Events section
  and as markers on the bar. ([06](06-trace-view.md))
- **Quit and signals go through Effect.** Quit completes a `Deferred` the program waits on; the renderer is created
  with `exitSignals: []`; SIGINT and SIGTERM interrupt through `runMain`, SIGHUP completes the `Deferred`, and a custom
  `teardown` makes an interrupted exit code 0. OpenTUI's own signal handlers would destroy the renderer behind
  Effect's back, and Effect's default maps an interrupt to 130. ([02](02-package.md))
- **Selections can point at rows that are not spans or traces.** `TraceView.selected` is a `TreeRow` (span, group or
  missing parent) and `TracesView.selected` a `TraceRow` (trace, group heading or "more" row). ([04](04-navigation.md))
- **The fixture generator keeps its own writer**, rebuilt from 0.3.0's `src` pieces: it needs virtual time, one
  export at shutdown, normalisation and a write hold, which `JsonlTrace.layer` should not offer.
  ([01](01-record-format.md))
- **Formatting**, the **theme palette**, the **breadcrumb**, the **logs strip height**, the **name column default**
  and the **status bar's drop order** were left to "the spec" by their tickets and are fixed in
  [09-keys-and-chrome.md](09-keys-and-chrome.md) and [06-trace-view.md](06-trace-view.md).

## Out of scope for v1

Metrics, topology and standalone OTLP logs; an OTLP network receiver; more than one input file; Effect DevTools'
live features; JSONL from other producers; a light palette (GitHub issue
[#1](https://github.com/wmaurer/otelscope/issues/1)); a programmatic API; regex, negation or `OR` in queries; a global
search screen; a pause key; `--last-runs`; `--filter`; opening a cause frame in the editor; copying ids with `y`.
