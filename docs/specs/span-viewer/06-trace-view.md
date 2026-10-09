# 06 · Trace view

One trace: a span tree with waterfall bars, a details pane for the selected span, and a logs strip. otel-tui's layout
at 50:50, with Effect-aware exit and cause rendering.

Sources: [Trace view layout and interaction](../../../.wayfinder/span-viewer-tui/tickets/10-trace-view-prototype.md)
and its amendments, [Prior art](../../../.wayfinder/span-viewer-tui/tickets/06-prior-art-survey.md),
[Source locations](../../../.wayfinder/span-viewer-tui/tickets/11-source-locations.md),
[Live-tail UX](../../../.wayfinder/span-viewer-tui/tickets/18-live-tail-ux.md),
[Search and filter](../../../.wayfinder/span-viewer-tui/tickets/17-search-and-filter.md),
[Keymap and help](../../../.wayfinder/span-viewer-tui/tickets/19-keymap-and-help.md). The prototype
(`prototype/trace-view`) is no longer in the repo; this file is the reference.

## Layout

```
Runs › shop-api · 14:03:27 › POST /orders 5643b831
POST /orders  5643b831  ✗ Failure  1.24s  84 spans · 3 failed · 23 logs
┌ 1 Tree ──────────────────────────────────────────┐┌ 2 Details ────────────────────────────────┐
│                          0      │200ms   │400ms  ││ payment.charge  ✗ Failure                 │
│✗ ▾ POST /orders     1.24s ███████████████████████││ 12.3ms · +245.1ms · 14:03:27.315           │
│  ├ ▸ order.validate 2.36ms ┃                     ││ span 51e618f6… · parent 1607aed8… · #7     │
│✗ └ ▾ payment.charge 12.3ms    ██▌✗               ││ at fixture/scenarios.ts:154:16             │
│ …                                                ││ Cause                                      │
└──────────────────────────────────────────────────┘└────────────────────────────────────────────┘
┌ 3 Logs · 12 · span + descendants ───────────────────────────────────────────────────────────────┐
│ +245.1ms  ERROR #7  payment.charge  payment failed  order.id=ord_1004                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
⏎ fold · / search · n problem · b body · o origin · ? help           spans.jsonl  following  4 runs · 511 spans
```

