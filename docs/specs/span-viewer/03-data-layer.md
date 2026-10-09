# 03 · Data layer

Reads the file, follows it, decodes and indexes the records, and publishes immutable snapshots to React. Everything
here is Effect, in `src/data/` and `src/bridge/`; nothing in `data/` imports React or OpenTUI.

Sources: [Bridging an Effect data layer](../../../.wayfinder/span-viewer-tui/tickets/04-effect-react-bridge.md),
[Data layer](../../../.wayfinder/span-viewer-tui/tickets/08-data-layer-design.md),
[Run identity](../../../.wayfinder/span-viewer-tui/tickets/14-run-identity.md),
[Run and trace list screens](../../../.wayfinder/span-viewer-tui/tickets/15-list-screens.md),
[Live-tail UX](../../../.wayfinder/span-viewer-tui/tickets/18-live-tail-ux.md),
[Performance budgets](../../../.wayfinder/span-viewer-tui/tickets/23-performance-budgets.md).

## Services

Each is a `Context.Service` with a `layer`.

```ts
class InputFile  { file: string; bodiesDir: string; follow: boolean; pollMillis: number }
class SpanSource { events: Stream.Stream<TailEvent> }
class SpanStore  { snapshot: SubscriptionRef.SubscriptionRef<Snapshot> }
class Bodies     {
    read(sha256: string, declaredBytes: number): Effect.Effect<BodyText, BodyMissing | BodyReadFailed>
    stat(sha256: string): Effect.Effect<Option<number>>   // the stored file's byte size, None when missing
}
```

- `InputFile.layer({ file, follow })` resolves `file` to an absolute path, sets `bodiesDir` to `<dir of file>/bodies`
  and `pollMillis` to 1000. Tests pass a smaller `pollMillis` (about 20).
- `SpanStore`'s layer forks its indexing fiber with `forkScoped`, so closing the scope stops it.
- No service ever fails its stream or fiber for a read error, a decode error or a missing file: those are state.

## `SpanSource`: the tail

```ts
type TailEvent = Data.TaggedEnum<{
    Lines:    { lines: ReadonlyArray<string>; offsets: ReadonlyArray<number>; firstLine: number; size: number }
    CaughtUp: { size: number }
    Reset:    { reason: "truncated" | "replaced" | "removed" }
    Missing:  {}
    Failed:   { message: string }
}>
```

A custom `Stream`. `Stream.splitLines` and `Ndjson` don't fit: they can't hold back a partial last line across
reads, report byte offsets, or restart on truncation.

**State:** the read offset, the pending bytes of an incomplete last line, the next line number (1-based), the file's
inode, and the hash of its first `min(4096, size)` bytes once that many have been read.

**Wake-ups** come from a watch on the file's **directory** (`FileSystem.watch` on the directory, events filtered by
basename, so a file created or replaced later is still seen) and from a poll every `pollMillis` as a safety net. On
each wake-up:

1. `stat` the file. Missing: if it was present, emit `Reset { removed }` and forget all state; emit `Missing` (once
   per absence) and wait.
2. Inode changed: `Reset { replaced }`, then read from 0.
3. Size below the offset: `Reset { truncated }`, then read from 0.
4. **Head-hash guard**: if the stored head hash exists and the first 4 KiB now hash differently, `Reset { truncated }`,
   then read from 0. This closes the truncate-then-regrow-between-checks gap.
5. Read `[offset, size)` in slices of at most **1 MiB**. Split on `\n` at the byte level; decode only complete lines
   as UTF-8 (a multi-byte character can straddle a slice), keep the rest as pending bytes. Emit
   `Lines { lines, offsets, firstLine, size }` per slice, where `offsets[i]` is the byte offset of `lines[i]`. Empty
   lines are skipped but counted.
6. When the offset (plus pending bytes) reaches the size seen in step 1, emit `CaughtUp { size }`.

- A partial last line is held back and never emitted or counted until its `\n` arrives.
- A read or watch error emits `Failed { message }` and retries on the next wake-up; the next successful read clears it
  (the store treats any `Lines` or `CaughtUp` as recovery).
