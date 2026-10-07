---
id: "04"
title: Bridging an Effect data layer into OpenTUI React
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

How should an Effect v4 data layer feed React components under OpenTUI? Find out, at the installed Effect
version:

- what Effect v4 offers for React state (`effect/unstable/reactivity` Atom, any `@effect/atom-react` or
  equivalent package, and their versions), versus a hand-rolled `useSyncExternalStore` over a
  `SubscriptionRef`;
- how a `ManagedRuntime` or `Layer` lifecycle should tie to OpenTUI's renderer start, stop and exit
  (Ctrl-C, terminal restore);
- how to tail an appended file in `@effect/platform-node` (`FileSystem.watch`, polling, offsets) as a
  `Stream` of complete lines, handling a partial last line and file truncation;
- decoding lines with `Schema` against `JsonlSpanRecord` from `@wmaurer/otelscope-effect/format`.

Sources: `AGENTS.md`, `ai-docs/src/` and `src/` of the Effect packages under
`packages/effect/node_modules/` (see the repo's `AGENTS.md`), and the npm registry for related packages.

## Resolution

2026-10-07, by research agent. Findings: `docs/research/effect-react-bridge.md` on branch
`research/effect-react-bridge` (commit 5f0e6a9), with code sketches and timings.

- **Lifecycle: Effect owns the process.** `NodeRuntime.runMain` builds the layers and acquires the renderer as
  a scoped resource (`acquireRelease(createCliRenderer, r => r.destroy())`), renders the root, and waits for
  the renderer's `destroy` event. Tested on Bun 1.4 with Ctrl-C, `q`, SIGTERM, SIGHUP and SIGINT: each
  restored the terminal, shut down the tail and layers, and exited 0. OpenTUI's `destroy()` never exits the
  process.
- **React state:** the module is `effect/reactivity` at 4.0.1 (unstable). The official binding is
  `@effect/atom-react@4.0.1`; its `scheduler` peer matches OpenTUI's. The `@effect-atom/*` packages are
  Effect 3 only.
- **Recommended bridge:** the data layer publishes snapshots in a `SubscriptionRef`, wrapped with
  `Atom.subscriptionRef` and read with `useAtomValue`. The registry comes from a layer through
  `RegistryContext.Provider`. Avoid `Atom.runtime(layer)` as the owner of services, because nothing waits for
  its cleanup. A hand-written `useSyncExternalStore` hook of about 15 lines is the fallback.
- **Tailing:** a custom `Stream`. It watches the file's directory and also polls as a safety net. On each
  wake-up it checks size and inode, emitting a `Reset` on truncate, replace or delete. It reads new bytes
  from the saved offset and holds back a partial last line. Edge cases behaved the same on Node 24 and Bun.
  200k lines (53 MB) were read and decoded in 0.55–0.75 s. `Stream.splitLines` and `Ndjson` don't fit.
- **Decoding:** `JsonlSpanRecord` has no Schema today, only interfaces. The doc proposes one, with a recursive
  `AttributeValue` as in `TraceData.ts`. Adding it is a public API change to `@wmaurer/otelscope-effect`.
  Each line is decoded on its own with `Schema.decodeUnknownExit(Schema.fromJsonString(...))`, at about 320k
  lines/s, and unknown fields are dropped, so newer files decode.
- **Risks:** pin `effect` and `@effect/atom-react` together. The `scheduler` peer breaks if OpenTUI moves to
  `react-reconciler@0.34`. Signal exits report code 0. OpenTUI captures console output and unhandled
  rejections, so data errors must be UI state. A truncate followed by regrowth between two checks goes
  unnoticed. Concurrent writers can interleave mid-line. Memory is 360–460 MB on 200k lines, before any
  index. Bursts need throttling: the 200k-line load caused 377 renders.
