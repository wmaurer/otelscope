---
id: "22"
title: Rebuild the sample-fixture generator
labels: [wayfinder:task]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

The generator and fixtures from [Representative sample JSONL fixture](07-sample-fixture.md) are lost: the
`research/sample-fixture` branch, commit 69826aa and `fixtures/span-viewer/` exist on no branch, worktree or
unreachable object. [Testing strategy for packages/tui](21-testing-strategy.md) needs the sample for its golden
smoke frames, Performance limits needs the large variant, and the README screenshot is taken from the sample.

Rebuild it:

- **Generator** in `packages/effect/scripts/`, running a small Effect program through `JsonlTrace.layer`. Until
  0.3.0 is built, patch `toRecord` there as before, so lines carry `startMs`, `service`, `site` and `def`, with
  `ms` and `offsetMs` to the microsecond.
- **Output:**
    - the sample is committed in `packages/tui/test/fixtures/sample/` (`spans.jsonl` and `bodies/`);
    - the large variant goes in a gitignored sibling directory, `large/`.
- **Normalised, so the committed sample is byte-stable across regenerations:**
    - times are rebased to a fixed epoch;
    - trace, span and run ids are remapped in order of first appearance;
    - absolute paths in stack traces and `site`/`def` are made relative to the repo root.
- **Keep the scenarios and facts recorded in "Representative sample JSONL fixture":**
    - the sample has 4 runs (`shop-api`, `support-agent`, `batch-jobs`, `worker`), 10 traces and about 525 spans;
    - retries, a declined payment, timeouts and races ending `Interrupted`, concurrent spans, bodies up to a
      truncated 1.2 MB transcript, a 41-level deep trace and a 400-child wide trace;
    - logs at all six levels, with annotations;
    - a defect, and a forked heartbeat;
    - children before parents, typed errors with empty messages, `effect.cause` on logged causes, and stack
      traces naming each enclosing span;
    - the large variant has about 40k spans and one parent with 10,000 children.

Record the one command that regenerates each output, and the resulting counts.

## Resolution

2026-10-09, done by the agent (AFK). The files are in the working tree on `main`, not committed yet.

- **Generator:** `packages/effect/scripts/sample-fixture.ts`, with three modules in `packages/effect/scripts/fixture/`:
    - `scenarios.ts` holds the four programs and a `Scale` (`SAMPLE`, `LARGE`);
    - `Writer03.ts` holds the 0.3.0 stand-in and the normaliser;
    - `VirtualTime.ts` holds the clock and scheduler.

    `packages/effect/tsconfig.json` now includes `scripts`, so `pnpm typecheck` and `pnpm lint` cover the
    generator under the production Effect rules. The package's `files` still ship only `dist` and `src`.

- **Regenerate**, from the repo root:
    - `pnpm exec tsx packages/effect/scripts/sample-fixture.ts sample` rewrites `packages/tui/test/fixtures/sample/`;
    - `pnpm exec tsx packages/effect/scripts/sample-fixture.ts large` rewrites `packages/tui/test/fixtures/large/`;
    - with no argument it rewrites both, in about 4 s on Node 24.

    An unknown argument fails with `Expected "sample" | "large"`. `large/` is in `.gitignore`.

- **Counts:**
    - **Sample:** 4 runs, 10 traces, 511 spans, 57 events and 8 bodies, 1.5 MB on disk (0.2 MB of JSONL).
    - **Large:** 4 runs, 3,004 traces, 36,059 spans, 13,031 events and 8 bodies, in 18.6 MB of JSONL.
        - One trace has 10,001 spans, and one parent in it has 10,000 children.
        - The email body is stored once for all 3,000 orders.

### Not through `JsonlTrace.layer`, yet

`toRecord` is not patched in `src`. That would put half of 0.3.0 on `main`. Instead, `Writer03.layer` is a
stand-in for `JsonlTrace.layer` as 0.3.0 will ship it:

- it reuses `slimSpan`, `plainAttributes`, `spansOf` and `ReceiverClient` from `src`;
- it writes the 0.3.0 record, with `service` after `run`, `startMs`, `site` and `def`, and `ms` and `offsetMs`
  to the microsecond;
- it wraps the tracer in the `context` hook from
  [Source locations: record span call sites, or failures only?](11-source-locations.md), which sets the `code.*`
  and `otelscope.def.*` attributes that `toRecord` lifts into `site` and `def`.

The hook works as specified on effect@4.0.1: 0 of 511 spans lack `site`, and all 22 `Effect.fn` spans have
`def`. When 0.3.0 is built, the generator switches to `JsonlTrace.layer` and keeps only the normaliser and
virtual time. The stand-in has two changes of its own: its exporter runs on the live clock, and it exports once,
at shutdown.

### Byte-stable, by running in virtual time

