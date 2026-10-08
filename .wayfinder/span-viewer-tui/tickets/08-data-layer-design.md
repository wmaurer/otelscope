---
id: "08"
title: Data layer: tailing, indexing and exposing the file to React
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: [04]
---

## Question

How does the TUI load and follow the JSONL file, and what does it expose to views? Settle:

- the Effect services and their APIs (source, index, bodies);
- the in-memory index from runs to traces to span trees, and how partial trees (children written before
  their parents) are represented;
- handling of malformed or partial lines and file truncation;
- how lines from 0.2.x (no `startMs`) are told apart from other bad lines, so a file with no usable spans gets
  the "rerun with >= 0.3" notice the start-time ticket settled;
- the granularity and throttling of live updates pushed to React;
- loading body text on demand;
- the file size the design targets, given 360–460 MB resident for 200k lines before any index;
- whether the `JsonlSpanRecord` Schema goes into `@wmaurer/otelscope-effect/format` (a public API change, best
  released with the start-time field) or stays in the TUI.

The Effect–React bridge research recommends a starting point: Effect owns the process and the renderer, the
tail is a custom `Stream` with `Reset` events, lines decode one by one, and snapshots go through
`SubscriptionRef` → `Atom.subscriptionRef` → `useAtomValue`. See `docs/research/effect-react-bridge.md` on
branch `research/effect-react-bridge`.

## Resolution

2026-10-07, grilled with wmaurer. Builds on the bridge research (`docs/research/effect-react-bridge.md` on
branch `research/effect-react-bridge`): Effect owns the process and the renderer, a custom tail `Stream`, one
`Exit` per decoded line, and snapshots through `SubscriptionRef` → `Atom.subscriptionRef` → `useAtomValue`.

### Record Schema

`packages/effect/src/format/Jsonl.ts` defines `AttributeValue`, `Attributes`, `JsonlSpanEvent` and
`JsonlSpanRecord` as Schemas, and the interfaces become `typeof X.Type`. The writer keeps working on the derived
types; the TUI imports the Schema from `@wmaurer/otelscope-effect/format`. `startMs` is required, `exit` is
`Schema.Literals(["Success", "Failure", "Interrupted"])`, and unknown keys are dropped, so a newer writer's
extra fields still decode. It ships in 0.3.0 with the start-time field, and the README names the Schema.

### Size target and memory

Every decoded record stays in memory; only bodies are read from disk. v1 targets **250k spans (about 100 MB of
JSONL)** as fully interactive. Measured on the large fixture, a decoded record costs 0.75–1.4 KB of heap (56 MB
for 39,566 records, 150 MB for 197,830), so the target is roughly 200–350 MB live. There is no hard cap;
bigger files load slower and the README states the figure. A "newest N runs" flag (`--last-runs`) is a
possible CLI addition, never the default.

### Index

- **A trace is keyed by trace id alone.** It holds every span with that id from any run, so a trace that
  crosses two services writing to one file is one tree. A run lists the traces it contributed spans to, and
  one trace can appear under two runs. The trace view labels a span's run when its trace has more than one.
