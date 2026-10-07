---
id: "06"
title: Prior art: otel-tui's trace view and the Effect extension's span view
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

What should v1 borrow from the two reference tools? Produce a borrow list with file references:

- otel-tui (`.repos/refs/otel-tui/`): the trace list and the trace view's three panes (timeline, details,
  logs), keybindings, how the timeline maps time onto cells and scales its axis, folding, column and
  divider resizing, filtering, and how the logs pane filters by span;
- Effect VS Code extension (`.repos/refs/effect-vscode-extension/`): what its span tree and details show
  per span, and how it presents Effect-specific data: exit, causes, stack traces and source locations,
  fiber ids, and log events.

Note anything either tool does that does not fit a JSONL-only, post-hoc-or-live viewer.

## Resolution

2026-10-07, by research agent. Findings: `docs/research/prior-art-survey.md` on branch
`research/prior-art-survey`, with 26 borrow items, each with a source file:line and a v1 recommendation.

- **Trace view layout from otel-tui, adopted as is:** waterfall and details side by side at 29:21, a logs
  strip below, and a help bar for the focused pane only. Pane focus with `t`/`d`/`l`, `Esc` back to the
  list, `j`/`k`/`g`/`G`, and `Enter` to fold, starting fully expanded. The selected span drives details and
  logs. The name column resizes in 5-cell steps.
- **Waterfall adopted with changes:** the cell mapping is `int(width × ratio)`, and a zero-width span draws as
  `┃`, which matters because whole-ms `ms` makes many spans 0 ms long. Style and colour by `exit`, not by
  service.
- **Axis:** don't copy otel-tui's. It always draws 5 ticks and rounds labels down, so labels and ticks
  disagree. Use the Effect extension's method: a round interval from a fixed list, ticks at exact multiples.
- **Logs pane:** keep otel-tui's "selected span / whole trace" toggle and the count in the title. otel-tui's
  logs come from OTLP log records, so a logs pane built from events is new design work.
- **Trace list:** one row per trace (not per trace and service), a start-time column, and a wider search than
  otel-tui's substring match on service and span name.
- **From the Effect extension:** per-span details (ids, duration, attributes, "Events (n)" with offsets), a
  placeholder row for a parent not yet written (handles live-tailed children arriving first), and its
  stack-frame regexes.
- **Neither tool renders exit or causes.** A Cause section built from `exception` events is new design work.
  Fiber ids should read `#12`, as Effect's console logger prints them.
- **Correction to the charting notes:** `code.stacktrace` does not exist in effect@4.0.1, and the OTLP
  exporter does not export Effect's per-span call site. Today the only source locations in a record are the
  frames inside `exception.stacktrace`, so failures only. This became a new ticket, "Source locations:
  record span call sites, or failures only?".
- **Open questions carried forward:** the default fold state, whether logs for a span include its
  descendants, resize keys that avoid `Ctrl-H` (Backspace) and `Ctrl-J` (Enter), `$EDITOR` at a location, and
  axis resolution until start times land.