Rebasing times would not make the sample stable, because real durations differ by microseconds on every run.
The program therefore runs on a virtual clock:

- **Sleeps never wait.** They are queued. A shared scheduler dispatcher sees when every fiber is idle, then jumps
  the clock to the earliest sleep. Timeouts, races and retries resolve the same way every time.
- **Each clock read advances the clock** by 2 to 30 µs, drawn from a seeded generator. This stands in for CPU
  time. No sample span has a whole-millisecond `ms`, and no two spans in a trace start at the same time.
- **Scenario choices** come from `Random.withSeed`.
- **The first run starts at a fixed epoch**, 2026-10-06T14:03:27Z.

The normaliser then:

- renumbers run, trace, span and fiber ids in order of first appearance. Trace and span ids are hex derived from
  the ordinal. A run id has the `makeRunId` shape, `2026-10-06T14-03-27-070-0001`;
- strips the repo root, and any `file://` form of it, from every string, including `site`, `def`, stack traces
  and `effect.cause`.

Three regenerations, standalone and together with `large`, gave identical bytes. The output has no absolute
path.

Two traps came up, now handled and commented in `VirtualTime.ts`:

- A woken fiber resumes synchronously inside the clock's advance. The idle check therefore loops until a task is
  pending.
- The exporter's shutdown flush is timed by the fiber that closes the scope, and that fiber is on virtual time.
  While the flush waited on file I/O the runtime looked idle, the clock jumped to the flush timeout, and spans
  were dropped. Each write is wrapped in `hold`, which stops the clock until the write finishes.

### Scenarios and facts, checked against the output

Everything recorded in [Representative sample JSONL fixture](07-sample-fixture.md) holds, except the numbers
noted here.

- **`shop-api`:** 6 interleaved `POST /orders` traces.
    - Order 2 retries its payment 3 times, and the 2 failed attempts carry `exception` events.
    - Order 4 is declined (`PaymentDeclined`). The failure reaches the root, which logs `payment failed` with
      `effect.cause` and sets status code 402.
    - Order 5's `shipping.quote` times out, `Interrupted`, and the order falls back to a flat rate.
    - `inventory.reserve`, `email.send` and `db.query` run concurrently.
- **`support-agent`:** one session of 3 steps.
    - In step 1, two `llm.provider` spans race and the loser is `Interrupted`.
    - In step 2, three tools run concurrently. `tool.fetch_invoice` times out and is `Interrupted`.
    - The `llm.request` bodies grow to about 120 KB, against about 110 KB before.
- **`batch-jobs`:** the deep trace has 41 levels, and the wide trace has 400 children, 6 of which fail with
  `RowInvalid`.
- **`worker`:** a `TypeError` defect fails `config.load`, `job.run` and `worker.tick`. The forked
  `worker.heartbeat` is `Interrupted` on fiber 18, while `worker.tick` runs on fiber 7.
- **Bodies** match what [Body viewer](16-body-viewer.md) was settled against:
    - `llm.request` is compact JSON, and its prompts hold `\n` inside strings;
    - `llm.response` is pretty-printed JSON;
    - `email` is one line of HTML;
    - `agent.transcript` is one line of JSON, 1,213,045 bytes, cut at the 1,000,000-character cap with
      `truncated 213045 chars`.
- **Logs** come at all six levels, TRACE to FATAL, with the annotations `order.id`, `payment.attempt`,
  `agent.session`, `agent.step`, `row.index` and `worker.id`.
- **Facts:**
    - 501 of the 511 lines come before their parent's line.
    - Typed errors have empty `exception.message`.
    - Logged causes carry `effect.cause`.
    - Stack traces name each enclosing span, with `(definition)` frames for `Effect.fn`, for example
      `at payment.charge (packages/effect/scripts/fixture/scenarios.ts:…)`. Their paths are now relative.
- **Smaller than before:**
    - the sample has 511 spans, not 525;
    - the large variant has 36,059 spans, not 39,566. Its 3,004 traces are the same, and each order has a
      little less inside it.

### For later tickets

- **The large variant is 36k spans, and v1 targets 250k.** A performance check at the target needs a bigger
  `Scale`. That means one more entry in `VARIANTS`, for example 20,000 orders; the generator has no other limit.
- **`site`, `def` and stack-frame line numbers follow `scenarios.ts`**, so editing that file changes the
  sample's bytes. Regenerate the sample and its snapshots together.

**Amended by** [Performance budgets and how they are checked](23-performance-budgets.md): a third `Scale`, `HUGE`
(about 28,000 orders, set so that 250,000 ≤ spans < 260,000), writes the gitignored
`packages/tui/test/fixtures/huge/` through `sample-fixture.ts huge`. The perf script generates it when it is
missing. Running the generator with no argument still writes only `sample` and `large`.