- **Partial trees.** Each trace keeps `spans: Map<spanId, Span>` and `children: Map<parentId, spanId[]>`
  (sorted by `startMs`). A child is indexed under its parent's id whether or not the parent has arrived, so
  nothing is relinked when it does. Roots have `parent: null`. Parent ids that children point to but that
  are not in `spans` form orphan groups, shown at top level under a placeholder row ("⋯ missing parent
  `ab12…`") that disappears when the parent arrives. A trace with a `parent: null` span is **rooted**;
  otherwise it is **partial**, and the trace list shows its earliest span muted with a "partial" marker.
- **Aggregates.** The store keeps span count, failure count and start/end time per run and per trace as it
  inserts, so list screens never walk spans.

### Snapshots and throttling

Copy-on-write per trace. The store mutates builders internally; on each publish it freezes a new `Trace`
object only for the traces touched since the last one and reuses the rest by reference, so `React.memo`,
`Atom.family` and selectors work by identity. The first publish is immediate, then at most one every
**100 ms**, trailing edge. A Reset publishes at once.

```ts
Snapshot = {
  version
  status:     { phase: "waiting" | "loading" | "following", bytesRead, bytesTotal, lastReset?: reason }
  runs:       ReadonlyArray<Run>       // by first startMs
  traces:     ReadonlyMap<traceId, Trace>
  traceOrder: ReadonlyArray<traceId>   // by start
  badLines:   { legacy: number, malformed: number, samples: ReadonlyArray<BadLine> }
}
Run   = { id, firstStartMs, lastEndMs, traceIds, spanCount, failureCount }
Trace = { id, runs, root?: spanId, startMs, endMs, spanCount, failureCount,
          spans: ReadonlyMap<spanId, Span>, children: ReadonlyMap<parentId, ReadonlyArray<spanId>>,
          missingParents: ReadonlyArray<spanId> }
```

Field names are a starting point for the spec.

### Bad lines and 0.2.x files

A failed line never stops the tail. After a decode fails, it is classified:

- **legacy**: a JSON object with `run`, `trace` and `span` but no `startMs` (a 0.2.x writer);
- **malformed**: anything else (invalid JSON, wrong types, two writers interleaved mid-line).

Both are counted. The first 100 malformed lines are sampled with line number, byte offset, Schema issue and
the first 200 characters; legacy lines are not sampled. No spans plus any legacy line shows a full-screen
notice in place of the run list: "This file was written by @wmaurer/otelscope-effect < 0.3 (N lines). Rerun
your program with >= 0.3." It gives way to the run list once a valid line arrives. Spans plus legacy lines
show "N lines from otelscope < 0.3 skipped" in the status bar; malformed lines show "N bad lines", with a key
that opens the samples. A partial last line is held back by the tail and never counted.

### Resets and a missing file

- On `Reset` (truncated, replaced, removed) the store clears the index and bad-line counts, bumps `version`
  and publishes at once. The status bar flashes "file truncated — reloaded" or "file replaced — reloaded";
  after a removal it shows "waiting for <file>…". Trace and span ids can therefore disappear; how routes fall
  back is the route ticket's.
- **A missing file at startup is waited for**, like `tail -F`, with the absolute path on screen. A missing
  **directory** exits with an error, since the directory watch cannot be set up and it is almost surely a
  typo.
- **Head-hash guard:** the tail keeps a hash of the file's first 4 KiB and treats a change as a Reset, which
  closes the truncate-then-regrow gap the research found.
- Read and watch errors become `status` state, never a crash or `console` output (OpenTUI captures both).

### Bodies

`Bodies.read(sha256): Effect<BodyText, BodyMissing | BodyReadFailed>` reads `<dir of the JSONL>/bodies/<sha256>.txt`
whole. The writer caps a body at 1,000,000 characters (`MAX_BODY_CHARS` in `format/Bodies.ts`), so a file is at
most about 4 MB. `BodyText = { text, truncated }`, where `truncated` is true when the attribute's `.bytes`
exceeds the file's byte length (the writer also appends "truncated N chars" to the text). An LRU keyed by sha256
holds up to **32 MB of text**; bodies are content-addressed, so it survives a Reset. React reads
`Atom.family((sha256) => Atom.make(Bodies.read(sha256)))` as an `AsyncResult`. The details pane shows
`.preview` and loads the body only when the body viewer opens. No sha256 check on read.

### Services

Each is a `Context.Service` with a `layer`; none imports React or OpenTUI.

```ts
class InputFile  { file: string; bodiesDir: string; pollMillis: number /* 1000 */ }
class SpanSource { events: Stream<TailEvent> }   // tail + head-hash guard + progress
// TailEvent = Lines { lines, endOffset, size } | Reset { reason } | Missing
class SpanStore  { snapshot: SubscriptionRef<Snapshot> }   // decode, classify, index, throttle; forkScoped fiber
class Bodies     { read(sha256): Effect<BodyText, BodyMissing | BodyReadFailed> }
```

Derived views (a trace's flattened rows, filtered lists) are pure functions over `Snapshot`, used through
`Atom.map` and `Atom.family` in a `packages/tui/src/bridge` module. v1 search is a debounced linear scan of the
snapshot in a derived atom, with no inverted index; the search fog can revisit that.

### Facts for later tickets

- Records carry no service name: resource attributes are not written, so a run is known only by its `run` id
  (`2026-10-07T10-01-48-041-9dcb`). Showing a service name would be a record-format change for 0.3.0.

**Amended by** [Source locations: record span call sites, or failures only?](11-source-locations.md): the
record Schema gains required `site` and `def` fields, each `{ file, line, col } | null`.

**Amended by** [Run identity: does the record carry the service name?](14-run-identity.md): records carry a
required `service`, which settles the first fact above. `Run` gains `service`, taken from its first record; a
run whose records disagree is counted as malformed once.

**Amended by** [Run and trace list screens](15-list-screens.md): the aggregates grow. Per run: failed traces
(root failed), failed and interrupted spans, logs, and the time of the last record (for the 5-second live
mark). Per trace: failed and interrupted spans, logs, the root's exit, the first exception's type and message,
and the time of the last record.
