---
id: "22"
title: Rebuild the sample-fixture generator
labels: [wayfinder:task]
status: open
assignee:
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
