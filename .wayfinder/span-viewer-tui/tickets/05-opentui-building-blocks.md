---
id: "05"
title: OpenTUI building blocks for the trace views
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

Which OpenTUI components and APIs cover the views v1 needs, and what must be built custom? Cover:

- scrollable lists and trees with thousands of rows (`scrollbox`, `select`), and whether they virtualize;
- split panes and resizable dividers, borders with titles (as in otel-tui's "Trace Timeline (t)");
- text styling, colours, themes, and cell-level drawing for waterfall bars (sub-cell resolution with block
  characters?);
- text input for search, focus management between panes, keyboard handling (`useKeyboard`,
  `@opentui/keymap`), mouse support, and terminal resize;
- examples in `packages/examples` closest to a three-pane trace viewer.

Sources: `.repos/deps/opentui/packages/{core,react,keymap,examples}` and its docs.

## Resolution

2026-10-07, by research agent. Findings: `docs/research/opentui-building-blocks.md` on branch
`research/opentui-building-blocks` (commit 58ae50a), cited against OpenTUI 0.5.14.

- **Built in:** Yoga flexbox layout on `<box>`, bordered boxes with titles, `focusedBorderColor`, text styling
  and colours, `<input>`, mouse handlers, re-layout on resize (`useTerminalDimensions`, `useOnResize`),
  `useKeyboard`, and `@opentui/keymap/react` (`useBindings` scoped to a pane, key sequences, `useActiveKeys`
  for a help bar).
- **Lists don't virtualize.** `<scrollbox>` skips only the drawing of off-screen rows; every row is still a
  React element and a Yoga node. `<select>` windows its rows, but each row is one plain string. The run list,
  trace list and span tree therefore need a **custom windowed list** (flatten the folded tree, render only
  the visible slice), with `Select.ts` as the template.
- **Waterfall bars are custom**, drawn per cell in a custom `Renderable` (`extend()`) or a `renderAfter` hook.
  Sub-cell precision with `▏…▉` block characters is our own code.
- **Small custom pieces:** Tab focus cycling, a click event (OpenTUI sends only down and up), a resizable
  divider, and a theme object.
- **Body viewer:** `<text>` and `<code>` scroll on their own, and `<line-number>` adds a gutter. No JSON
  grammar ships.
- **Closest example:** `packages/react/examples/keymap.tsx`, with titled focusable panes, per-pane bindings,
  Tab cycling and a key-hint bar.
- **Risks:** `<scrollbox>` at thousands of rows is unmeasured. Global single-letter bindings would swallow
  typing in the search `<input>`. Block characters depend on the font. `@opentui/keymap` requires Bun 1.3 or
  later, and whether it runs under Node belongs to the runtime ticket.
