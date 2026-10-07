---
id: "13"
title: Lint rules for React TSX
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: []
---

## Question

Under the repo's current oxlint config, the usual `items.map(() => <jsx/>)` is an error
(`effect-native/native-array-method`), and React hook rules are off because the `react` plugin is not
enabled. Settle what `packages/tui` lints with:

- whether `.tsx` files get an override for `native-array-method`, or views use Effect's `Array.map`;
- whether to enable the `react` plugin (rules of hooks, exhaustive deps) and which rules;
- where the change lives: the lint config is generated from `../project-setup`, so a change made here would be
  overwritten on upgrade (see `AGENTS.md`).

Findings: `docs/research/opentui-runtime-and-tooling.md` on branch `research/opentui-runtime-and-tooling`.
