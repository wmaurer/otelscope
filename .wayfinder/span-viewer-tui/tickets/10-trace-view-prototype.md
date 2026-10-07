---
id: "10"
title: Trace view layout and interaction
labels: [wayfinder:prototype]
status: closed
assignee: wmaurer
blocked_by: [02, 05, 06, 07]
---

## Question

How should the trace view look and behave? Build a rough OpenTUI React trace view against the sample
fixture, with layout variants to switch between:

- the span tree with waterfall bars, a details pane, and a logs pane;
- the keymap for moving, folding and switching panes;
- colours and Effect-aware rendering of exit states and causes.

React to it together, then record the chosen layout, keymap and rendering rules.

## Resolution

2026-10-07, prototyped and reviewed with wmaurer. Prototype: `prototypes/trace-view/` on the throwaway branch
`prototype/trace-view` (commit 2a68534), four switchable layouts over the sample fixture, run with Bun.
Its `NOTES.md` lists the variants that lost.

**Layout: otel-tui's, at 50:50.** The span tree with waterfall bars on the left, details on the right, and a
logs strip across the bottom. The split starts at 50:50 (otel-tui uses 29:21) and `-`/`+` resize it by 5%,
from 25:75 to 80:20. `<`/`>` resize the name column by 5 cells. Both sizes live in the session-wide pane-size
Atom. Below 100 columns the view stacks instead: the tree full width on top, details | logs below, same keys.

**Opening a trace.** Fully expanded (`folded` empty), with the selection on the first problem span: the first
span in tree order where a failure started, else the first interrupted span, else the root. The trace list
pushes the `Trace` screen with that `selected`.

**Span tree and waterfall.**

- Row: exit glyph, tree guides with a fold mark (`▾`/`▸`), name, duration right-aligned, bar.
- Deep trees keep only the innermost 4 guide levels behind a `⋯<depth>` marker, so the name stays visible (the
  41-level fixture trace lost its names otherwise).
- Bars are `int(width × ratio)` cells with `▏…▉` eighths at the end; a zero-width span draws `┃`.
- **Log markers are on:** each event draws `◆` on its span's bar at its offset, an `exception` event `✗`.
  Several events in one cell collapse into one marker.
- Axis: a round interval from 1/2/5 × 10ⁿ, ticks at exact multiples, labels such as `│20.0ms`.
- **Same-name siblings group** once a parent has 20 or more children with one name: a group row
  `import.row ×400 · 6 failed` whose bar `░` spans the members' envelope. Groups start closed, but their
  failed and interrupted members stay visible beneath the row, so `n`/`N` and the opening selection reach
  them. `⏎` opens the group. With the group row selected, details shows counts by exit, duration min, p50,
  p95 and max, and the problem members with their exception types. Members show no distinguishing attribute
  in the tree; that stays in details.

**Exit and cause rendering.**

- `✗` bright red where a failure started (no failed child), dim red where it only propagated; `⊘` amber for
  interrupted; no glyph for success. Bars take the same colours; names are red only at the origin.
- Every failed span on a chain records the same exception, and only the origin has the full stack. So the
  **full cause shows only at the origin**: the type in bold, the message or "(no message)" for typed errors,
  the `<anonymous>` top frame as "thrown at", then "in span <name> <file:line:col>" frames with paths cut to
  their last two segments. A span the failure passed through shows `↳ PaymentDeclined, from payment.attempt`,
  and `o` jumps to the origin. Two exceptions are the same when type and throw-site frame match.
- A failed span with no exception event says "failed because <child> failed". An interrupted span gets an
  "Interrupted" section.
- `span.label` and `status.interrupted` are hidden from attributes: the exit state already says it.

**Details pane.** Header (name and exit; duration, start offset and clock time; span, parent and fiber `#n`;
run when the trace spans several), then Cause, Bodies (one row per prefix: name, size, one-line preview, in
place of the `.sha256`/`.bytes`/`.preview` attributes), Attributes and Events. **Empty sections are hidden.**

**Logs pane.** One line per event: `+offset LEVEL #fiber span message annotations`, offsets from trace start,
level coloured. A multi-value log (a JSON array) is flattened to one line with strings unquoted, and a logged
`effect.cause` adds a `↳ cause` line. **The default scope is the selected span and its descendants**, so the
root shows the whole trace; `s` cycles span / span + descendants / whole trace. The title shows the count and
scope. `⏎` selects the log's span in the tree.

**Keymap.**

| Scope    | Keys                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any pane | `t`/`d`/`l` focus tree, details, logs · `Tab`/`Shift-Tab` cycle · `-`/`+` split · `<`/`>` name column · `s` log scope · `Esc` back · `q` quit                                                                                                                        |
| Tree     | `j`/`k`/`↑`/`↓` move · `g`/`G` ends · `Ctrl-d`/`Ctrl-u` half page · `⏎`/`Space` fold, or open/close a group · `←`/`h` fold or go to parent · `→` unfold · `n`/`N` next/previous problem · `o` cause origin · `E` expand all · `C` collapse below the root's children |
| Details  | `j`/`k`/`Ctrl-d`/`Ctrl-u`/`g` scroll                                                                                                                                                                                                                                 |
| Logs     | `j`/`k`/`g`/`G` move · `⏎` select the log's span                                                                                                                                                                                                                     |

The prototype's `M` (markers), `R` (grouping), `F` (fold presets) and `P` (open on root) were comparison
toggles and are not in v1. Search (`/`) and the body-viewer key belong to their own fog.

**Colours.** One theme object with every colour named by role (failure, failure propagated, interrupted,
selection, focused border, log levels, …), shipped with a dark palette only. A light palette is later work,
tracked as the GitHub issue [Light-theme palette for the span viewer TUI](https://github.com/wmaurer/otelscope/issues/1).

**Additions to the `Trace` view state** from "Route tree and URL state": `openGroups: HashSet<GroupKey>` (empty
means every group closed; a group key is parent span id plus name) and `logScope: "span" | "subtree" | "trace"`
(default `"subtree"`).