- **`follow: false`** (`--no-follow`): no watcher and no poll. Read from 0 to the size at open, emit `CaughtUp`, and
  end the stream. A missing file never reaches here: the CLI exits first.
- **A missing directory** fails `SpanSource`'s layer, since the watch can't be set up. The CLI checks it first and
  exits 1, so this is a defect path only.
- Concurrent writers that interleave mid-line produce malformed lines; nothing more is done about it.

## Decoding and classifying lines

Each line is decoded on its own, in two steps, so the parsed value is available for classification:

1. Parse JSON. Failure: **malformed** (issue: the parse error).
2. `Schema.decodeUnknownExit(JsonlSpanRecord)` from `@wmaurer/otelscope-effect/format`. Failure: **legacy** if the
   value is an object with string `run`, `trace` and `span` and no `startMs` key (a 0.2.x writer), else **malformed**
   (issue: the Schema issue, formatted on one line).

Unknown keys are dropped, so newer records decode. About 3 µs a line on warm code; decoding is not the bottleneck.

Two more malformed cases, found while indexing:

- **A duplicate span id** in one trace: the first record wins, the duplicate is counted as malformed
  (`duplicate span 51e618f6…`).
- **A run whose `service` disagrees** with its first record: the record is indexed under the run's first service, and
  the run is counted as malformed **once** (`run <id>: service "b" differs from "a"`), not per line.

**Samples**: the first **100** malformed lines are kept as `BadLine { line, offset, issue, text }`, with `text` cut to
200 characters. Legacy lines are counted, never sampled.

## `SpanStore`: the index

The store consumes `SpanSource.events`, keeps mutable builders, and publishes frozen snapshots.

### Per trace

- **Keyed by trace id alone.** A trace holds every span with its id from any run, so one crossing two services that
  write to one file is one tree. Each run lists the traces it contributed spans to; a trace can be under two runs.
- `spans: Map<SpanId, Span>`.
- `children: Map<ParentKey, SpanId[]>`, each list sorted by `startMs` (then span id) with binary insertion. A child is
  filed under its parent's id **whether or not the parent has arrived**, so nothing is relinked when it does. Spans
  with `parent: null` are filed under the key `null`.
- **Root**: the earliest `parent: null` span. Other `parent: null` spans (rare) are extra top-level spans after it.
- **Missing parents**: parent ids that some child points to and that are not in `spans`, ordered by their earliest
  child's start. Each is an orphan group under a placeholder row. One disappears as soon as its parent arrives.
- **Aggregates**, updated on insert so list screens never walk spans:

    | Field              | Meaning                                                                   |
    | ------------------ | ------------------------------------------------------------------------- |
    | `startMs`, `endMs` | min start, max `startMs + ms` over its spans                              |
    | `spanCount`        |                                                                           |
    | `failedSpans`      | spans with `exit: "Failure"`                                              |
    | `interruptedSpans` | spans with `exit: "Interrupted"`                                          |
    | `logs`             | events carrying `effect.logLevel`                                         |
    | `rootExit`         | `Option<Exit>`, the root's exit                                           |
    | `firstError`       | `Option<{ type, message }>`, the first `exception` event in arrival order |
    | `lastArrivalAt`    | `Option<number>`: clock time of the last record indexed while following   |
    | `headName`         | the root's name, or the earliest span's name while partial                |

    `firstError` is the first exception **written**, and children are written before parents, so it is where the
    failure started.

### Per run

`id`, `service` (from its first record), `firstStartMs`, `lastEndMs`, `traceIds` (by trace start),
`spanCount`, `failedTraces` (traces whose root is in this run and failed), `failedSpans`, `interruptedSpans`, `logs`,
`lastArrivalAt`.

### Live

