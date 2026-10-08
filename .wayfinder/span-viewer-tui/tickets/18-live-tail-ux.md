---
id: "18"
title: Live-tail UX
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: [15]
---

## Question

How does the TUI behave while the file grows? Storage and marking of partial traces are settled in "Data
layer: tailing, indexing and exposing the file to React". Decide:

- whether there is a follow mode that keeps the newest run or trace selected, how it is turned on and off,
  and what turns it off (moving the selection by hand?);
- how new data is signalled on screens that do not show it (a counter, a status bar marker);
- what the trace view does when an open trace gains spans: keep the selection and folds, extend the axis;
- what the status bar shows about the file (following, lines read, bad lines, file truncated or replaced).

## Resolution

2026-10-08, grilled with wmaurer.

### Following

- **Following is `selected: None`** on the Runs and Traces screens; no new view field and no toggle key. While a
  list follows, its selection sits on the newest row: the top of Runs (newest first), the bottom of Traces
  (by start). Under an active filter it is the newest matching row.
- **Moving the cursor stops following**: any move (`j`/`k`, `n`/`N`, a click) stores an id, and the cursor then
  stays on its row as rows arrive.
- **Jumping to the newest end follows again**: `g` on Runs and `G` on Traces in their default sort, the other key
  when reversed with `r`. It sets `selected` back to `None`, like `less +F`.
- **Only a time sort follows.** Under another sort `None` just means the first row, as before.
- A screen pushed with a seeded selection (the CLI's `--run`, `--trace`) starts on that row, not following.
- The trace view never follows; see below.

### New data off screen

- **A list that has stopped following counts new rows** beyond its newest end: `↑ 3 new` on Runs, `↓ 12 new` on
  Traces, in the status bar. Rows that grow in place (an older trace gaining spans) are not counted; under a
  filter only matching rows count. The count resets when the list follows again, and a list keeps counting while
  it is underneath on the stack, so going back shows it.
- No flash or highlight on new rows: the `●` live and `▸` running marks already say what is fresh.
- The trace view and the Body screen show no "new elsewhere" counts, only the status bar's phase.
- No terminal bell and no notification, failures included.

### An open trace that grows

- **Selection and folds are kept by id.** New spans appear expanded, since `folded` lists only what was folded.
  When the root arrives, the `⋯ missing parent` placeholder goes and the tree re-parents under it.
- **The selected row keeps its place on screen**: rows inserted above it shift the window, not the cursor. The
  logs pane keeps its current line the same way.
- **The axis is recomputed on every snapshot.** While the trace is running (live, no root yet) its end is
  rounded up to the next axis tick, so bars rescale only when the trace crosses a tick, not every 100 ms. The
  header's duration ends in `…`, as in the lists.
- **A group can form mid-view**: when a parent's 20th same-name child arrives, the siblings fold under a closed
  group row, and the selected member stays visible beneath it, as failed members do.
- **The opening selection is computed once, at push.** A running trace opened before anything failed selects
  its first row; a failure arriving later does not move it, and `n` finds it.
- No follow mode inside a trace: spans are ordered by start, not arrival, and children arrive before parents,
  so "newest" would jump around the tree.

### Status bar

One line at the bottom of every screen (the search input replaces it while open): the screen's messages and
hints on the left, the file segment on the right, in this order:

| Part     | Shows                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| new rows | `↑ 3 new` / `↓ 12 new` on a list that has stopped following                                                                                                              |
| problems | `⚠ 3 bad lines` amber, `!` opens the samples overlay · `120 lines from otelscope < 0.3 skipped` dim                                                                      |
| file     | the file's basename, dim                                                                                                                                                 |
| phase    | `waiting for <absolute path>…` · `loading 43% · 41 / 96 MB` · `● following` green while a record arrived in the last 5 s, else `following` dim · `read once` (no follow) |
| size     | `57 runs · 12,480 spans`                                                                                                                                                 |

- **Resets** flash `file truncated — reloaded` or `file replaced — reloaded` on the left for 5 s; the phase then
  reads `following · reloaded 12:03:04` until the next record arrives.
- **Read and watch errors** show `⚠ <error>` in red in place of the phase until a read succeeds again.
- **Narrow terminals** drop parts from the left first; the phase always stays.
- Runs and spans are shown, not lines read: bad lines are counted on their own.

### No pause

No key freezes updates in v1. Selection by id, the anchored selected row and the `new` counts already keep a
list still, and a pause would be a state that can hide everything else. Reading a file as it stands is the CLI's
no-follow flag, whose name is for "CLI surface and npm packaging". A `p` that freezes snapshots while the store
keeps indexing could be added later without changing the above.
