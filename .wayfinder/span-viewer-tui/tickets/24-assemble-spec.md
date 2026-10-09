---
id: "24"
title: Assemble the hand-off spec
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

Every decision ticket on the map is closed. Turn their resolutions, and the "Amended by" notes on them, into the
implementation-ready spec for v1 of `packages/tui` that the Destination names, so that someone can build it
without deciding anything further.

- **Where and in what form** the spec lives (for example `packages/tui/SPEC.md`, or a set of files under
  `docs/`), and whether the 0.3.0 record-format change in `packages/effect` is a part of it or a separate spec.
- **Order of work**: the 0.3.0 writer and Schema first, then the data layer, the screens and the CLI, with the
  release order that [CLI surface and npm packaging](20-cli-surface.md) set.
- **Contradictions**: any place where two resolutions disagree once they are read side by side is raised with
  wmaurer, not settled silently.
- **Field names**, which several tickets left as "a starting point for the spec", are fixed here.
