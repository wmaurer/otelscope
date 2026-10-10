# 12 · Performance

v1 targets **250k spans** with every record in memory. These budgets are **v1 release criteria**:
`@wmaurer/otelscope@0.1.0` is not published until `perf` passes on the reference machine.

Source: [Performance budgets and how they are checked](../../../.wayfinder/span-viewer-tui/tickets/23-performance-budgets.md).

## Reference conditions

- **Absolute budgets on the dev machine**: Intel Core Ultra 7 155H, 22 threads, 62 GB, on mains power, on the repo's
  Node 26. No calibration step.
- **One-off timings** (startup, full index) are judged by their **median**; **repeated timings** (key presses,
  publishes, searches) by **p95 and a hard max**.
- Frame timings use the test renderer: they include OpenTUI's native buffer render but not the TTY write.

## Fixture

- `HUGE` in `packages/effect/scripts/fixture/scenarios.ts` is `{ orders: 28_000, wideChildren: 10_000 }`, which
  gives **252,725 spans** (the target was 250,000 ≤ spans < 260,000), 28,004 traces and 121,366 events in
  146.5 MB of JSONL.
- `pnpm exec tsx packages/effect/scripts/sample-fixture.ts huge` writes `packages/tui/test/fixtures/huge/`
  (gitignored). The perf script generates it when missing, once. Generation takes about 73 s on the reference
  machine (measured twice: 72.7 s and 73.0 s). A CPU profile puts about half of that in the generator's
  `VirtualTime`: the 28,000 orders run concurrently, and each sleep is inserted into a sorted array by copying
  it, so the cost grows with the square of the order count. The writer's own work (`toRecord` and the tracer
  hook) is under 2 % of the profile.
- Its 10,001-span trace, with 10,000 siblings under one parent, is the worst case for a single trace.

## Budgets

All measured on `huge`.

| Metric                     | What is timed                                                                                              | Runs                                    | Budget                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| First frame                | spawn → the first frame drawn, whatever it shows                                                           | 10 spawns after 1 discarded, warm cache | median ≤ 400 ms                         |
| First rows                 | spawn → the first frame listing runs                                                                       | same spawns                             | median ≤ 750 ms                         |
| Full index                 | spawn → the complete snapshot under `--no-follow` (phase `done`)                                           | 3 fresh processes                       | median ≤ 3 s                            |
| Key press, idle            | `flushSync(key)` + `renderOnce()` at 120×40                                                                | 200 presses per scenario                | p95 ≤ 16 ms, max ≤ 50 ms                |
| Key press, while loading   | the same, while `huge` is still being indexed                                                              | 200 presses per scenario                | p95 ≤ 50 ms, max ≤ 100 ms               |
| Live publish               | store freeze + re-render of the visible screen, following `huge` while 5,000 spans/s are appended for 30 s | every publish in the 30 s               | p95 ≤ 16 ms, max ≤ 50 ms                |
| Key press, while following | the idle scenarios, during the same 30 s                                                                   | 200 presses per scenario                | the idle budget                         |
| Search                     | debounce firing → the filtered frame, over all spans                                                       | 50 per query                            | p95 ≤ 100 ms (plus the 150 ms debounce) |
| Memory                     | after the full index and `global.gc()`                                                                     | worst of the 3 index runs               | heap used ≤ 400 MB, RSS ≤ 600 MB        |

- **Startup has two numbers** because they have different remedies: the first frame measures module loading and the
  renderer; first rows means the tail hands over its first 1 MiB slice without reading the whole file first.
- **Key-press scenarios**: `j`/`k` and `PgDn` on the trace list (about 28k traces); `j`/`k` in the trace view of the
  10,001-span trace, across the 10,000-sibling group; folding and unfolding that group's parent, and the root.
    - In `huge` the 28,000 traces of the big run share the root name `POST /orders`, so the list opens on one closed
      group. The harness opens it before it presses.
    - The 10,000 siblings' parent is the trace's root, so "the group's parent" and "the root" are one span. The
      harness folds and unfolds the root with the group open, and closes and opens the group itself.
