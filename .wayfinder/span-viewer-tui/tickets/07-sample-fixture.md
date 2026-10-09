---
id: "07"
title: Representative sample JSONL fixture
labels: [wayfinder:task]
status: closed
assignee: wmaurer
blocked_by: [01]
---

## Question

The prototypes and later decisions need realistic data. Produce a sample JSONL file, with `bodies/`, by
running a small Effect program through `JsonlTrace.layer`. The start-time field settled in the
start-time ticket is included; a throwaway patch to `toRecord` is fine, since the real change is built
later. The sample should cover:

- several runs in one file;
- nested, sequential and concurrent spans, and one deep and one wide trace;
- failures with `exception` events, and an interrupted span;
- `Effect.log*` events at several levels with annotations;
- `.body` attributes stored in `bodies/`;
- a large variant (tens of thousands of spans) for performance checks.

Record where the files live and the one command that regenerates them.

## Resolution

2026-10-07. Done on branch `research/sample-fixture` (commit 69826aa). That branch also carries the
throwaway `toRecord` patch from the start-time ticket, so every line has `startMs`, and `ms` and `offsetMs`
are given to the microsecond.

- **Where the files are:**
    - `fixtures/span-viewer/sample/spans.jsonl` and its `bodies/` are committed.
    - `fixtures/span-viewer/large/` is gitignored and has to be regenerated.
- **Regenerate:** from the repo root, `pnpm exec tsx packages/effect/scripts/sample-fixture.ts`, which
  rewrites both. Add `sample` or `large` to rewrite just one. The script runs on Node 24, takes about 7 s,
  and seeds its random choices, so the shape of the traces is the same every time. Times, ids and run ids
  are real, so they change on each run.
- **Sample:** 4 runs, 10 traces, 525 spans and 57 events, about 1.4 MB.
    - `shop-api`: 6 interleaved `POST /orders` traces.
        - A payment that is retried 3 times. The failed attempts carry `exception` events.
        - A declined payment that fails the trace, with `logError` and an `effect.cause`.
        - A shipping quote that times out and comes back `Interrupted`.
        - Concurrent spans: `inventory.reserve`, `email.send` and `db.query`.
    - `support-agent`: `llm.chat` spans whose request and response bodies grow to about 110 KB.
        - Tools run concurrently.
        - Two providers race. The loser is `Interrupted`.
        - A tool times out and is `Interrupted`.
        - A 1.2 MB transcript body is truncated when stored.
    - `batch-jobs`: a deep trace with 41 nested levels and a wide trace with 400 children, 6 of which fail.
    - `worker`: logs at all six levels (TRACE to FATAL), a defect (`TypeError`) that fails three levels of
      spans, and a forked heartbeat span that is `Interrupted` and has its own fiber id.
    - Log annotations: `order.id`, `payment.attempt`, `agent.step`, `agent.session`, `row.index` and
      `worker.id`.
- **Large:** the same scenarios at a larger scale: 4 runs, 3,004 traces, 39,566 spans and 13,417 events,
  in 16 MB.
    - One trace has 10,001 spans, and a single parent in it has 10,000 children.
    - The email body is identical in all 3,000 traces, so it is stored once.
- **Facts later tickets depend on:**
    - **Children come before parents.** A span is written when it ends, so 514 of the 525 sample lines come
      before their parent's line. A trace whose parents are still missing is the normal case while a file is
      being tailed, not an edge case. This matters for the data layer and the live-tail UX.
    - **Spans can be lost.** A fiber that is interrupted after `JsonlTrace.layer` has shut down never gets its
      span written. The heartbeat was lost this way until it was forked into a scope. The viewer only ever
      sees the spans that were written.
    - **Debug and Trace logs are usually absent.** Effect's default minimum log level is Info, so Debug and
      Trace events appear only when the program lowers it. The fixture lowers it to `All`.
    - **Typed errors have empty messages.** A `Data.TaggedError` with fields produces an `exception` event
      whose `exception.message` is empty. Only `exception.type` names it, which matters when rendering
      causes.
    - **Logged causes are attached.** A log that is given a cause carries the pretty-printed cause in
      `effect.cause`.
    - **Stack traces name the spans.** An `exception.stacktrace` has one frame per enclosing span, named after
      the span, with the call site of its `withSpan`, for example `at payment.attempt (…/sample-fixture.ts:50:20)`.
      The paths are absolute. The fixture's paths point into the worktree it was generated in.

**Amended by** [Testing strategy for packages/tui](21-testing-strategy.md): the `research/sample-fixture` branch,
commit 69826aa and the files above are lost. [Rebuild the sample-fixture generator](22-rebuild-sample-fixture.md)
recreates them on main, normalised and in new locations; the scenarios and facts above still stand.
