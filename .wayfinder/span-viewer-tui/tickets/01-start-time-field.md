---
id: "01"
title: Shape of the start-time field, and files without it
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: []
---

## Question

Charting settled that `JsonlSpanRecord` gains an absolute start time. This ticket settles exactly how:

- the field name and representation: epoch milliseconds as a number, the OTLP nanosecond string, or an ISO
  string, and whether sub-millisecond precision matters for short spans;
- whether `ms` stays a whole-millisecond duration or gains precision too;
- whether events keep only `offsetMs` or also get an absolute time;
- how the TUI treats records without the field (files written by 0.2.x): reject them, show a tree without
  bars, or something else;
- the version bump and README change for `@wmaurer/otelscope-effect`.

The answer is the exact diff to `JsonlSpanRecord` in `packages/effect/src/format/Jsonl.ts`, plus the
fallback rule.
