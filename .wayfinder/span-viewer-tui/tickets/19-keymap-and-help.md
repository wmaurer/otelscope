---
id: "19"
title: Keymap and help across screens
labels: [wayfinder:grilling]
status: open
assignee:
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
