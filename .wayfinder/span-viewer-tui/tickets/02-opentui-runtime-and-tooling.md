---
id: "02"
title: OpenTUI React under Node: runtime, packaging and repo tooling
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

Can `@opentui/react` (current release) run under Node >= 22.18 as a CLI bin installed from npm, or does it
need Bun? Find out:

- how `@opentui/core` loads its native library under Node (FFI mechanism, per-platform prebuilt packages,
  install size) and which platforms ship binaries;
- which React version it requires, and whether that conflicts with anything else planned (TanStack Router);
- how it fits this repo: pnpm workspace, TypeScript 7 / tsgo typecheck with JSX (`jsxImportSource`), oxlint
  over `.tsx`, and vitest tests using `@opentui/react/test-utils`;
- what a minimal `packages/tui` needs in order to render a box under Node with `pnpm`.

Sources: `.repos/deps/opentui/`, the npm registry metadata for `@opentui/*`, and this repo's config
files.

## Resolution

2026-10-07, by research agent. Findings: `docs/research/opentui-runtime-and-tooling.md` on branch
`research/opentui-runtime-and-tooling` (commit a9b4deb). It includes the minimum `packages/tui` setup
(package.json, tsconfig, vitest config, bin shim).

- **Verdict:** `@opentui/react` 0.5.14 runs under Node without Bun, but only on **Node >= 26.9**. It does not
  run on 22 or 24. Node 26 becomes LTS on 2026-10-28.
- **Native loading:** a prebuilt Zig shared library opened through Node's experimental `node:ffi`
  (`bun:ffi` under Bun), with no N-API addon. `node:ffi` has been on by default since 26.9.0, still prints an
  `ExperimentalWarning`, and was not backported. On older Node the import succeeds and the first renderer
  throws.
- **Experiments:** renders on Node 26.10, on 26.4 with `--experimental-ffi`, and on Bun 1.4. Fails on 26.4
  without the flag, on 24.14 and on 22.23. A `tsc`-compiled TSX app, packed and installed with
  `npm install -g`, ran through its bin on 26.10.
- **Platforms and size:** 8 per-platform packages of about 6 MB each, with no install scripts. musl needs
  `OPENTUI_LIBC=musl`. The global install was 68 MB, inflated by upstream manifest problems (`typescript@5`,
  `react-devtools-core` and `ws` get installed).
- **React:** needs `react >=19.2` and `react-reconciler ^0.33`. No conflict with TanStack Router, which
  accepts React 18 or 19; its `react-dom` peer is the TanStack ticket's question.
- **Repo fit, verified:** TypeScript 7 with `jsxImportSource: "@opentui/react"`, oxlint and oxfmt on `.tsx`,
  vitest with `@opentui/react/test-utils` (passes on Node 26, fails on 24), and pnpm 10.33 installs cleanly.
- **Risks:** dev and CI Node must be >= 26.9, but this machine has 24.14 and the pre-push hook runs every
  package's tests. `node:ffi` is experimental, so OpenTUI should be pinned exactly. The current lint config
  makes `items.map(() => <jsx/>)` an error (`effect-native/native-array-method`), and React hook rules are
  off. Two new tickets cover these: "Runtime and Node version policy for packages/tui" and "Lint rules for
  React TSX".
