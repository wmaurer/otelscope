---
id: "01"
title: Shape of the start-time field, and files without it
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
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

## Resolution

2026-10-07, grilled with wmaurer.

- **Start time:** a new field `startMs`, the wall-clock start as milliseconds since the Unix epoch, a JSON
  number rounded to the microsecond (`1791234567890.123`). Effect's clock is `process.hrtime`-based, so the
  sub-millisecond digits are real. A double holds them exactly, since epoch milliseconds use 13 of its ~15.9
  significant digits, and short sibling spans no longer collapse onto one waterfall column.
- **Duration:** `ms` keeps its name and gains the same microsecond precision (`12.347`). It is no longer
  guaranteed to be an integer. An end time is `startMs + ms`.
- **Events:** keep `offsetMs` as their only time, also to the microsecond. Their absolute time is
  `startMs + offsetMs`. No absolute field is added.
- **Files without `startMs`** (0.2.x): no fallback. The TUI's schema requires the field, so such a line is
  skipped like any other line that fails to decode. When a file yields no spans because the field is missing,
  the TUI says so specifically: written by `@wmaurer/otelscope-effect` < 0.3, rerun with >= 0.3. How skipped
  lines are counted and shown belongs to the data-layer ticket.
- **Release:** `0.2.0 → 0.3.0`, cut when the TUI work is built. It carries every record-format change this map
  decides, including the call-site field from the source-locations ticket and the record Schema export from the
  data-layer ticket if those land, so readers see one format break.

### Diff to `packages/effect/src/format/Jsonl.ts`

```ts
export interface JsonlSpanEvent {
    readonly name: string;
    // Milliseconds from the start of the enclosing span, to the microsecond. The offset is what tells retries
    // apart from each other; the event's wall-clock time is the span's `startMs` plus this.
    readonly offsetMs: number;
    readonly attrs: Attributes;
}

export interface JsonlSpanRecord {
    readonly run: string;
    readonly trace: string;
    readonly span: string;
    readonly parent: string | null;
    readonly name: string;
    // Wall-clock start in milliseconds since the Unix epoch, to the microsecond.
    readonly startMs: number;
    // Duration in milliseconds, to the microsecond.
    readonly ms: number;
    readonly exit: "Success" | "Failure" | "Interrupted";
    readonly attrs: Attributes;
    readonly events: ReadonlyArray<JsonlSpanEvent>;
}

// OTLP times are nanoseconds since the epoch, as decimal strings past `Number.MAX_SAFE_INTEGER`. They are
// rounded to whole microseconds in BigInt, which a double holds exactly, and only then scaled to milliseconds.
const toMillis = (nanos: bigint): number => Number((nanos + 500n) / 1_000n) / 1_000;

const millisBetween = (startNanos: string, endNanos: string): number =>
    toMillis(BigInt(endNanos) - BigInt(startNanos));

// in toRecord, between `name` and `ms`:
        startMs: toMillis(BigInt(span.startTimeUnixNano)),
```

`offsetMs` and `ms` keep using `millisBetween`, which now rounds to the microsecond. The tests in
`packages/effect` that assert whole-millisecond values change with it.

### README (`packages/effect/README.md`, Record format)

The interface gains `startMs: number; // start, epoch milliseconds to the microsecond`, the `ms` comment becomes
`// duration in milliseconds, to the microsecond`, and the event shape's note says `offsetMs` is measured from
`startMs` to the microsecond. A short "Changes in 0.3" line notes that `ms` is no longer an integer and that
records without `startMs` come from earlier versions.

**Amended by** [Source locations: record span call sites, or failures only?](11-source-locations.md): 0.3.0
also adds `site` and `def` (call site and `Effect.fn` definition site, each `{ file, line, col } | null`).
