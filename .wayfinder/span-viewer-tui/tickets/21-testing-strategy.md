---
id: "21"
title: Testing strategy for packages/tui
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

How is `packages/tui` tested in this repo's vitest setup? Decide:

- what is tested as pure functions without a renderer: navigation over the screen stack, tree building,
  grouping, the waterfall's bar and axis maths, cause rendering, log flattening;
- how the data layer is tested: the tail `Stream` against a growing temp file, decoding and classification of
  bad lines, snapshots;
- whether views are tested through `@opentui/react/test-utils` frame snapshots, and which ones;
- which fixtures the tests use (the sample fixture from "Representative sample JSONL fixture", hand-written
  small files);
- how the tests fit the `pre-push` hook on Node 26.

**Amended by** [Keymap and help across screens](19-keymap-and-help.md): key dispatch is a pure
`(mode, nav, key) → Action` over one binding table, which also generates the hint line and `?` overlay.

**Amended by** [CLI surface and npm packaging](20-cli-surface.md): arguments are parsed with `effect/cli`; argv →
initial `Nav`, unique-prefix resolution of seeded ids, and the startup errors with their exit codes (0, 1, 2) are
also to be tested.

## Resolution

2026-10-09, grilled with wmaurer.

### Layers

- **Pure functions, no Effect runtime and no renderer, hold most tests.** They cover:
    - `Nav` push, replace, back and update;
    - key dispatch `(mode, nav, key) → Action`, and the hints and help generated from the binding table;
    - tree flattening with folds and groups, and same-name grouping from 20;
    - the waterfall's bar and axis maths;
    - cause rendering, and log flattening and scope;
    - query parsing: terms, smart case, `key=value` and `is:failed`;
    - list sorting and the "live within 5 s" mark;
    - unique-prefix resolution.

    The views stay thin: anything a view would decide is pulled into a pure function and tested here.

- **Services**, with `@effect/vitest` `it.effect`: `SpanSource`, `SpanStore`, `Bodies` and the CLI.
- **Views**, through `@opentui/react/test-utils`: a deliberately small set (below).

### Property tests

These use `it.prop`. Everything else is tested by example.

- **SpanStore:** the same records in any order and any chunking give the same final snapshot, apart from
  `version`.
- **Tree building:** any input order gives the same tree, and orphans are placed consistently.
- **Waterfall maths:** bars stay within the column bounds, and after clamping a child never starts left of its
  parent.
- **`Nav`:** back after push is the identity, and replace never grows the stack.
- **Unique-prefix matching:** an id always resolves by its full value, and an ambiguous prefix never resolves.

### Data layer

- **`SpanSource` runs against real temp files** with `NodeServices`, each test in its own `mkdtemp`
  directory, with `pollMillis` about 20 ms. Each step awaits the next `TailEvent` under a timeout; there are no
  fixed sleeps. Scenarios:
    - append;
    - a partial last line held back, then completed;
    - truncate;
    - rename-replace;
    - remove, then recreate;
    - the head changed at the same size (the head-hash guard);
    - the file missing at start, then created;
    - a missing directory;
    - `--no-follow` reading once and ending.

    A fake `FileSystem` was rejected, because the watcher's OS behaviour is what can go wrong.

- **`SpanStore` is fed by a stub `SpanSource` layer** (a scripted `Stream<TailEvent>`), with `TestClock` for the
  100 ms throttle. Cases:
    - children before parents, and orphan groups;
    - a trace across two runs;
    - aggregates;
    - copy-on-write identity: an untouched trace is the same object across publishes;
    - Reset;
    - legacy and malformed classification, with samples capped at 100;
    - the first publish immediate, then trailing-edge throttling;
    - a run whose `service` disagrees, counted once.

### CLI

- **In process**, through `effect/cli` `Command.runWith` with argument arrays: argv → initial `Nav`, usage
  errors and `--version`.
- **Spawned**, as a few runs of the real bin (`node packages/tui/src/bin.ts`) with piped stdio. With piped stdio
  the process is not a TTY, so the TTY error is tested without any setup.
    - Exit 2, with usage on stderr, when no file is given.
    - Exit 1 with `needs an interactive terminal`.
    - Exit 1 for a directory, and for a missing file under `--no-follow`.
- **The startup checks run before the renderer, with the TTY check last**, so the file errors stay testable
  with piped stdio. The guard for Node < 26.9 is not tested, since it can't be reached on 26.

### Views

- **Screens are plain components taking props**, a `Snapshot` slice plus their `Nav` entry, and get static
  frame tests. Only the app shell touches atoms.
- **Frames:**
    - every screen, and each state that changes what you see, at 120×40. The states are: the empty file, a
      missing file, bad lines present, a filter matching nothing, and the `?` overlay;
    - at 80×24, the stacked Trace layout and the narrowest list layouts.
- **Snapshots:**
    - `captureCharFrame()` as file snapshots in `__snapshots__/`, not inline;
    - colour only through targeted `captureSpans()` assertions on the colours that carry meaning: exit states,
      the selected row and filter matches. There are no full styled snapshots.
- **App-shell tests:** a few build the app with a stub `SpanStore` layer whose `SubscriptionRef<Snapshot>` the
  test sets, to prove that a live update lands. New spans appear, the selection holds and the follow indicator
  changes.
- **About six end-to-end journeys** through `mockInput` and `mockMouse`, each wrapped in `act()` and then
  `renderOnce()`:
    - Enter drilling from Runs down to Body, and Esc walking back;
    - `/` narrowing a list;
    - `?` opening and closing help;
    - a click selecting a row, and the wheel scrolling;
    - `q` quitting.

    Exhaustive coverage of the bindings stays in the pure dispatch tests. The renderer is destroyed after each
    test.

- **One injected clock.** "Now" comes from Effect's `Clock`, surfaced through an atom, and is never read from
  the wall clock in a component. View tests fix it, app-shell tests step `TestClock` across the throttle, and
  anything animated renders a static form while time doesn't advance.

### Fixtures

- **Hand-built builders** (`record({...})` and snapshot builders) in `packages/tui/test/support`, like the
  `otlpSpan` helper in `packages/effect/test/support`, feed almost every test.
- **The sample fixture is rebuilt.** The `research/sample-fixture` branch and its commit are lost, so
  [Rebuild the sample-fixture generator](22-rebuild-sample-fixture.md) recreates the generator:
    - in `packages/effect/scripts/`, since the writer owns it;
    - with its sample committed in `packages/tui/test/fixtures/sample/`, since the reader tests against it;
    - normalised, so the sample is byte-stable across regenerations.
- **A golden smoke set** reads the sample through the real `SpanSource` and `SpanStore` with `--no-follow` and
  takes one frame per screen. It catches drift between the data layer and the views. It waits on the generator
  ticket; nothing else does.
- **The large fixture** stays gitignored and out of `pnpm test`.

### Tooling

`packages/tui` gets `"test": "vitest run"` and a `vitest.config.ts` including `test/**/*.test.{ts,tsx}`, run by
the existing `pnpm -r test` in `pre-push` on Node 26. The package's tests should take about 10 s. There is no
slow tier and no CI. Performance checks over the large fixture are a separate script outside `pre-push`, owned by
Performance limits on the map.