- **`flushSync`, not `act`**: React runs its production build, as `src/bin.ts` loads it
  ([02-package.md](02-package.md#the-bin-shim-srcbints)), and that build has no `act`. `flushSync` from
  `@opentui/react` commits the key's updates before `renderOnce` draws, which is what `act` did.
- **The UI stays interactive while loading and following**: indexing yields at least every 16–30 ms
  ([03-data-layer.md](03-data-layer.md#chunked-indexing)).
- **The live writer** appends to new and existing traces alike.
- **Search queries**: a plain term, a `key=value` and `is:failed`.

## Harness

- **`pnpm --filter @wmaurer/otelscope perf`** builds both packages' `dist/`, then runs `perf/run.ts` under `tsx`
  with `--expose-gc` and the `@otelscope/source` condition on Node 26. It is a plain script, not `vitest bench`,
  outside `pre-push` and `pnpm test`. `perf/run.ts` asks for React's production build, as the bin does, and loads
  `perf/measure.ts`. `--only startup,index,idle,loading,following,search` runs some of the sections.
    - In process, it builds the app's own `servicesLayer` (the real `SpanSource`, `SpanStore`, `Bodies` and `Atoms`)
      and mounts the real `App` on OpenTUI's test renderer at 120×40. It mounts with `createTestRenderer` and
      `createRoot`, which is what `testRender` from `@opentui/react/test-utils` does, without its `act`.
    - The in-process sections, too, import the app from `dist/`, not from source. `tsx` compiles with esbuild's
      `keepNames`, which wraps every named closure in a `__name` call when it is created, such as the `onNone` and
      `onSome` of each `Option.match`. On `huge` the Traces list's `collect` took 17.9 ms at p50 from source and 5.9 ms
      from `dist/`, so from source the harness would have measured the loader.
    - It spawns child processes for startup and the full index, so each starts JIT-cold. The children run **built
      code from `dist/`**, so startup is measured on what users run, with the compile cache, and without a TypeScript
      loader in the way.
- **`perf/startup.ts`** handles startup, which needs a TTY. It is plain `.ts` (no JSX), run with `node` under type
  stripping, and imports only from `../dist/`. It goes through the same shim steps as `dist/bin.js`, parses the
  arguments and runs the startup checks as `main` does (all but the TTY check), and mounts the app on the test
  renderer at 120×40 with `runOn` from `dist/app.js`, which the bin path calls with the real renderer.
    - The renderer draws on demand, as the real one does, and the child forces no frame. On every frame it reads the
      clock and the frame's text. The first frame is the first one drawn. The first rows are the first frame whose
      text contains the id of a run in the snapshot, so the mark is what the user sees, not what the atoms hold.
    - Under `--no-follow` it also marks the snapshot reaching phase `done`, runs `global.gc()`, and reports `heapUsed`
      and RSS with the app still mounted.
    - It prints the marks as one JSON line (`perf/marks.ts`). The parent reads `process.hrtime` just before the
      spawn, on the same monotonic clock, and times each mark from it.
- **A key press** is `flushSync(key)` and `renderOnce()`, timed inside one promise so that no other fiber runs inside
  the measurement. The table also counts the presses that changed the `Nav`: a press that changes nothing measured
  nothing.
- **While loading** uses a copy of `huge` with the 10,001-span trace's lines moved to the front, because in `huge` it
  arrives in the last 4 % of the file. The store does not depend on record order. Between presses the harness yields
  to the event loop, so the store indexes a slice; only presses that start while the phase is `loading` count, and
  it reloads a fresh store until each scenario has 200.
- **Live publish** follows a copy of `huge`. A writer appends 500 lines every 100 ms for 30 s, half into new traces
  of about 9 spans and half into existing traces, built from the file's first 5,000 records with new ids and current
  start times. A wrapper on `Index.prototype.freeze` marks the start of each publish; when the snapshot atom changes,
  the harness draws with `renderOnce` and times the publish from the start of `freeze` to the end of the frame. Key
  presses wait while a publish is in flight, so neither is timed inside the other. The table also shows `freeze`
  alone, the two halves (to the snapshot atom's listeners, which run after the atoms that depend on it recompute,
  and from there to the frame), and the publishes on each screen. Each frame is checked for the published span count.
- **Search** runs on the big run's Traces list, which holds 96 % of the spans. The Runs screen covers them all but
  stops at the first matching span of each run, so it does less work. Before each repetition the harness clears the
  filter and matches throwaway terms on the smallest trace, which pushes the query out of the term caches in
  `src/query/Match.ts`, so every repetition parses and scans afresh. A wrapper on `setTimeout` marks the moment the
  150 ms debounce fires, since `Effect.sleep` is a `setTimeout`. The time runs from there to the end of the
  `renderOnce` after the list atom shows the filter.
- **The fixture**: if `huge` is missing, the harness generates it once with
  `pnpm exec tsx packages/effect/scripts/sample-fixture.ts huge`.
- **Output**: a table on stdout with each metric, its budget, its median/p95/max and pass or fail, and the load
  average before and after; `--json` for machine-readable output; exit 1 on any miss. Nothing is committed.

## Data-layer measurements

These were measured with `perf/publish.ts`, in process from source, with no renderer: the store's `freeze` (the
publish without the re-render) on `huge`. `perf/run.ts` has since absorbed it: its live-publish section reports
`freeze` alone beside the whole publish. Measured on the reference machine on 2026-10-09, five runs of each mode,
alternated, at load 1.2 to 3.3:

| Mode   | Scenario                                                                                                                                             | Result                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `live` | `huge` indexed, then 300 publishes of 500 records each, half into new traces of about 9 spans, half into existing traces; first 20 publishes dropped | `freeze` p50 3.4–3.6 ms, p95 6.1–6.7 ms; copying the previous traces map (28.5k to 36.3k entries) p50 about 2.1 ms |
| `full` | `huge` through the real `SpanSource` and `SpanStore` under `--no-follow`                                                                             | 1.52–1.61 s to phase `done`; 17–19 freezes totalling 71–98 ms                                                      |

- **The trace-map copy is most of a live publish**, about 60 to 70 %. Each publish copies the `traces` map whole and
  replaces the touched traces. `new Map(previous)` plus a `set` per touched trace measured about 0.45 ms faster at p50
  than spreading both into a new `Map`, and is what `Index` would use if this needs trimming. Only a persistent map
  would remove the copy, and the numbers do not call for one: `freeze` leaves about 10 ms of the 16 ms p95 for the
  re-render.
    - Measured with the re-render, they did: on the Traces screen the rebuilt list took the other 10 ms and more, and
      the whole publish's p95 sat at 16 ms. `Index` now keeps the frozen traces in a `LayeredMap`
      (`src/data/LayeredMap.ts`): a large base and a small layer of newer traces, copied on each publish and folded
      into a new base once it holds a quarter as many entries. `freeze` fell from 3.1 to 1.0 ms at p50.
- **Rare long publishes, profiled.** `perf/publish.ts` saw about one publish in 280 take 40 to 150 ms. In
  `perf/run.ts`'s live section none reached 40 ms: the slowest of each full run took 25 to 36 ms. With `--trace-gc`,
  each publish over 18 ms coincided with a young-generation scavenge (2 to 3 ms) during a Traces-list rebuild, or
  with the `LayeredMap` folding its layer into a new base (`freeze` 7.5 ms).
- **Where the live publish stands**, after the remedies in the git log of step 7: p95 14.6 to 15.4 ms against 16, at
  load 1.5 to 3. Its p95 is set on the Traces screen, by the publishes that add traces. Each one rebuilds the list
  over every trace of the run (32k by the end of the 30 s), at about 250 ns per trace, mostly the first read of each
  `Trace` object and of the `Option`s it holds; skipping a pass or a lookup did not move it. A list updated from the
  traces a publish changed, rather than rebuilt, is the remedy if the budget needs more room.

## The compile cache

The bin shim calls `module.enableCompileCache()` before importing `main`, always
([02-package.md](02-package.md#the-bin-shim-srcbints)). It caches into the OS temp dir and changes nothing in the
build.

## Remedies, approved in advance

Each is applied only after profiling shows its target is the cause.

- **Startup**: first, lazy-`import()` what the first frame does not need (the body viewer, help, the CLI help text).
  Then **bundle our code and Effect** with esbuild, `@opentui/*` external, but only if module loading is more than
  half of a missed startup budget. This would amend "`tsc` output, no bundle" in [02-package.md](02-package.md).
- **First rows and full index**: tune the slice sizes and the work per insert. `--last-runs` is not a remedy.
- **Memory**: intern repeated strings (`run`, `service`, `name`, `site.file`/`def.file`, attribute keys).
- **Key presses**: memoise tree flattening per `Trace` identity and fold state.
- **Search**: the inverted index the data layer deferred.
    - Not needed so far. The plain term missed (p95 106 ms) because the scan lowered every string it tested, which
      copies each string that has a capital: 3.6 million tests on `huge` took 84 ms. A folded term now compiles to one
      case-insensitive regular expression (49 ms for the same tests), and the plain term's p95 fell to 72 ms. An index
      would cost memory, where RSS after the full index is within 4 % of its budget.
- **Live publish**: profile first. The 100 ms throttle stays.

## Changing a budget

Changing a budget means amending this file with the measured reason, not quietly editing a number in the script.
