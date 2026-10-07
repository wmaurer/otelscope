---
id: "11"
title: "Source locations: record span call sites, or failures only?"
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

Charting assumed every span carries `code.stacktrace` as a source location. The prior-art survey found it
does not: effect@4.0.1 captures a call site per span, but its OTLP exporter does not export it. Today a
record's only source locations are the frames inside an `exception` event's `exception.stacktrace`. Settle:

- whether v1 shows source locations for failures only (parsed from `exception.stacktrace`), or the writer
  in `packages/effect` also records each span's call site;
- if it records them: where the call site can be read (tracer, span, or a wrapper around the exporter in
  `ReceiverClient`), what the record field looks like, and the cost per span;
- whether a location can open in `$EDITOR`, or is only shown.

If recording call sites changes `JsonlSpanRecord`, do it in the same release as the start-time change.
Findings: `docs/research/prior-art-survey.md` on branch `research/prior-art-survey`.

The sample fixture shows that an `exception.stacktrace` already has one frame per enclosing span. Each frame
is named after its span and gives the call site of that span's `withSpan`, such as `at payment.attempt
(file:50:20)`. So a failure already maps every span on its path to a source location. See the sample-fixture
ticket's resolution.

## Resolution

2026-10-07, grilled with wmaurer. A throwaway spike (not kept) checked the hook against effect@4.0.1 under tsx
and plain Node.

- **Every span records its call site**, not failures only. The writer in `packages/effect` adds it, in the
  same 0.3.0 release as `startMs`.
- **Effect DevTools does not help.** `effect/devtools` (`DevTools.layer()`, the successor of `DevToolsLive`)
  wraps the tracer and streams span snapshots over a WebSocket. A snapshot has ids, name, parent, status and
  attributes, with no call site. The VS Code extension's "Go to location" reads a span attribute
  `@effect/devtools/trace` that nothing in effect@4.0.1 sets. Its other span stack comes from evaluating code in
  a paused debugger, which is out of scope.

### Where the call site is read

Effect captures a span's call site when `withSpan` (or `Effect.fn`) is called. It never passes the call site
to `Tracer.span()`. Instead it provides the call site as the fiber's `CurrentStackFrame`, next to the span,
and the public `fiber.cache.stackFrame` exposes it. `JsonlTrace.layer` wraps the tracer it installs in one that
adds a `context` hook. Effect calls the hook for every primitive it evaluates:

- When `fiber.cache.span` is a `Span` not yet seen (a `WeakSet`) and `fiber.cache.stackFrame.name` equals the
  span's name, the hook marks the span as seen and reads `frame.stack()`.
- For `Effect.fn` spans, `frame.parent` is named `"<name> (definition)"` and holds the definition site.
- The hook sets OTel semantic-convention attributes on the span: `code.file.path`, `code.line.number`,
  `code.column.number`, and `otelscope.def.file.path`, `otelscope.def.line.number` and
  `otelscope.def.column.number` for the definition. The OTLP exporter carries them like any other attribute,
  so `ReceiverClient` needs no change.
- Then it evaluates the primitive, as the tracer would without the hook.
- **It never fails the program.** If reading or parsing a frame throws, the span gets no location, and the
  program carries on.

**Cost** (spike, 20 primitives per span): the per-primitive check is in the noise, at about 5 µs per span
with or without it. Formatting the stack string Effect already captured costs about 6 µs per span, and about
12 µs for an `Effect.fn` span, which formats two strings.

### Record format

`toRecord` lifts the attributes out of `attrs` into two top-level fields, so they do not appear twice:

```ts
interface Location {
    readonly file: string; // absolute path; a `file://` URL is converted to a path
    readonly line: number;
    readonly col: number;
}

// Where the span was opened: the call site of its `withSpan`, or of the call to an `Effect.fn`.
// `null` when Effect captured none.
readonly site: Location | null;
// `Effect.fn` spans only: where the function is defined. `null` for every other span.
readonly def: Location | null;
```

The writer parses the frame once, so the TUI never parses stack strings for spans. Two forms occur:
`at <anonymous> (/abs/path.ts:32:40)` (tsx, CommonJS) and `at file:///abs/path.mjs:32:40` (plain Node ESM,
with no parentheses). The function name is always `<anonymous>` or the span name, so it is dropped. Both fields
are always present, as `parent` is. The record Schema exported from `format` (see the data-layer ticket)
requires them.

### Always on, with the switches documented

There is no new `JsonlTraceOptions` field. The README's record-format section documents what leaves `site`
and `def` at `null` or changes them:

- `captureStackTrace: false` in a span's options turns it off for that span. Effect sets it on its own HTTP
  client, RPC, SQL, AI and workflow spans, so those spans never have a location.
- `Error.stackTraceLimit = 0` turns it off for the whole process. This is also how to avoid the cost.
- Positions are what Node's stack traces report: TypeScript positions under tsx or `--enable-source-maps`,
  and positions in the compiled JavaScript otherwise.

### In the TUI

- **Shown.** The details pane header gets `at <file>:<line>:<col>` and, for `Effect.fn` spans,
  `defined at <file>:<line>:<col>`, with paths cut to their last two segments as for cause frames. A line is
  omitted when its field is `null`.
- **Opened.** `e` (any pane) opens `def` if present, else `site`, in `$VISUAL`, falling back to `$EDITOR`.
  The renderer is suspended (`renderer.suspend()`) while the editor runs in the foreground, and resumed when
  it exits. The arguments are `+<line> <file>`, which vi, vim, nvim, nano, emacs, micro, helix and kak
  accept. `code`, `cursor` and `codium` get `--goto <file>:<line>:<col>`, matched on the command's basename.
  With no editor set, or no location, the help bar shows a one-line notice and nothing runs.
- **Not in v1:** opening a frame of a failure's cause. A failed span opens its own location, and picking a
  cause frame would need a cursor in the details pane.
