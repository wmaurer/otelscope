---
id: "23"
title: Performance budgets and how they are checked
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

v1 targets 250k spans, with every record in memory ([Data layer: tailing, indexing and exposing the file to
React](08-data-layer-design.md)). What budgets does the spec set, and how does a script outside `pre-push` check
them?

- **Budgets.** What counts as responsive, as numbers, for:
    - time to the first frame after `otelscope <file>`;
    - time until a finished file is fully indexed;
    - a key press that moves the selection, or folds or unfolds, in the windowed list and the waterfall;
    - a live publish, which is copy-on-write every 100 ms;
    - memory at 250k spans.
- **Fixture scale.** The large variant has 36k spans. Should the generator grow a third `Scale` at the target
  (for example 20,000 orders, about 240k spans), and is it generated on demand like `large/`?
- **Measuring.** The check needs a harness that drives the real `SpanSource` and `SpanStore` and renders with
  `@opentui/react/test-utils`: what does it time, how many runs, and where does it report?
- **Remedies, decided in advance.** If startup misses its budget, is bundling the bin the remedy, against "`tsc`
  output, no bundle" in [Runtime and Node version policy for packages/tui](12-runtime-policy.md)? Is `--last-runs`,
  which [CLI surface and npm packaging](20-cli-surface.md) left out of v1, the remedy for a slow index of a huge
  file?

## Resolution

2026-10-09, grilled with wmaurer.

### Facts measured while grilling

- Importing `effect`, `effect/Schema`, `effect/Stream` and `@effect/platform-node/NodeServices` takes about 150 ms
  (170 ms for the whole process) on the dev machine under Node 24, and about 140 ms with Node's compile cache.
  OpenTUI needs Node 26, which is not installed there yet, so its load time is still unmeasured.
- `JSON.parse` plus a `decodeUnknownExit` of a stand-in 0.3.0 record Schema costs about 3 µs a line on the large
  fixture (36,059 lines: about 50 ms to parse, 50 ms to decode, once warm). Decoding is not where 250k spans will
  be slow.
- The large variant has about 8.7 spans per order plus about 10.5k fixed spans, so 20,000 orders would give about
  184k spans, not 240k. The target needs about 28,000.

### Reference conditions

- **Budgets are absolute, on the dev machine**: Intel Core Ultra 7 155H, 22 threads, 62 GB, on mains power, on
  the repo's Node 26. The spec names the machine. There is no calibration step.
- **One-off timings** (startup, full index) are judged by their **median**. **Repeated timings** (key presses,
  publishes, searches) are judged by **p95 and a hard max**.

### Fixture: a third `Scale`

- `HUGE` in `packages/effect/scripts/fixture/scenarios.ts`, about `{ orders: 28_000, wideChildren: 10_000 }`.
  The exact order count is set when it is first generated, so that 250,000 ≤ spans < 260,000, and the spec
  records the count. That is about 130 MB of JSONL.
- `sample-fixture.ts huge` writes `packages/tui/test/fixtures/huge/`, which is gitignored like `large/`.
  Generating with no argument still writes only `sample` and `large`.
- The perf script **generates `huge/` itself when it is missing** (about 30 s, once).
- The 10,001-span trace, with its 10,000 siblings under one parent, is inside `huge` and stays the worst case for
  a single trace.

### Budgets

All of them are measured on `huge`.

| Metric                     | What is timed                                                                                              | Runs                                    | Budget                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| First frame                | spawn → the first frame drawn, whatever it shows                                                           | 10 spawns after 1 discarded, warm cache | median ≤ 400 ms                         |
| First rows                 | spawn → the first frame listing runs                                                                       | same spawns                             | median ≤ 750 ms                         |
| Full index                 | spawn → the complete snapshot under `--no-follow` (`read once`, every line counted)                        | 3 fresh processes                       | median ≤ 3 s                            |
| Key press, idle            | `act(key)` + `renderOnce()` at 120×40                                                                      | 200 presses per scenario                | p95 ≤ 16 ms, max ≤ 50 ms                |
| Key press, while loading   | the same, while `huge` is still being indexed                                                              | 200 presses per scenario                | p95 ≤ 50 ms, max ≤ 100 ms               |
| Live publish               | store freeze + re-render of the visible screen, following `huge` while 5,000 spans/s are appended for 30 s | every publish in the 30 s               | p95 ≤ 16 ms, max ≤ 50 ms                |
| Key press, while following | the idle scenarios, during the same 30 s                                                                   | 200 presses per scenario                | the idle budget                         |
| Search                     | debounce firing → the filtered frame, over all spans                                                       | 50 per query                            | p95 ≤ 100 ms (plus the 150 ms debounce) |
| Memory                     | after the full index and `global.gc()`                                                                     | worst of the 3 index runs               | heap used ≤ 400 MB, RSS ≤ 600 MB        |

