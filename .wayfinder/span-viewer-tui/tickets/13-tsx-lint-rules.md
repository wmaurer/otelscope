---
id: "13"
title: Lint rules for React TSX
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
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

## Resolution

2026-10-07, grilled with wmaurer. Measured with oxlint 1.86.0 and the repo config on a throwaway probe file.

**Where it lives.** One `overrides` entry in the root `oxlint.config.ts`, scoped to `packages/tui/**`. That
file carries no "do not edit" banner: project rules are folded into it by hand on upgrade, as
`unstable-api-usage` already is. Nothing goes upstream to `project-setup`. The same shape is in
ict-exam-frontend's `oxlint.config.ts`, which lints a React package.

**Lists in JSX use Effect's `Array.map`.** `effect-native/native-array-method` stays on for `.tsx`, so a view
writes `{Array.map(rows, (row) => <text key={row.id}>…</text>)}`, as ict-exam-frontend does. Views render rows
the data layer has already shaped, so `.filter` or `.find` in a view is a smell the rule keeps reporting.
Accepted gap: `react/jsx-key` misses a missing `key` in the data-first `Array.map(xs, f)` (it does catch
`pipe(xs, Array.map(f))` and native `.map`). The windowed list owns most row rendering, and React's dev-mode
key warning is the backstop.

**The override.**

```ts
{
    files: ["packages/tui/**"],
    plugins: ["react"],
    rules: {
        "react/rules-of-hooks": "error",
    },
}
```

- `plugins: ["react"]` alone. An override's `plugins` unions with the base five, and restating them leaves
  every React rule silently off (see project-setup's `docs/issues/2026-09-16-an-override-scope-is-not-pinned.md`).
- The plugin turns on 31 rules at `"warn"`, which `--max-warnings=0` makes fatal: hook and React Compiler
  rules (`exhaustive-deps`, `set-state-in-effect`, `set-state-in-render`, `purity`, `immutability`, `refs`,
  `static-components`, `use-memo`, …), JSX rules (`jsx-key`, `jsx-no-duplicate-props`, `jsx-no-undef`), and
  class-component and `react-dom` rules that are inert here. None is named in the override.
- `react/rules-of-hooks` is not default-on in oxlint 1.86 and is named at `"error"`.
- No `jsx-a11y`: its rules check DOM accessibility and have nothing to check in `<box>` and `<text>`.
- The glob is the whole package, not `**/*.tsx`, because custom hooks live in `.ts` files too.

**Pinning.** The 31 default-on rules stay unpinned: `correctness-rules.ts` pins only what the root plugins turn
on. The override carries a comment saying so, and `pnpm lint:sync` prints a note naming the scope (exit 0).
`OXLINT_PINNED` makes every oxlint bump a deliberate step, and reading that note is part of it.

**No exceptions up front.** Effect rules such as `effecttsgo/global-timers` stay on in views: timing and
polling belong to the Effect data layer. A deliberate exception gets an `oxlint-disable-next-line` comment in
place. Test files keep the existing `**/test/**` override.