- **Line 1** is the breadcrumb ([04-navigation.md](04-navigation.md#breadcrumb)).
- **Line 2** is the trace header: `headName`, short id, the root's exit (or `running` / `partial`), duration (ending
  in `…` while running), span, failed-span and log counts, and, when the trace spans several runs, `runs:` with each
  run's label.
- **Wide** (100 columns or more): tree | details side by side over the full height minus the logs strip. The logs
  strip is 30% of the height below line 2, at least 6 rows.
- **Stacked** (below 100 columns): the tree full width on top, details | logs side by side below at 50:50. The same
  keys apply; the split moves the boundary between the tree and the row below.
- Panes are bordered boxes titled `1 Tree`, `2 Details`, `3 Logs · <count> · <scope>`. The focused pane's border
  takes the focus colour.

### Pane sizes

`panesAtom` holds `{ split: number; nameColumn: number }`, session-wide (it survives Back and moving between traces):

- `split` is the tree's share in percent: default **50**, from 25 to 80. `+` (or `=`) widens the tree by 5, `-`
  narrows it. Dragging the divider with the mouse sets it to the nearest whole percent in range.
- `nameColumn` is the width of the guides-and-name column: default **32** cells, from 16 to the tree pane's width
  minus 18. `>` widens it by 5, `<` narrows it.

## Opening a trace

The opening selection is computed once and stored in `selected` ([04-navigation.md](04-navigation.md#pushes)):

1. With a seeded search: the first span in tree order that matches every term, unfolding its ancestors and opening
   its group. If none does (the trace matched across spans), fall through, and the search line reads
   `no single span matches all terms`.
2. The first **failure origin** in tree order.
3. The first interrupted span.
4. The root, or the first row of a partial trace.

Everything starts expanded (`folded` empty). Same-name groups start closed.

## The tree

**Tree order** is depth first: the root, then other parent-less spans, then each orphan group (by its earliest
child's start); children in `children` order (by start). A span folded hides its descendants.

### Rows

```
▌✗ │ ├ ▾ payment.charge        12.3ms │ ██▌◆ ✗
```

From the left: a 1-cell **match gutter** (`▌` in the accent colour when the span matches the tree search), the
2-cell **exit glyph**, the **guides and name** column (`nameColumn` cells), the **duration** (8 cells,
right-aligned), a space, and the **bar** column (the rest).

- **Exit glyph**: `✗` bright red on a failure origin, `✗` dim red on a span the failure only propagated through,
  `⊘` amber on an interrupted span, nothing on success.
- **Guides**: 2 cells per level, `│ ` or `  ` for each ancestor level and `├ ` or `└ ` for the row's own, then the
  fold mark (`▾` expanded, `▸` folded, a space on a leaf), a space, and the name. The name is red only on a failure
  origin.
- **Deep trees**: past 4 levels, the guides show `⋯<depth>` and then only the innermost 4 levels, so the name stays
  visible (the fixture's 41-level trace needs this).
- A name that does not fit ends in `…`. A folded span or closed group hiding search matches appends
  ` · 3 matches` (accent).
- **Orphan groups** sit under a placeholder row, `⋯ missing parent ab12cd34…` (muted, no bar), with the orphans as its
  children. The row disappears and the tree re-parents when the parent arrives.

### Same-name groups

When a parent (or the top level) has **20 or more** children with one name, those siblings fold under a group row:

```
  ├ ▸ import.row ×400 · 6 failed            1.31s ░░░░░░░░░░░░░░░░░░
```

- The group's bar `░` spans the members' envelope (earliest start to latest end); its duration is that envelope.
- **Groups start closed.** A closed group still shows, beneath its row, the members that are failed or interrupted,
  the selected member, and nothing else. So `n`/`N`, the opening selection and the selection itself reach them.
- `⏎` or `Space` on the group row opens or closes it (`openGroups` holds `GroupKey`s, `parentId|name`, with `""` for
  the top level).
- Members show no distinguishing attribute in the tree; that stays in details.
- With the group row selected, **details** shows: the name and count; counts by exit; duration min, p50, p95 and
  max; and up to 20 problem members as `✗ import.row #217  RowInvalid` (index in start order), then `… and N more`.
- A group can form while the trace is open (the 20th sibling arrives): the siblings fold under a closed group row,
  and the selected member stays visible beneath it.

### Folding

| Key           | Action                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `⏎` / `Space` | toggle the fold of a span with children; toggle a group row; nothing on a leaf                                                   |
| `h` / `←`     | fold an expanded span with children, else move to its parent row (or group row)                                                  |
| `l` / `→`     | unfold a folded span                                                                                                             |
| `E`           | expand all: clear `folded`, open every group                                                                                     |
| `C`           | collapse below the root's children: fold every child of the root (and every top-level span) that has children; close every group |

A click on a fold mark or a group row toggles it.

## The waterfall

### Scale

The time range is `[trace.startMs, end]`, where `end` is `trace.endMs`, rounded **up to the next axis tick** while
the trace is running (live, no root), so bars rescale only when the trace crosses a tick, not every 100 ms. It is
recomputed on every snapshot.

For a bar column of `W` cells, `x(t) = (t - start) / (end - start) × W`.

### Bars

- A span covers `[x(startMs), x(startMs + ms)]`. The bar starts at cell `⌊x(startMs)⌋`, fills whole cells with `█`,
  and ends with the eighth block for the fractional end (`▏▎▍▌▋▊▉` for 1/8 to 7/8).
- A bar shorter than 1/8 cell draws `┃` in its start cell.
- After clamping to `[0, W)`, a child never starts left of its parent's start cell.
- Bars take the exit colour: success the bar colour, failure origin bright red, propagated dim red, interrupted
  amber. A group bar is `░` in the muted colour.
- Bars are drawn per cell in a custom renderable (OpenTUI `extend()`), not as text spans.

### Event markers

Each event draws a marker on its span's bar row at cell `⌊x(startMs + offsetMs)⌋`: `✗` (failure colour) for an
`exception` event, `◆` (log-level colour, or muted for other events) for the rest. Several events in one cell collapse
into one marker, `✗` winning.

### Axis

A sticky row above the tree rows, over the bar column only. The tick interval is the smallest of `1, 2, 5 × 10ⁿ`
milliseconds (down to 1 µs) whose spacing is at least **10 cells**. Ticks sit at exact multiples of the interval from
the trace start. Each tick draws `│` followed by its label in the duration format (`│200ms`, `│1.20s`); a label that
would run into the next tick is left off. The first tick is `0`.

## Exit and cause

- **Failure origin**: `exit: "Failure"` and no child failed. **Propagated**: failed with a failed child.
- **Two exceptions are the same** when `exception.type` matches and their throw-site frame (the first kept frame,
  below) matches.
- **Origin of a propagated span**: the first failure origin in its subtree, in tree order, whose exception is the same
  as this span's; if the span has no exception event, the first failure origin in its subtree. `o` jumps there
  (unfolding as needed). On a span with no such origin, the status line says `no cause origin`.

### Stack frames

`exception.stacktrace` is parsed line by line. A frame is `at <name> (<loc>)` or `at <loc>`, where `<loc>` is
`<path>:<line>:<col>` and the path may be a `file://` URL. Frames with no location, under `node_modules/`, or with a
`node:` path are dropped. The first remaining frame is the **throw-site frame**. Paths are shown cut to their last two
segments (`fixture/scenarios.ts:154:16`).

### The Cause section

**At a failure origin**, the full cause:

```
Cause
PaymentDeclined                          ← bold, failure colour
(no message)                             ← or the message; typed errors have an empty message
thrown at fixture/scenarios.ts:120:15
in span payment.charge  fixture/scenarios.ts:154:16
  defined at fixture/scenarios.ts:96:30
in span payment.attempt  fixture/scenarios.ts:50:20
```

The throw-site frame is `thrown at`. Each later frame is `in span <name>` when `<name>` is the name of a span in the
trace, else `in <name>`. A frame named `<name> (definition)` is shown as `defined at` indented under the frame before
it. More than one `exception` event shows each, in order, separated by a blank line.

**On a propagated span**: one line, `↳ PaymentDeclined, from payment.attempt`, naming the origin (the hint line
offers `o origin`).

**A failed span with no exception event**: `failed because <child name> failed` (its first failed child), or
`failed (no exception recorded)` when no child failed.

**An interrupted span**: an `Interrupted` section, `The span's fiber was interrupted before it finished.`

## The details pane

For the selected span, top to bottom. **Empty sections are hidden.** It scrolls (`detailsTop`, reset to 0 when the
selection changes) and has no cursor.

1. **Header**
    - name and exit (`✗ Failure`, `⊘ Interrupted`, `Success`);
    - duration · start offset from the trace start · clock time (`14:03:27.315`, local);
    - `span <id> · parent <id> · #<fiber>` (the parent omitted for a root, the fiber omitted when `fiber` is `null`);
    - `run <label>`, only when the trace spans several runs;
    - `at <site>` and, for `Effect.fn` spans, `defined at <def>`, each omitted when `null`, paths cut to two segments.
2. **Cause** (above).
3. **Bodies**: one row per body prefix, sorted by prefix: prefix, size (`<prefix>.bytes`), and the one-line
   `<prefix>.preview`. A truncated body's row is marked `⚠ truncated`, and a body whose file is missing `⚠ missing`, from
   `Bodies.stat` (the file's size against `.bytes`). A click on a row opens it in the Body screen.
4. **Attributes**: sorted by key, `key  value`, values as strings (arrays and `null` as JSON), long values wrapped.
   Hidden: `span.label`, `status.interrupted` (the exit says it), and each body's `.sha256`, `.bytes` and `.preview`
   (shown under Bodies).
5. **Events (n)**: every event in offset order, `+offset  name  key=value …` with the offset from the span's start.
   A log shows its level; an `exception` event shows `exception  Type: message` without the stack (Cause has it).

**With a group row selected**: the group summary described under [Same-name groups](#same-name-groups).
**With a missing-parent row selected**: `Missing parent <full id>` and `<n> spans reference it.`

## The logs pane

The **logs** (events carrying `effect.logLevel`) of the spans in scope, one line each, ordered by absolute time
(`startMs + offsetMs`). Exception events and other events are not logs; they are in details and on the bars.

```
+245.1ms  ERROR  #7   payment.charge   payment failed  order.id=ord_1004
            ↳ PaymentDeclined: (no message)
```

- **Offset** from the trace start. **Level** padded to 5 and coloured by level (`TRACE`, `DEBUG`, `INFO`, `WARN`,
  `ERROR`, `FATAL`). **Fiber** from `effect.fiberId` as `#n`. **Span** name, cut to 20 cells.
- **Message** is the event name. A multi-value log (a name that parses as a JSON array) is flattened to one line,
  its elements separated by spaces, strings unquoted.
- **Annotations** are the event's other attributes as `key=value` (dim), except `effect.logLevel`, `effect.fiberId`
  and `effect.cause`.
- A logged `effect.cause` adds a `↳` line with the cause's first line.
- **Scope** (`logScope`): `span`, `subtree` (the selected span and its descendants; the default, so the root shows the
  whole trace) or `trace`. `s` cycles it. The title shows the count and scope.
- `logFilter` filters within the scope ([08-search.md](08-search.md)).
- The cursor (`logCursor`) moves with the movement set. `⏎` (or a click on the selected line) selects that log's span
  in the tree, unfolding to it; focus stays in the logs pane, and the cursor stays on the same log.
- With a group row selected, the scope is the group's members (and their descendants under `subtree`).

## An open trace that grows

- Selection, folds and open groups are kept by id. New spans appear expanded.
- **The selected row keeps its place on screen**: rows inserted above it shift the window, not the cursor. The logs
  pane keeps its cursor line in place the same way.
- When the root arrives, the missing-parent row goes and the tree re-parents under it.
- The opening selection is not recomputed: a failure arriving later does not move the cursor, and `n` finds it.
- No follow mode inside a trace: spans are ordered by start, not arrival, so "newest" would jump around.

## Search in the tree

`/` from the tree or details pane edits `search` ([08-search.md](08-search.md)): matches are highlighted, never
hidden. Typing moves the selection to the first match at or after the current span, unfolding as needed. While a
search is active, `n`/`N` move between matches (wrapping, unfolding and opening groups on the way) and the status
line shows `match 3/17`; with it cleared they move between problem spans again. As spans arrive, highlights and `match 3/17` update, and the
cursor never moves by itself. `/` from the logs pane edits `logFilter` instead. The two queries are independent; `Esc` clears the focused pane's query first.

## Opening things

- **`b`** (any pane) opens the selected span's first body (Bodies order) on the Body screen. A span with no bodies
  sets the status message `no bodies on this span`.
- **`e`** (any pane) opens `def` if present, else `site`, in `$VISUAL`, else `$EDITOR`
  ([09-keys-and-chrome.md](09-keys-and-chrome.md#editor)). With no location: `no source location for this span`.

## Keys

The movement set ([09-keys-and-chrome.md](09-keys-and-chrome.md#the-v1-keymap)) moves the tree selection, scrolls
details, or moves the logs cursor, by focused pane.

| Scope    | Keys                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any pane | `1`/`2`/`3` focus tree, details, logs · `Tab`/`Shift-Tab` cycle · `-`/`+`/`=` split · `<`/`>` name column · `s` log scope · `b` body · `e` editor · `/` search (tree or logs) |
| Tree     | `⏎`/`Space` fold or toggle a group · `h`/`←` fold or parent · `l`/`→` unfold · `n`/`N` problem, or match while searching · `o` origin · `E` expand all · `C` collapse         |
| Logs     | `⏎` select the log's span                                                                                                                                                     |

A click on a row selects it and focuses its pane; a click on the selected row acts as `⏎`.
