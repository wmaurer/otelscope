---
id: "12"
title: Runtime and Node version policy for packages/tui
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

OpenTUI runs under Node only on >= 26.9, through the experimental `node:ffi`, or under Bun. The repo
requires `>=22.18`, this machine runs Node 24.14, and the pre-push hook runs every package's tests. Settle:

- the supported runtime for users of the published bin: Node >= 26.9, Bun, or both, and the `engines` field;
- the Node version for development and CI, and how `pnpm pre-push` behaves for `packages/tui` on an older
  Node (raise the repo's Node, skip, or run the TUI's tests under Bun);
- how the bin shim handles the `ExperimentalWarning` and an unsupported runtime;
- the OpenTUI pinning policy (exact version) and the musl story (`OPENTUI_LIBC=musl`);
- whether the published bin is bundled (Bun.build or another bundler) or `tsc` output. Bundling keeps a single
  React copy and could cut the install bloat. TanStack Router, whose `isServer` redirect needed a bundler, was
  dropped in Route tree and URL state;
- whether to work around the upstream install bloat (`typescript@5`, `react-devtools-core`, `ws`).

Findings: `docs/research/opentui-runtime-and-tooling.md` on branch `research/opentui-runtime-and-tooling`.

## Resolution

2026-10-07, grilled with wmaurer.

**Supported runtime: Node >= 26.9 only.** `packages/tui` declares `"engines": { "node": ">=26.9" }`. `npx` and
`npm i -g` start the bin with Node, the data layer is `@effect/platform-node`, and Node 26 is LTS from
2026-10-28. Bun gets a different OpenTUI build (`index.bun.js`) and a different platform layer, so it is not
supported or tested. The README says it probably works with `bunx --bun`.

**Development Node: 26 for the whole repo, through nvm.** No mise.

- A root `.nvmrc` containing `26`, which nvm, fnm and editors read.
- The root `engines` goes from `>=22.18` to `>=26.9`. The root package is private, so this binds only
  development.
- A root `.npmrc` with `engine-strict=true`, so `pnpm install` on an older Node fails instead of warning.
- `packages/effect` gets its own `"engines": { "node": ">=22.18" }`: that is its promise to npm users.
- `pnpm pre-push` is unchanged and runs every package on 26. Nothing tests `@wmaurer/otelscope-effect` on
  22 or 24 any more, and `@types/node ^26` could let a 26-only API slip in. That risk is accepted: the
  library uses only `FileSystem`, `Path` and Effect's OTLP exporter.
- `engine-strict` is checked only on install. A shell that skipped `nvm use` still fails the pre-push hook,
  because the TUI tests throw OpenTUI's "native FFI is not available" error. No extra version check.
- The repo has no CI. When one is added, it reads the Node version from `.nvmrc`.

**Bin shim.** `src/bin.ts` compiles to `dist/bin.js` with `#!/usr/bin/env node`. It has no top-level imports,
and its syntax parses on old Node. It runs these steps in order:

1. **Guard.** Under Bun (`process.versions.bun`) it skips the check. Otherwise, if
   `process.getBuiltinModule?.("node:ffi")` is missing, it prints one line to stderr and exits 1:
   `otelscope needs Node >= 26.9 (found v24.14.0). On Node 26.1–26.8, run it with --experimental-ffi.`
2. **musl.** On Linux with `OPENTUI_LIBC` unset, `process.report.getReport().header.glibcVersionRuntime`
   being undefined means musl, and the shim sets `OPENTUI_LIBC=musl`. The README documents the variable as an
   override.
3. **Warning.** It replaces Node's default `warning` listener with one that drops only the FFI
   `ExperimentalWarning` and prints every other warning as Node would. It does not use
   `--disable-warning`, which hides too much and can't be passed portably through a shebang.
4. **Start.** `await import("./main.js")`, so OpenTUI loads only after the guard has passed.

**OpenTUI pinning.**

- `@opentui/core` and `@opentui/react` are pinned to the same exact version, `0.5.14` today.
- `react` is held at `~19.2.0`, the version `react-reconciler` 0.33 is built for.
- An upgrade bumps both OpenTUI packages together and re-pins `.repos/deps/opentui` (`pnpm deps:check`), then
  runs the TUI tests on the current Node 26. `node:ffi` is experimental, so only our upgrades should change
  what users get.

**Build: `tsc` output, not a bundle,** the same as `packages/effect`. The package ships `dist/` and `src/`
and builds with `tsc -p tsconfig.build.json`.

- npm and pnpm already install a single React copy.
- `@opentui/core` must stay external (a dynamic `import()` of its native package, tree-sitter assets,
  top-level await), so bundling would save only `react-devtools-core` and `ws`, and only by bundling a
  Bun-targeted library.
- If startup time turns out to be the cost, because Node loads Effect as hundreds of modules, "Performance
  limits" measures it and revisits bundling.

**Install bloat: no workaround in v1.** A global install is about 68 MB, and the README says so.

- Neither cause can be fixed by a dependent package: the dropped `peerDependenciesMeta` in
  `@opentui/react`'s build (`packages/react/scripts/build.ts:239`) makes `react-devtools-core` and `ws`
  required, and `bun-ffi-structs` declares a `typescript: ^5` peer.
- **To do, when wmaurer chooses:** report both upstream as two issues on anomalyco/opentui. No existing
  issue was found on 2026-10-07.

**Amended by** [Performance budgets and how they are checked](23-performance-budgets.md): the shim calls
`module.enableCompileCache()` between the warning step and the start. Bundling our code and Effect with esbuild
(`@opentui/*` external) is the approved startup remedy, but only if module loading is more than half of a missed
startup budget.
