---
id: "19"
title: Keymap and help across screens
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: [15, 16, 17, 18]
---

## Question

Once each screen's keys are known, make them one scheme and decide how they are shown. Decide:

- conflicts and consistency across the runs, traces, trace and body screens (`⏎`, `Esc`, `/`, `n`/`N`, `g`/`G`);
- the help bar: always visible or toggled, contents per screen and per focused pane, and a full help overlay
  on `?`;
- how key handling is built, given that `@opentui/keymap` requires Bun 1.3 or later and the TUI runs on Node
  only (see Runtime and Node version policy for packages/tui).

**Amended by** [Search and filter](17-search-and-filter.md): on Runs, Traces and Trace `/` opens a query input
that takes every key while open, and `Esc` clears an active query before it goes back. Whether the Body screen's
`Esc` does the same is for this ticket.

**Amended by** [Live-tail UX](18-live-tail-ux.md): `!` (any screen) opens the bad-line samples; `g`/`G` to the newest
end of a list also turns following back on.

## Resolution

2026-10-08, grilled with wmaurer.

### How key handling is built

- **Our own binding table, not `@opentui/keymap`.** The published `@opentui/keymap` 0.5.14 is plain ESM with no
  Bun API calls and no `engines` field (the Bun 1.3 requirement is only in the source repo's manifest), and its
  core loads under Node. It is still a poor fit: its scoping follows OpenTUI renderable focus, while ours is app
  state (the `Trace` view's `pane`, and whether an input or overlay is open), and its strengths (sequences,
  leaders, disambiguation) go unused.
- **One `useKeyboard` at the root** feeds a pure dispatch `(mode, nav, key) → Action` over a typed table of
  `{ keys, action, label, hintRank?, scope }`, where scope is global, the shared movement set, a screen, or the
  `Trace` screen plus a pane. Mode is `input` (a query or search input is open; every key is text), `overlay`
  (help or bad lines) or `screen`. Dispatch is testable without a renderer.
- The same table generates the hint line and the `?` overlay, so help cannot drift from behaviour.
- Keys match on the character received, not the physical key, so `/`, `+`, `<`, `?` work on any layout
  (Swiss-German included).

### Global keys

- **`Esc` peels one layer**, innermost first: an open input or overlay closes; else an active query clears (a
  list filter, the focused pane's query on Trace, the Body search, whose highlights previously had no `Esc`);
  else the screen goes back (nothing on `Runs`). Leaving a searched body takes two presses, like a filtered list.
- **`q` quits immediately**, no confirmation: the viewer is read-only. In an input it is text; in an overlay it
  closes the overlay.
- **`Ctrl-c` quits from anywhere**, inputs included. The renderer is created with `exitOnCtrlC: false` and the
  table routes `Ctrl-c` to the quit action, which interrupts the main fiber so Effect's scope closes the watcher
  and restores the terminal; the renderer never exits on its own.
- **`Ctrl-z` suspends** to the shell: `renderer.suspend()` (already needed for `e`), then `SIGTSTP` to self; a
  `SIGCONT` handler calls `resume()`. Raw mode does not deliver `Ctrl-z` as a signal, so this must be ours.
- `/` query, `?` help, `!` bad lines, as settled in their tickets. Unbound keys are ignored silently.

### Consistency changes

- **Pane focus moves to `1`/`2`/`3`** (tree, details, logs) plus `Tab`/`Shift-Tab`; `t`/`d`/`l` are gone. Pane
  titles carry their number (`1 Tree`, `2 Details`, `3 Logs`). This frees **`h`/`l` to mean left/right on every
  screen**: in the tree `h`/`←` fold or go to the parent and `l`/`→` unfold; in Body they scroll sideways. It
  also removes `d` as a near-miss of `Ctrl-d`.
- **One movement set** for every list, pane and pager, defined once: `j`/`k`/`↑`/`↓` row · `Ctrl-d`/`Ctrl-u` half
  page · `PgDn`/`PgUp` page · `g`/`G`/`Home`/`End` ends · wheel · click. This fills the gaps (details had no `G`,
  logs no half page, lists no page keys). On Runs and Traces, reaching the newest end with `g`/`G` still resumes
  following, as "Live-tail UX" decided.
- **`Space` toggles where rows fold** (lists, tree) and **pages down in Body**, the pager convention.
- **Per-screen meanings stay** where keys never meet on one screen: `r` reverse (lists) / raw (Body), `e`
  source location (Trace) / body file (Body), `s` log scope (Trace) vs `S` sort (lists).
- **`=` is an alias for `+`** (widen the split).
- `y` stays Body-only in v1; copying ids from the trace view is later work.

### Hint line

- **Always on, no toggle, inside the status bar's left part** ("Live-tail UX"), not a separate row. Table entries
  with a `hintRank` show, best first, for the current screen and focused pane, as many as fit, always ending in
  `? help`. Hints drop before any part of the file segment; `? help` drops last.
- A status message ("no bodies on this span", "file truncated — reloaded") replaces the hints while it shows,
  and an active query's line (`/ payment declined · 12 of 3000`) takes their place, as "Search and filter"
  decided.
- Examples: Runs `⏎ open · / filter · n problem · S sort · ? help`; Trace tree
  `⏎ fold · / search · n problem · b body · o origin · ? help`; Body `/ search · r raw · w wrap · y copy · ? help`.

### Help overlay

- `?` opens a centred bordered box over the current screen, which stays visible and live around it.
- **Current screen only**, in three groups: the screen's keys (on Trace by pane, focused pane first and marked),
  movement, and global keys plus one line on the mouse.
- It scrolls with the movement keys when it does not fit; `?`, `Esc` or `q` close it; other keys are ignored.
  The `!` bad-line overlay follows the same modal rules.

### Mouse

- A click on a row selects it and focuses its pane; on a list it stops following, like any move.
- A click on the already-selected row acts as `⏎` (open, fold, or jump to a log's span). No double-click
  detection: OpenTUI sends only down and up.
- A click on a fold mark (`▾`/`▸`) or a group row toggles it.
- **The wheel scrolls the pane under the pointer**, without moving focus or selection. In a windowed list this
  needs a transient scroll offset (component state, not view state) that snaps back to keep the selection in
  view on the next key move; a following list keeps following.
- Already settled elsewhere: dragging the divider, clicking a Bodies row. No mouse on the breadcrumb, hint line,
  column headers or axis.

### The v1 keymap

| Scope             | Keys                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global            | `/` query · `Esc` peel one layer · `?` help · `!` bad lines · `q` quit · `Ctrl-c` quit anywhere · `Ctrl-z` suspend                                 |
| Movement (shared) | `j`/`k`/`↑`/`↓` · `Ctrl-d`/`Ctrl-u` · `PgDn`/`PgUp` · `g`/`G`/`Home`/`End` · wheel · click                                                         |
| Runs, Traces      | `⏎` open, or fold a group · `Space` fold a group · `n`/`N` problem · `S` sort · `r` reverse · `g`/`G` at the newest end resumes following          |
| Trace (any pane)  | `1`/`2`/`3` focus tree, details, logs · `Tab`/`Shift-Tab` cycle · `-`/`+`/`=` split · `<`/`>` name column · `s` log scope · `b` body · `e` editor  |
| Trace, tree       | `⏎`/`Space` fold or open a group · `h`/`←` fold or parent · `l`/`→` unfold · `n`/`N` problem or match · `o` origin · `E` expand all · `C` collapse |
| Trace, logs       | `⏎` select the log's span                                                                                                                          |
| Body              | `Space` page · `h`/`l`/`←`/`→` sideways · `Tab`/`Shift-Tab` body · `r` raw · `w` wrap · `n`/`N` match · `y` copy · `e` editor                      |
