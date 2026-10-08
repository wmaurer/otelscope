---
id: "09"
title: Route tree and URL state
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: [03, 08]
---

## Question

What are the routes, and what state lives in them? Settle:

- the route tree for runs, traces, the trace view and the body viewer;
- what is a path param and what is a search param (selected span, folded nodes, filters, focused pane);
- how live data updates interact with routes (loaders, or subscriptions in components);
- whether TanStack Router's four workarounds (redirecting the `isServer` import, `origin`, global stubs, no
  `<Link>`) and its upstream fragility are worth it, or the typed state router fallback of about 50 lines is
  better.

The TanStack research found it viable with those workarounds, and recommends routes for identity and view
state, with components subscribing to the store directly. See `docs/research/tanstack-router-under-opentui.md`
on branch `research/tanstack-router-under-opentui`.

From the data-layer ticket: traces are keyed by trace id alone and can belong to more than one run, so a trace
route must not assume one parent run. On a file Reset every id can disappear, and a route that points at a
missing trace or span needs a fallback.

## Resolution

2026-10-07, grilled with wmaurer.

**No TanStack Router: a typed screen stack instead.** TanStack works under OpenTUI, but only with four
workarounds (an `isServer` redirect that needs a bundler step or a vitest alias, `origin`, `scrollTo` and
`self` stubs, no `<Link>`), a `react-dom` peer, an exact pin and a smoke test, and its maintainers do not
support non-browser hosts. What it gives back matters little here: the URL is never visible, nobody types,
shares or bookmarks it, the screens are few and fixed, and loaders and invalidation would go unused because live
data flows through the store. This replaces the charting note "use TanStack Router if it works under OpenTUI".

**Screens.**

```ts
type Screen = Data.TaggedEnum<{
  Runs:   { view: RunsView }
  Traces: { runId: RunId; view: TracesView }
  Trace:  { traceId: TraceId; viaRun: Option<RunId>; view: TraceView }
  Body:   { sha256: string; title: string; view: BodyView }
}>
type Nav = { stack: NonEmptyReadonlyArray<Screen> } // the head is always Runs
```

- Navigation is `push`, `replace`, `back` and `update`, where `update` edits the top screen's `view`. These are
  pure functions over `Nav`, so they can be unit-tested without a renderer.
- A trace is identified by `traceId` alone. `viaRun` records which run's list it was opened from, and is used
  only for the breadcrumb ("run ab12 › trace 9f3c"), never for lookup. When a trace spans several runs, the
  trace view header lists them all.
- The body viewer is its own screen. It is pushed from the trace view's details pane, opens full screen, and
  Esc returns to the trace with its view state intact. `title` is the attribute prefix (`http.request`).
  Whether the trace view also shows bodies inline is left to the body viewer's fog.
- The stack always starts with `Runs`. Back pops one screen, and does nothing on `Runs`. Jumps that skip
  levels are allowed: a global search could push `Trace` straight onto `Runs`.
- The CLI seeds the full ancestry so back works: `--trace X` gives `[Runs, Trace X]`, and
  `--run R --trace X` gives `[Runs, Traces R, Trace X via R]`. Whether a file with one run opens straight on
  its traces is a question for the list screens; the stack supports it by seeding `[Runs, Traces R]`.

**View state.** Whatever back should restore lives in the screen's `view`:

| Screen   | `view`                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `Runs`   | `selected: Option<RunId>`, `filter: string`                                                                       |
| `Traces` | `selected: Option<TraceId>`, `filter: string`                                                                     |
| `Trace`  | `selected: Option<SpanId>`, `folded: HashSet<SpanId>`, `pane: "tree" \| "details" \| "logs"`, `logFilter: string` |
| `Body`   | `topLine: number`, `search: string`                                                                               |

- Selection is stored by id, never by row index, so live inserts and re-sorts never move the cursor. When
  the selected id is absent (after a Reset, or hidden by a filter), the list shows its first row as selected,
  but the stored id is not overwritten until the user moves the cursor, so the selection returns if the id
  does.
- List scroll offsets are not stored: the windowed list derives them to keep the selection in view. The body
  pager has no selection, so it stores `topLine`.
- `folded` starts empty, meaning everything is expanded. A default such as "collapse below depth N" would be a
  render-time rule, which the trace view prototype decides.
- Outside the screens: pane sizes and layout variant are one session-wide Atom. Open overlays (help, bad-line
  samples) and half-typed key sequences are component state. Follow mode belongs to the live-tail fog; if it
  is per screen it becomes one more `view` field.

**Live data, missing ids and Resets.**

- Live data never goes through navigation. Screens read the snapshot through atoms keyed by their ids
  (`Atom.family`, as decided in the data layer). Navigation is a separate writable `navAtom` in
  `packages/tui/src/bridge`. Its initial stack is built from the CLI arguments before the first render, and key
  handlers change it through `useAtomSet`.
- A screen whose id is not in the snapshot stays on the stack and shows a placeholder in place, keeping its
  `view`. While `status.phase` is `waiting` or `loading` it reads "Loading… looking for trace 9f3c…". After
  that it reads "Trace 9f3c… is not in the file", plus "(file reset at 12:03:04)" when `lastReset` is set, and
  "Esc to go back". If the id appears later the screen renders normally. That happens when a CLI-seeded id
  arrives late, or when a replaced file with the same content is re-read from offset 0.
- A Reset never rewrites the stack and never pops back to `Runs`. Each screen re-checks its id when it is
  shown, with the same placeholder rule, and the status bar carries the data layer's Reset notice.
- A selected span that is missing falls back to the root, or to the first row of a partial trace. A body
  that cannot be read shows the data layer's `BodyMissing` or `BodyReadFailed` placeholder.

**Amended by** [Trace view layout and interaction](10-trace-view-prototype.md): the `Trace` view also carries
`openGroups` (closed same-name sibling groups are the default) and `logScope` (default span + descendants).

**Amended by** [Run and trace list screens](15-list-screens.md): the `Runs` view also carries `sort` and
`reverse`; the `Traces` view carries `sort`, `reverse` and `openGroups` (root span names). A file with one run
opens on `[Runs, Traces R]`.