`lastArrivalAt` is set from `Clock.currentTimeMillis` only for records indexed **after the first `CaughtUp`** of the
current epoch. Records read in the initial pass (or the re-read after a Reset) never count as arriving, so opening a
finished file marks nothing live. A run or trace is **live** when `now - lastArrivalAt < 5000` and the phase is
`following`. `now` comes from the clock atom ([Bridge](#bridge)), never from the wall clock in a component.

### Chunked indexing

Indexing must not freeze the UI while a big file loads ([12-performance.md](12-performance.md)): the while-loading
key-press budget requires a yield at least every 16–30 ms. The store indexes a `Lines` event in slices of at most
**2,000 lines** (about 6 ms) and yields to the event loop between slices, so stdin and render callbacks run. Use a
macrotask yield (for example `Effect.sleep(0)` on the live clock, or a `setImmediate`-backed effect); a bare
`Effect.yieldNow` may not leave the microtask queue. Tune the slice size against the perf scenarios.

## The snapshot

```ts
type RunId = string;
type TraceId = string;
type SpanId = string;
type Exit = "Success" | "Failure" | "Interrupted";

interface Snapshot {
    readonly version: number;                          // +1 on every publish
    readonly epoch: number;                            // +1 on every Reset
    readonly status: Status;
    readonly runs: ReadonlyMap<RunId, Run>;
    readonly runOrder: ReadonlyArray<RunId>;           // by firstStartMs
    readonly traces: ReadonlyMap<TraceId, Trace>;
    readonly traceOrder: ReadonlyArray<TraceId>;       // by startMs
    readonly spanCount: number;
    readonly badLines: BadLines;
}

interface Status {
    readonly phase: "waiting" | "loading" | "following" | "done";
    readonly bytesRead: number;
    readonly bytesTotal: number;
    readonly lastRecordAt: Option<number>;             // clock time of the last record indexed while following
    readonly lastReset: Option<{ readonly reason: "truncated" | "replaced" | "removed"; readonly at: number }>;
    readonly error: Option<string>;                    // the last Failed message, until a read succeeds
}

interface BadLines {
    readonly legacy: number;
    readonly malformed: number;
    readonly samples: ReadonlyArray<BadLine>;          // at most 100
}
interface BadLine { readonly line: number; readonly offset: number; readonly issue: string; readonly text: string }

interface Run {
    readonly id: RunId;
    readonly service: string;
    readonly firstStartMs: number;
    readonly lastEndMs: number;
    readonly traceIds: ReadonlyArray<TraceId>;
    readonly spanCount: number;
    readonly failedTraces: number;
    readonly failedSpans: number;
    readonly interruptedSpans: number;
    readonly logs: number;
    readonly lastArrivalAt: Option<number>;
}

interface Trace {
    readonly id: TraceId;
    readonly runs: ReadonlyArray<RunId>;               // in order of first appearance
    readonly root: Option<SpanId>;
    readonly headName: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly spanCount: number;
    readonly failedSpans: number;
    readonly interruptedSpans: number;
    readonly logs: number;
    readonly rootExit: Option<Exit>;
    readonly firstError: Option<{ readonly type: string; readonly message: string }>;
    readonly lastArrivalAt: Option<number>;
    readonly spans: ReadonlyMap<SpanId, JsonlSpanRecord>;
    readonly children: ReadonlyMap<SpanId | null, ReadonlyArray<SpanId>>;
    readonly topLevel: ReadonlyArray<SpanId>;           // root first, then other parent-less spans, by start
    readonly missingParents: ReadonlyArray<SpanId>;     // parent ids not in `spans`, by earliest child
}
```

A span is the decoded `JsonlSpanRecord` itself; no wrapper.

### Phases

| Phase       | When                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| `waiting`   | the file is missing (at startup, or after a removal)                                      |
| `loading`   | reading toward the size seen when reading began; `bytesRead / bytesTotal` is the progress |
| `following` | caught up, watching for more                                                              |
| `done`      | caught up under `--no-follow`; nothing more will arrive                                   |

A Reset returns to `loading` (or `waiting` after a removal).

### Publishing

- **Copy-on-write per trace.** On each publish the store freezes a new `Trace` (and `Run`) object only for those
  touched since the last publish, and reuses the rest by reference. `React.memo`, `Atom.family` and selectors work
  by identity. The `spans` and `children` maps of a touched trace are copied; an untouched trace is the same object.
- **Throttle**: the first publish is immediate, then at most one every **100 ms**, trailing edge, on the live clock.
  A Reset, `Missing`, `CaughtUp` and `Failed` publish at once.
- The snapshot goes into the `SubscriptionRef`.

### Resets

On `Reset` the store clears the index and the bad-line counts and samples, bumps `epoch` and `version`, sets
`lastReset` to the reason and clock time, and publishes at once. Trace and span ids can therefore disappear;
screens show placeholders ([04-navigation.md](04-navigation.md#missing-ids)). The body cache survives (bodies are
content-addressed).

## `Bodies`

```ts
interface BodyText { readonly text: string; readonly truncated: boolean; readonly bytes: number }
class BodyMissing    extends Schema.TaggedError<BodyMissing>()("BodyMissing", { sha256: Schema.String, path: Schema.String }) {}
class BodyReadFailed extends Schema.TaggedError<BodyReadFailed>()("BodyReadFailed", { sha256: Schema.String, path: Schema.String, message: Schema.String }) {}

read(sha256: string, declaredBytes: number): Effect<BodyText, BodyMissing | BodyReadFailed>
```

- Reads `<bodiesDir>/<sha256>.txt` whole. The writer caps a body at 1,000,000 characters (`MAX_BODY_CHARS`), so a
  file is at most about 4 MB.
- `truncated` is true when the span's `<prefix>.bytes` (passed as `declaredBytes`) exceeds the file's byte length.
  `bytes` is the declared full length. The writer also appends a `truncated N chars` line to the text; it stays.
- An LRU keyed by sha256 holds up to **32 MB of text**. It survives a Reset.
- `stat` is a cheap `stat` of the file, for the details pane's truncated and missing marks; a stat error reads as
  missing.
- No sha256 check on read.

## Bridge

`src/bridge/` turns services into atoms (`effect/reactivity`) and is the only place that does. Components read them
with `useAtomValue` and write with `useAtomSet` from `@effect/atom-react`.

- **Registry**: a layer builds the `AtomRegistry` and the atoms below from the running services, and `app.tsx` hands
  it to `RegistryContext.Provider`. Do not use `Atom.runtime(layer)` as the owner of services: nothing waits for its
  cleanup.
- `snapshotAtom = Atom.subscriptionRef(store.snapshot)`.
- `nowAtom`: the current time from Effect's `Clock`, refreshed every **1 s** by a fiber in the bridge layer (live
  marks have 5 s resolution, and run labels show seconds). Tests drive it with `TestClock` or set it directly.
- `navAtom`: writable `Nav`, initialised from the CLI ([04-navigation.md](04-navigation.md)).
- `panesAtom`: writable session-wide pane sizes ([06-trace-view.md](06-trace-view.md#layout)).
- `bodyAtom = Atom.family((key: { sha256, bytes }) => Atom.make(Bodies.read(...)))`, read as an `AsyncResult`;
  `bodyStatAtom` likewise over `Bodies.stat`.
- **Derived views** are pure functions in `src/model/` over the snapshot and a screen's view state, wrapped in
  `Atom.map`/`Atom.family` keyed by ids and view state. Examples: run rows, trace rows with groups, a trace's
  flattened tree rows, log lines. Memoise per `Trace` identity, so an untouched trace costs nothing on publish. Key such caches
  with a `WeakMap` on the `Trace` object, never with `Atom.family` or `MutableHashMap` over a `Trace`: those key by
  structural `Equal`/`Hash` and would deep-compare its maps. `Atom.family` keys are ids and small view-state values.
- **Search** is a debounced (about **150 ms**) linear scan over the snapshot in a derived atom, with no index
  ([08-search.md](08-search.md)). The inverted index is a pre-approved remedy only if the search budget is missed.
- Component state, not atoms: open overlays, the text being typed in an input, and a list's transient wheel offset.
  There are no multi-key sequences to track.

## Memory and size target

- Every decoded record stays in memory; only bodies are read from disk. A decoded record costs 0.75–1.4 KB of heap.
- v1 targets **250k spans (about 100–130 MB of JSONL)** as fully interactive: about 200–350 MB live heap. Budgets in
  [12-performance.md](12-performance.md). There is no hard cap; bigger files load slower, and the README says so.
- The pre-approved memory remedy is interning repeated strings (`run`, `service`, `name`, `site.file`, `def.file`,
  attribute keys).
