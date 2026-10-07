---
id: "12"
title: Runtime and Node version policy for packages/tui
labels: [wayfinder:grilling]
status: open
assignee:
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
- whether the published bin is bundled (Bun.build or another bundler) or `tsc` output. TanStack Router needs
  its `isServer` import redirected, which a bundler plugin does cleanly. Bundling also keeps a single React
  copy and could cut the install bloat;
- whether to work around the upstream install bloat (`typescript@5`, `react-devtools-core`, `ws`).

Findings: `docs/research/opentui-runtime-and-tooling.md` on branch `research/opentui-runtime-and-tooling`.
