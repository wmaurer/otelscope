---
id: "24"
title: Assemble the hand-off spec
labels: [wayfinder:task]
status: closed
assignee: wmaurer
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

## Resolution

2026-10-09, assembled with wmaurer. The spec is [`docs/specs/span-viewer/`](../../../docs/specs/span-viewer/README.md):
a README (vocabulary, pinned versions, order of work, "Settled while assembling", out of scope) and twelve files, one
per area: record format 0.3.0, package and runtime, data layer, navigation, list screens, trace view, body viewer,
search, keys and chrome, CLI, testing, performance. The 0.3.0 change in `packages/effect` is part of it, as its first
file and the first step of the order of work, since the viewer depends on it and both ship in one release train. A
fresh-eyes review checked the spec against every resolution, and its findings were fixed.

- **Order of work:** repo on Node 26 → `@wmaurer/otelscope-effect` 0.3.0 (not published) → `packages/tui` scaffold →
  data layer → navigation and chrome → screens in drill-down order, search with each → smoke set, journeys and
  `perf` → READMEs and `AGENTS.md` → publish 0.3.0, then `@wmaurer/otelscope@0.1.0`.
- **Settled with wmaurer while assembling:**
    - Atoms from `effect/reactivity` (there is no `@effect/atom` package) with `@effect/atom-react`; every test file
      imports from `@effect/vitest`. The four Effect packages are pinned to one exact version.
    - 0.3.0 adds `fiber: number | null`, read by the same tracer hook as `site`, because the details header shows the
      span's fiber and records had none.
    - `JsonlTrace.layer` exports every 1 s, not Effect's default 5 s, which would make the 5-second live mark
      flicker.
    - `packages/effect` gains an `@otelscope/source` export condition, so the workspace typechecks and tests without
      building it.
    - `main.ts` runs the CLI checks before it `import()`s the TSX app, so spawned CLI tests run `src/bin.ts` under
      Node's type stripping; `perf` builds and spawns `dist/`.
- **Settled from the tickets while assembling** (listed in the spec's README): problem spans are failure origins and
  interrupted spans; live counts only records that arrive while following; a `newerThan` watermark for the new-rows
  count; row keys for selecting group, "more" and missing-parent rows; the opening selection of a seeded trace that
  arrives late; one-run auto-open only at the end of the initial read; `phase: "done"`; logs pane lists logs only; quit
  and signals through Effect (`exitSignals: []`, a `teardown` mapping interrupts to 0); the fixture generator keeps
  its own writer built from 0.3.0's `src`; formatting, palette, breadcrumb and layout sizes.
- **Lost assets:** the `research/*` and `prototype/*` branches no longer exist, so the spec is self-contained and does
  not refer to them for detail.
