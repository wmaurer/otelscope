---
id: "21"
title: Testing strategy for packages/tui
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: []
---

## Question

How is `packages/tui` tested in this repo's vitest setup? Decide:

- what is tested as pure functions without a renderer: navigation over the screen stack, tree building,
  grouping, the waterfall's bar and axis maths, cause rendering, log flattening;
- how the data layer is tested: the tail `Stream` against a growing temp file, decoding and classification of
  bad lines, snapshots;
- whether views are tested through `@opentui/react/test-utils` frame snapshots, and which ones;
- which fixtures the tests use (the sample fixture from "Representative sample JSONL fixture", hand-written
  small files);
- how the tests fit the `pre-push` hook on Node 26.

**Amended by** [Keymap and help across screens](19-keymap-and-help.md): key dispatch is a pure
`(mode, nav, key) → Action` over one binding table, which also generates the hint line and `?` overlay.

**Amended by** [CLI surface and npm packaging](20-cli-surface.md): arguments are parsed with `effect/cli`; argv →
initial `Nav`, unique-prefix resolution of seeded ids, and the startup errors with their exit codes (0, 1, 2) are
also to be tested.
