# 05 · Runs and Traces screens

Two flat tables built on the windowed list ([09-keys-and-chrome.md](09-keys-and-chrome.md#windowed-list)). Rows come
from the store's aggregates, so a list never walks spans.

Sources: [Run and trace list screens](../../../.wayfinder/span-viewer-tui/tickets/15-list-screens.md),
[Live-tail UX](../../../.wayfinder/span-viewer-tui/tickets/18-live-tail-ux.md),
[Search and filter](../../../.wayfinder/span-viewer-tui/tickets/17-search-and-filter.md),
[Run identity](../../../.wayfinder/span-viewer-tui/tickets/14-run-identity.md). The prototype that chose this layout
(variant D of `prototype/list-screens`) is no longer in the repo; this file is the reference.

## Shared layout

```
Runs                                                                   ← breadcrumb
   service          started     duration  traces  failed   spans   logs  run
 ● ✗ shop-api        14:03:27      1.24s…      6       1      84     23  2026-10-06T14-03-27-070-0001
   ✗ support-agent   14:03:29      3.10s       1     (2)      41     12  2026-10-06T14-03-29-113-0002
 …
⏎ open · / filter · n problem · S sort · ? help          ⚠ 3 bad lines  spans.jsonl  ● following  4 runs · 511 spans
```

- A dim header row names the columns; the sorted column carries `▾` (or `▴` when reversed).
- The selected row has the selection background. Problem marks keep their colours on it.
- Numbers are right-aligned with thousands separators; zero counts are blank, not `0`.
- **Narrow terminals** (below 100 columns) drop columns in this order: run id (Runs), logs, spans. Flexible columns
  (service, root span, error) shrink and end in `…`.

## Runs screen

**Columns:** marks, service, started, duration, traces, failed, spans, logs, run id (dim).

- **service**: the run's service, `(unnamed)` when empty (muted).
- **started**: `14:03:27` today, `yest 14:03` yesterday, `Tue 14:03` within the last 6 days, `2026-09-30 14:03`
  before that, in local time, judged against `nowAtom`.
- **duration**: `lastEndMs - firstStartMs`, ending in `…` while the run is live.
- **failed**: `failedTraces` in failure colour; when it is 0 but `failedSpans` is not, `(failedSpans)` dim.
- A run's **label** everywhere else (breadcrumb, placeholders) is `service · started`: `shop-api · 14:03:27`.

**Sort** (`S` cycles, `r` reverses): `newest` (by `firstStartMs`, newest first; the default), `service` (then
newest), `failures` (`failedTraces`, then `failedSpans`, most first), `duration` (longest first).

**No grouping by service**: the question while working is "what just ran". Narrowing to a service is `/shop-api`.

## Traces screen

**Columns:** marks, root span, started, duration, spans, failed, logs, error.

- **root span**: the trace's `headName`; for a partial trace, muted with `(partial)` after it.
- **started**: offset from the run's `firstStartMs`, `+1.24s`.
- **duration**: `endMs - startMs`, ending in `…` while running.
- **failed**: `failedSpans`.
- **error**: `firstError` as `Type: message` (`Type` alone when the message is empty), bright when the root failed,
  dim when the trace recovered.

The screen lists `run.traceIds`. A trace in two runs appears in both.

**Sort** (`S` cycles, `r` reverses): `start` (oldest first; the default), `duration` (longest first), `failures`
(root failed first, then `failedSpans`), `spans` (most first). Ties break on start.

### Groups

- A root span name (a trace's `headName`, so a partial trace groups by its earliest span's name and may move into
  its root's group when the root arrives; the selection follows it by id) with **20 or more traces** in the run folds
  under a heading row; smaller names stay flat rows. The
  count is over the run's traces, ignoring the filter, so groups don't appear and vanish while typing.
- The heading uses the same columns: `▸ POST /orders ×3000` (`▾` when open), the first member's offset, the members'
  **p50** duration, total spans, **failed traces**, total logs, and the most common error
  (`500× PaymentDeclined · 2 other errors`; on a tie, the type of the member shown first in sort order). Under a filter it counts matching members only:
  `▸ POST /orders ×12 (of 3000)`.
- **Groups start closed.** A closed group still shows at most **5** of its failed, interrupted or running members, in
  sort order, indented under the heading, then one row for the rest:
  `⋯ 495 more failed · 3 interrupted · 500 recovered · 2000 ok`. Each category counts members not shown and is
  omitted at 0; "failed" means the root failed, "recovered" means spans failed but the root succeeded.
- `⏎` or `Space` on a heading or the "more" row toggles the group (`openGroups` holds root span names).
- The sort applies inside a group, and a group sits where its first member in sort order would.
- Group headings (p50, most common error) are derived per render from the group's traces.

## Marks

| Mark       | Run                                      | Trace                            |
| ---------- | ---------------------------------------- | -------------------------------- |
| `●` green  | live                                     |                                  |
| `✗` bright | a trace whose root is in this run failed | the root failed                  |
| `✗` dim    | spans failed, every root succeeded       | spans failed, the root succeeded |
| `⊘` amber  | interrupted spans                        | the root was interrupted         |
| `▸` accent |                                          | running: live and no root yet    |
| `?` muted  |                                          | partial: no root and not live    |

The marks column is two cells: a run shows `●` (or a space) and then its worst problem mark (bright `✗` before dim
`✗` before `⊘`); a trace shows one mark by the same priority, then `▸`, then `?`. The format has no end-of-run
marker, so live is a 5-second window, and only while following ([03-data-layer.md](03-data-layer.md#live)).

## Problems: `n` and `N`

On both lists `n`/`N` move to the next/previous **visible** problem row: on Runs, runs with `failedTraces > 0` (a
trace whose root is in the run failed); on Traces, traces whose `rootExit` is `Failure` or `Interrupted`. Recovered
traces, and runs with only interrupted or recovered spans, keep their marks but are not stops. Landing on a closed
group's "more" row with hidden problems opens the group and selects the first (with `N`, the last) hidden one. They
wrap around. With no problem rows the status line says `no problems`.

## Following

- **Following is `selected: None`**, and only under a time sort (`newest` on Runs, `start` on Traces). While a list
  follows, the selection sits on the newest row: the top of Runs, the bottom of Traces, or the other end when
  reversed. Under a filter it is the newest matching row; when the newest trace is inside a closed group, the
  selection sits on the group's heading.
- Under any other sort, `None` just means the first row, and the list never follows.
- **Moving stops following**: any move (movement keys, `n`/`N`, a click) stores an id. The move that leaves
  following (from `None` to an id) also sets `newerThan` to the newest row's start time (`firstStartMs` for runs,
  `startMs` for traces); later moves leave it alone, so the count keeps growing.
- **Jumping to the newest end follows again**: `g` on Runs and `G` on Traces in their default direction (the other key
  when reversed) set `selected` and `newerThan` back to `None`, like `less +F`.
- A screen whose `selected` was seeded by the CLI starts on that row, not following.

### New rows

A list that has stopped following, under a time sort, counts the visible rows whose start time is greater than
`newerThan`, and the status bar shows `↑ 3 new` (Runs) or `↓ 12 new` (Traces). Rows that grow in place are not
counted, because their start does not move later; under a filter only matching rows count. The count is derived per
snapshot, so a list keeps counting while it is underneath on the stack, and going back shows it. A Reset re-reads old
rows with old start times, so they are not counted as new. No flash, no bell, no notification.

## Live data

Rows appear and counts grow on every publish. Selection stays on its id; the windowed list keeps the selected row
where it is on screen when rows are inserted above it.

## Empty and special states

In place of the table:

| Condition                         | Shows                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| phase `waiting`                   | `Waiting for <absolute path>…`                                                                        |
| phase `loading`, no runs yet      | `Loading…`                                                                                            |
| no runs, `legacy > 0` (Runs only) | `This file was written by @wmaurer/otelscope-effect < 0.3 (N lines). Rerun your program with >= 0.3.` |
| no runs otherwise                 | `No spans in <basename> yet.` (`following`) or `No spans in <basename>.` (`done`)                     |
| a filter matching nothing         | `No runs match "<query>".` / `No traces match "<query>".` with `Esc clears the filter`                |

The legacy notice gives way to the run list as soon as a valid line arrives, and under `--no-follow` it stays.

## Keys

Movement set ([09-keys-and-chrome.md](09-keys-and-chrome.md#the-v1-keymap)) plus:

| Key       | Action                                                                    |
| --------- | ------------------------------------------------------------------------- |
| `⏎`       | open the run or trace; on a group heading or "more" row, toggle the group |
| `Space`   | toggle a group                                                            |
| `n` / `N` | next / previous problem                                                   |
| `S` / `r` | cycle sort / reverse                                                      |
| `/`       | filter ([08-search.md](08-search.md))                                     |
| `Esc`     | clear the filter, else back (nothing on Runs)                             |

Opening a trace pushes it with its opening selection ([06-trace-view.md](06-trace-view.md#opening-a-trace)) and the
filter seeded as its tree search.