- **Startup has two numbers** because they have different remedies. The first frame measures module loading and
  the renderer. First rows on a big file means the tail hands over its first chunk, about 1 MB, without reading
  the whole file first.
- **Key-press scenarios:**
    - `j`/`k` and `PgDn` on the trace list (about 28k traces);
    - `j`/`k` in the trace view of the 10,001-span trace, across the 10,000-sibling group;
    - folding and unfolding that group's parent, and the root.
- **The UI stays interactive while loading and following.** The while-loading budget means indexing yields at
  least every 16–30 ms, for example by indexing in chunks between frames. A frozen UI would contradict the status
  bar's `loading 43%`.
- **The live writer** appends to new and existing traces alike, at a rate a busy service writing flat out would
  reach.
- **Search queries:** a plain term, a `key=value` and `is:failed`. This budget decides whether v1's linear scan
  ([Data layer: tailing, indexing and exposing the file to React](08-data-layer-design.md)) is enough.
- **The frame timings use the test renderer.** They include OpenTUI's native buffer render but not the TTY write.

### Harness

- **`pnpm --filter @wmaurer/otelscope perf`** runs `packages/tui/perf/run.ts` on Node 26 with `--expose-gc`. It
  is a plain script, not `vitest bench`, and it is outside `pre-push` and `pnpm test`.
    - In process, it drives the real `SpanSource` and `SpanStore` and renders with `@opentui/react/test-utils` at
      120×40.
    - It spawns child processes for the startup and full-index numbers, so each one starts JIT-cold.
- **`packages/tui/perf/startup.ts`** handles startup, which needs a TTY. It loads the same `main` modules as the
  bin, through the same shim steps, but mounts the test renderer at 120×40. It prints a `process.hrtime` mark at
  the first frame and another at the first frame with runs. The harness times both marks from spawn.
- **Output:**
    - a table on stdout with each metric, its budget, its median/p95/max and pass or fail;
    - `--json` for machine-readable output;
    - exit 1 on any miss.

    Nothing is committed: with no CI, a results history in the repo is only noise.

### Compile cache: always on

The bin shim calls `module.enableCompileCache()` before `await import("./main.js")`, whatever the budgets say. It
caches into the OS temp dir and changes nothing in the build. It sits between the warning step and the start in
[Runtime and Node version policy for packages/tui](12-runtime-policy.md).

### Remedies, approved in advance

Each one is applied only after profiling shows its target is the cause.

- **Startup:**
    1. Lazy-`import()` what the first frame does not need: the body viewer, help and the CLI help text.
    2. Then **bundle our code and Effect** with esbuild, keeping `@opentui/*` external. This amends "`tsc`
       output, no bundle", and it is approved only if module loading is more than half of the startup time.
- **First rows and full index:** tune the chunk size and the work the store does per insert.
    - **`--last-runs` is not a remedy.** It would still have to read and decode every line to learn which runs
      exist. It stays out of v1 on its own merits.
- **Memory:** intern repeated strings (`run`, `service`, `name`, `site.file`/`def.file`, attribute keys).
- **Key presses:** memoise tree flattening per `Trace` identity and fold state.
- **Search:** the inverted index the data layer deferred.
- **Live publish:** profile first. The 100 ms throttle stays.

### What a miss means

- **The budgets are v1 release criteria.** `@wmaurer/otelscope@0.1.0` is not published until `perf` passes on the
  reference machine.
- `prepublishOnly` stays tests-only, because perf takes minutes. The `packages/tui` release steps in `AGENTS.md`
  add "run `pnpm --filter @wmaurer/otelscope perf` on the reference machine".
- **Changing a budget** means amending the spec with the measured reason, not quietly editing a number in the
  script.
