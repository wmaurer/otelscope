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
| Key press, idle            | `act(key)` + `renderOnce()` at 120×40                                                                      | 200 presses per scenario                | p95 ≤ 16 ms, max ≤ 50 ms                |
| Key press, while loading   | the same, while `huge` is still being indexed                                                              | 200 presses per scenario                | p95 ≤ 50 ms, max ≤ 100 ms               |
| Live publish               | store freeze + re-render of the visible screen, following `huge` while 5,000 spans/s are appended for 30 s | every publish in the 30 s               | p95 ≤ 16 ms, max ≤ 50 ms                |
| Key press, while following | the idle scenarios, during the same 30 s                                                                   | 200 presses per scenario                | the idle budget                         |
| Search                     | debounce firing → the filtered frame, over all spans                                                       | 50 per query                            | p95 ≤ 100 ms (plus the 150 ms debounce) |
| Memory                     | after the full index and `global.gc()`                                                                     | worst of the 3 index runs               | heap used ≤ 400 MB, RSS ≤ 600 MB        |

- **Startup has two numbers** because they have different remedies: the first frame measures module loading and the
  renderer; first rows means the tail hands over its first 1 MiB slice without reading the whole file first.
- **Key-press scenarios**: `j`/`k` and `PgDn` on the trace list (about 28k traces); `j`/`k` in the trace view of the
  10,001-span trace, across the 10,000-sibling group; folding and unfolding that group's parent, and the root.
- **The UI stays interactive while loading and following**: indexing yields at least every 16–30 ms
  ([03-data-layer.md](03-data-layer.md#chunked-indexing)).
- **The live writer** appends to new and existing traces alike.
- **Search queries**: a plain term, a `key=value` and `is:failed`.

## Harness

- **`pnpm --filter @wmaurer/otelscope perf`** builds both packages' `dist/`, then runs `perf/run.ts` under `tsx`
  with `--expose-gc` and the `@otelscope/source` condition on Node 26. It is a plain script, not `vitest bench`, outside `pre-push` and `pnpm test`.
    - In process, it drives the real `SpanSource` and `SpanStore` and renders with `@opentui/react/test-utils` at
      120×40.
    - It spawns child processes for startup and the full index, so each starts JIT-cold. The children run **built
      code from `dist/`**, so startup is measured on what users run, with the compile cache, and without a TypeScript
      loader in the way.
- **`perf/startup.ts`** handles startup, which needs a TTY. It is plain `.ts` (no JSX), run with `node` under type
  stripping, and imports only from `../dist/`. It goes through the same shim steps as `dist/bin.js`, mounts the app
  on the test renderer at 120×40, and prints a `process.hrtime` mark at the first frame and another at the first frame
  with runs. The harness times both marks from spawn. `dist/app.js` therefore exports a way to run the app on a given
  renderer, which the bin path calls with the real one.
- **Output**: a table on stdout with each metric, its budget, its median/p95/max and pass or fail; `--json` for
  machine-readable output; exit 1 on any miss. Nothing is committed.

## Data-layer measurements

`pnpm --filter @wmaurer/otelscope perf:publish live|full` runs `perf/publish.ts` in process from source, with no
renderer. It measures the store's `freeze` (the publish without the re-render) on `huge`. Step 7's `perf/run.ts` can
absorb it. Measured on the reference machine on 2026-10-09, five runs of each mode, alternated, at load 1.2 to 3.3:

| Mode   | Scenario                                                                                                                                             | Result                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `live` | `huge` indexed, then 300 publishes of 500 records each, half into new traces of about 9 spans, half into existing traces; first 20 publishes dropped | `freeze` p50 3.4–3.6 ms, p95 6.1–6.7 ms; copying the previous traces map (28.5k to 36.3k entries) p50 about 2.1 ms |
| `full` | `huge` through the real `SpanSource` and `SpanStore` under `--no-follow`                                                                             | 1.52–1.61 s to phase `done`; 17–19 freezes totalling 71–98 ms                                                      |

- **The trace-map copy is most of a live publish**, about 60 to 70 %. Each publish copies the `traces` map whole and
  replaces the touched traces. `new Map(previous)` plus a `set` per touched trace measured about 0.45 ms faster at p50
  than spreading both into a new `Map`, and is what `Index` would use if this needs trimming. Only a persistent map
  would remove the copy, and the numbers do not call for one: `freeze` leaves about 10 ms of the 16 ms p95 for the
  re-render.
- **Open: rare long publishes.** About one publish in 280 per run took 40 to 150 ms, in the copy as well as in
  `freeze`. Garbage collection with about 400k records on the heap is the guess; it is not profiled. It threatens the
  50 ms max, so profile it when the live-publish scenario lands in `perf/run.ts`.

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
- **Live publish**: profile first. The 100 ms throttle stays.

## Changing a budget

Changing a budget means amending this file with the measured reason, not quietly editing a number in the script.
