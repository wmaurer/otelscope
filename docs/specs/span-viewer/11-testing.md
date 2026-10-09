# 11 · Testing

`packages/tui` gets `"test": "vitest run"`, run by the existing `pnpm -r test` in `pre-push` on Node 26. The package's
tests should take about 10 s. There is no slow tier and no CI. Performance is a separate script
([12-performance.md](12-performance.md)).

**Every test file imports `describe`, `it` and `expect` from `@effect/vitest`**, pure tests included, so one import
style covers `it.effect`, `it.prop` and plain `it`.

Sources: [Testing strategy](../../../.wayfinder/span-viewer-tui/tickets/21-testing-strategy.md),
[Rebuild the sample-fixture generator](../../../.wayfinder/span-viewer-tui/tickets/22-rebuild-sample-fixture.md).

## Layers

**Pure functions hold most tests**, with no Effect runtime and no renderer. The views stay thin: anything a view would
decide is pulled into a pure function and tested here.

- `Nav`: push, replace, back, update, prefix resolution;
- key dispatch `(mode, nav, key) → Action`, and the hints and help generated from the binding table;
- tree flattening with folds and groups, same-name grouping from 20, closed groups showing problem and selected
  members;
- the opening selection and problem/match navigation order;
- the waterfall's bar maths and the axis interval and labels;
- cause rendering: stack-frame parsing, origin detection, exception identity;
- log flattening (multi-value, annotations, cause line) and log scope;
- query parsing (terms, quotes, smart case, `key=value`, `is:`) and matching at span, trace, run and log level;
- list rows: sorting, groups and their headings, marks, the live window, following and the new-rows count;
- formatting;
- JSON detection, the tokenizer and wrapping for Body;
- unique-prefix resolution.

**Services**, with `it.effect`: `SpanSource`, `SpanStore`, `Bodies` and the CLI.

**Views**, through `@opentui/react/test-utils`: a deliberately small set (below).

### Property tests (`it.prop`)

Everything else is tested by example.

- **SpanStore**: the same records in any order and any chunking give the same final snapshot, apart from `version`.
- **Tree building**: any input order gives the same tree, and orphans are placed consistently.
- **Waterfall maths**: bars stay within the column bounds, and after clamping a child never starts left of its
  parent.
- **`Nav`**: back after push is the identity, and replace never grows the stack.
- **Unique-prefix matching**: an id always resolves by its full value, and an ambiguous prefix never resolves.

## Data layer

**`SpanSource` runs against real temp files** with `NodeServices`, each test in its own `mkdtemp` directory, with
`pollMillis` about 20 ms. Each step awaits the next `TailEvent` under a timeout; no fixed sleeps. A fake `FileSystem`
was rejected, because the watcher's OS behaviour is what can go wrong. Scenarios:

- append; a partial last line held back, then completed; a multi-byte character split across a 1 MiB slice;
- truncate; rename-replace; remove, then recreate; the head changed at the same size (the head-hash guard);
- the file missing at start, then created;
- a missing directory;
- `follow: false` reading once, emitting `CaughtUp` and ending.

**`SpanStore` is fed by a stub `SpanSource` layer** (a scripted `Stream<TailEvent>`), with `TestClock` for the 100 ms
throttle and the live window. Cases:

- children before parents, and orphan groups; a second `parent: null` span;
- a trace across two runs;
- aggregates, including `firstError` in arrival order and `failedTraces` per run;
- copy-on-write identity: an untouched trace is the same object across publishes;
- Reset clears everything and bumps `epoch`;
- legacy and malformed classification, samples capped at 100, duplicate span ids;
- a run whose `service` disagrees, counted once;
- the first publish immediate, then trailing-edge throttling;
- `lastArrivalAt` unset during the initial read, set after `CaughtUp`;
- phases `waiting`, `loading`, `following`, `done`;
- indexing yields between slices of 2,000 lines.

