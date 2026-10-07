---
id: "08"
title: Data layer: tailing, indexing and exposing the file to React
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: [04]
---

## Question

How does the TUI load and follow the JSONL file, and what does it expose to views? Settle:

- the Effect services and their APIs (source, index, bodies);
- the in-memory index from runs to traces to span trees, and how partial trees (children written before
  their parents) are represented;
- handling of malformed or partial lines and file truncation;
- the granularity and throttling of live updates pushed to React;
- loading body text on demand;
- the file size the design targets, given 360–460 MB resident for 200k lines before any index;
- whether the `JsonlSpanRecord` Schema goes into `@wmaurer/otelscope-effect/format` (a public API change, best
  released with the start-time field) or stays in the TUI.

The Effect–React bridge research recommends a starting point: Effect owns the process and the renderer, the
tail is a custom `Stream` with `Reset` events, lines decode one by one, and snapshots go through
`SubscriptionRef` → `Atom.subscriptionRef` → `useAtomValue`. See `docs/research/effect-react-bridge.md` on
branch `research/effect-react-bridge`.
