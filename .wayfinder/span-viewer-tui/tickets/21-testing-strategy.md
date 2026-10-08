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
