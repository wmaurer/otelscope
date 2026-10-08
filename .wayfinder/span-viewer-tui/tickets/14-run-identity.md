---
id: "14"
title: "Run identity: does the record carry the service name?"
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

How does a run identify itself on the runs screen? Today a record carries only `run`, a timestamp id such as
`2026-10-06T14-03-27-412-9f3a`. `JsonlTrace.layer` requires a `serviceName` and passes it to the OTLP
resource, but the sink drops the resource, so a file shared by several programs cannot tell them apart.

Decide whether 0.3.0 records the service name (and possibly `service.version` or other resource attributes),
where it sits (per record or once per run), and how a run reads when there is none. All format changes ship
together in 0.3.0 (see Shape of the start-time field, and files without it), so this is settled before the
list screens.

## Resolution

2026-10-07, grilled with wmaurer.

- **Per record:** 0.3.0 adds a required `service: string` to every `JsonlSpanRecord`, right after `run`. A
  header line or sidecar was rejected: it breaks "one record per line" and per-line decoding, and a tail that
  starts mid-file or after a truncation would lose it. The cost is about 20 bytes a line.
- **The service name only:** no `version` and no other resource attributes. A version barely changes between
  local runs. An optional field added later is not a format break, because `Schema.Struct` ignores fields it
  does not know and a newer reader can treat a missing optional field as absent.
- **Source:** `JsonlTrace.layer` passes `options.serviceName` to
  `JsonlSink.make({ file, runId, service, bodies })`, and the sink stamps it like `run`. `spansOf` and the
  receiver are unchanged. An explicit `serviceName` takes precedence over `OTEL_SERVICE_NAME` and
  `OTEL_RESOURCE_ATTRIBUTES` in Effect, so this equals the resource's `service.name`.
- **Validation:** `serviceName` stays required. The decoded type is a plain `string`, so an empty name is not
  rejected, since tracing must never fail the program it observes. The TUI shows an empty name as `(unnamed)`.
- **In the data layer:** `Run` gains `service`, taken from the run's first record. A run whose records
  disagree is shown under the first name and counted as malformed once, not per line.
- **For the list screens:** a run reads as service plus start time (`order-api · 14:03:27`), not its id.
  Grouping or sorting by service is for "Run and trace list screens".

### Diff to `packages/effect/src/format/Jsonl.ts`

```ts
export interface JsonlSpanRecord {
    readonly run: string;
    // `service.name` of the program that wrote the record: the `serviceName` given to `JsonlTrace.layer`.
    readonly service: string;
    readonly trace: string;
    // …
}
```
