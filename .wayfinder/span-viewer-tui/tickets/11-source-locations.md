---
id: "11"
title: "Source locations: record span call sites, or failures only?"
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: []
---

## Question

Charting assumed every span carries `code.stacktrace` as a source location. The prior-art survey found it
does not: effect@4.0.1 captures a call site per span, but its OTLP exporter does not export it. Today a
record's only source locations are the frames inside an `exception` event's `exception.stacktrace`. Settle:

- whether v1 shows source locations for failures only (parsed from `exception.stacktrace`), or the writer
  in `packages/effect` also records each span's call site;
- if it records them: where the call site can be read (tracer, span, or a wrapper around the exporter in
  `ReceiverClient`), what the record field looks like, and the cost per span;
- whether a location can open in `$EDITOR`, or is only shown.

If recording call sites changes `JsonlSpanRecord`, do it in the same release as the start-time change.
Findings: `docs/research/prior-art-survey.md` on branch `research/prior-art-survey`.

The sample fixture shows that an `exception.stacktrace` already has one frame per enclosing span. Each frame
is named after its span and gives the call site of that span's `withSpan`, such as `at payment.attempt
(file:50:20)`. So a failure already maps every span on its path to a source location. See the sample-fixture
ticket's resolution.
