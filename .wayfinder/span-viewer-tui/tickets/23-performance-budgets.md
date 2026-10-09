---
id: "23"
title: Performance budgets and how they are checked
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: []
---

## Question

v1 targets 250k spans, with every record in memory ([Data layer: tailing, indexing and exposing the file to
React](08-data-layer-design.md)). What budgets does the spec set, and how does a script outside `pre-push` check
them?

- **Budgets.** What counts as responsive, as numbers, for:
    - time to the first frame after `otelscope <file>`;
    - time until a finished file is fully indexed;
    - a key press that moves the selection, or folds or unfolds, in the windowed list and the waterfall;
    - a live publish, which is copy-on-write every 100 ms;
    - memory at 250k spans.
- **Fixture scale.** The large variant has 36k spans. Should the generator grow a third `Scale` at the target
  (for example 20,000 orders, about 240k spans), and is it generated on demand like `large/`?
- **Measuring.** The check needs a harness that drives the real `SpanSource` and `SpanStore` and renders with
  `@opentui/react/test-utils`: what does it time, how many runs, and where does it report?
- **Remedies, decided in advance.** If startup misses its budget, is bundling the bin the remedy, against "`tsc`
  output, no bundle" in [Runtime and Node version policy for packages/tui](12-runtime-policy.md)? Is `--last-runs`,
  which [CLI surface and npm packaging](20-cli-surface.md) left out of v1, the remedy for a slow index of a huge
  file?
