---
id: "07"
title: Representative sample JSONL fixture
labels: [wayfinder:task]
status: open
assignee:
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