**`Bodies`**: a read, the LRU (eviction by size), `truncated` from the declared bytes, `BodyMissing`,
`BodyReadFailed`, `stat`.

## CLI

- **In process**, through `effect/cli`'s `Command.runWith` with argument arrays: argv → initial `Nav`, usage errors,
  `--version`.
- **Spawned**, a few runs of the real bin from source with piped stdio:
  `node --conditions=@otelscope/source packages/tui/src/bin.ts …`. Node 26 strips types from the `.ts` files, and
  `main.ts` loads no `.tsx` before its checks pass, so no build or loader is needed. With piped stdio the process is
  not a TTY.
    - exit 2, usage on stderr, when no file is given;
    - exit 1 with `needs an interactive terminal` for a readable file;
    - exit 1 for a directory, a missing directory, and a missing file under `--no-follow`.
- The Node < 26.9 guard is not tested; it can't be reached on 26.

## Views

- **Screens are plain components taking props**: a `Snapshot` slice, their `Screen` entry, the theme and `now`. Only
  the app shell touches atoms.
- **Frames** with `captureCharFrame()`, as file snapshots in `__snapshots__/` (not inline):
    - every screen, and each state that changes what you see, at **120×40**: the empty file, a missing file, the
      legacy notice, bad lines present, a filter matching nothing, a placeholder for a missing id, the `?` overlay,
      the `!` overlay;
    - at **80×24**: the stacked Trace layout and the narrowest list layouts.
- **Colour** only through targeted `captureSpans()` assertions on the colours that carry meaning: exit states, the
  selected row, filter matches. No full styled snapshots.
- **App-shell tests**: a few build the app with a stub `SpanStore` layer whose `SubscriptionRef<Snapshot>` the test
  sets, to prove a live update lands: new spans appear, the selection holds, the follow indicator changes.
- **About six end-to-end journeys** through `mockInput` and `mockMouse`, each step wrapped in `act()` and then
  `renderOnce()`:
    - `⏎` drilling from Runs down to Body, and `Esc` walking back;
    - `/` narrowing a list;
    - `?` opening and closing help;
    - a click selecting a row, and the wheel scrolling;
    - `q` quitting.

    Exhaustive binding coverage stays in the pure dispatch tests. The renderer is destroyed after each test.

- **One injected clock.** "Now" comes from Effect's `Clock` through `nowAtom`, never the wall clock in a component.
  View tests pass a fixed `now`; app-shell tests step `TestClock` across the throttle; anything animated renders a
  static form while time does not advance.

## Fixtures

- **Builders** (`record({...})`, snapshot builders) in `packages/tui/test/support/`, like the `otlpSpan` helper in
  `packages/effect/test/support/`, feed almost every test.
- **The sample** is `packages/tui/test/fixtures/sample/` (`spans.jsonl` and `bodies/`), committed, byte-stable,
  regenerated with `pnpm exec tsx packages/effect/scripts/sample-fixture.ts sample`. It has 4 runs, 10 traces and
  about 511 spans (the count may change slightly when the generator moves onto 0.3.0's `src`), with the scenarios
  listed in [Rebuild the sample-fixture generator](../../../.wayfinder/span-viewer-tui/tickets/22-rebuild-sample-fixture.md):
  retries, a declined payment, timeouts, races, concurrent tools, a 41-level trace, a 400-child trace with 6 failures,
  a defect, logs at all six levels, and bodies including one truncated at the cap. `site`, `def` and stack-frame line
  numbers follow `scenarios.ts`, so editing it changes the sample: regenerate the sample and the frame snapshots
  together.
- **A golden smoke set** reads the sample through the real `SpanSource` and `SpanStore` with `follow: false` and takes
  one frame per screen. It catches drift between the data layer and the views.
- **`large/`** (about 36k spans) and **`huge/`** (about 250k) stay gitignored and out of `pnpm test`.
