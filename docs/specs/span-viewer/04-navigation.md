# 04 · Navigation

A typed stack of screens in an atom. No router: the "URL" is never visible, typed, shared or bookmarked, the screens
are few and fixed, and live data flows through the store, not loaders. TanStack Router works under OpenTUI only with
four workarounds and is unsupported off the browser, so it is not used.

Sources: [Route tree and URL state](../../../.wayfinder/span-viewer-tui/tickets/09-routes-and-url-state.md) and the
amendments to it from the trace view, list screens, body viewer, search, live-tail and CLI tickets.

## Types

```ts
type Screen = Data.TaggedEnum<{
    Runs:   { view: RunsView };
    Traces: { runId: RunId; idIsPrefix: boolean; view: TracesView };
    Trace:  { traceId: TraceId; idIsPrefix: boolean; viaRun: Option<RunId>; view: TraceView };
    Body:   { traceId: TraceId; spanId: SpanId; prefix: string; view: BodyView };
}>;

interface Nav { readonly stack: NonEmptyReadonlyArray<Screen> } // the head is always Runs

interface RunsView {
    readonly selected: Option<RunId>;      // None: following (see below)
    readonly filter: string;
    readonly sort: "newest" | "service" | "failures" | "duration";
    readonly reverse: boolean;
    readonly newerThan: Option<number>;    // newest row's firstStartMs when following stopped
}

interface TracesView {
    readonly selected: Option<TraceRow>;
    readonly filter: string;
    readonly sort: "start" | "duration" | "failures" | "spans";
    readonly reverse: boolean;
    readonly openGroups: HashSet<string>;  // root span names
    readonly newerThan: Option<number>;    // newest row's startMs when following stopped
}

type GroupKey = `${SpanId}|${string}`;     // parent span id (or "" for top level) | span name

// What a selection points at: a row is stored by what it shows, never by its index.
type TraceRow = Data.TaggedEnum<{
    Trace:   { traceId: TraceId };
    Heading: { name: string };             // a group heading (root span name)
    More:    { name: string };             // a closed group's "⋯ N more" row
}>;
type TreeRow = Data.TaggedEnum<{
    Span:    { spanId: SpanId };
    Group:   { key: GroupKey };            // a same-name group row
    Missing: { parentId: SpanId };         // a "missing parent" placeholder row
}>;

interface TraceView {
    readonly selected: Option<TreeRow>;    // None until the opening selection is computed
    readonly folded: HashSet<SpanId>;      // empty: everything expanded
    readonly openGroups: HashSet<GroupKey>; // empty: every group closed
    readonly pane: "tree" | "details" | "logs";
    readonly logScope: "span" | "subtree" | "trace";
    readonly search: string;               // the tree's highlight query
    readonly logFilter: string;
    readonly logCursor: Option<string>;    // `${spanId}:${eventIndex}`
    readonly detailsTop: number;           // details pane scroll
}

interface BodyView {
    readonly topLine: number;              // in rendered rows
    readonly leftCol: number;
    readonly wrap: boolean;
    readonly raw: boolean;
    readonly search: string;
}
```

Defaults: `RunsView` `{ None, "", "newest", false, None }`; `TracesView` `{ None, "", "start", false, ∅, None }`;
`TraceView` `{ None, ∅, ∅, "tree", "subtree", "", "", None, 0 }`; `BodyView` `{ 0, 0, true, false, "" }`.

- **Selection is stored by id, never by row index**, so live inserts and re-sorts never move the cursor. Rows that are
  not a run, trace or span are stored by what they show (`TraceRow`, `TreeRow`).
- **When a group forms** under a selected trace or span, the selection keeps pointing at the member, which stays
  visible beneath the closed group ([06](06-trace-view.md#same-name-groups)). A selected `Heading`, `More`, `Group` or
  `Missing` row that no longer exists (its group dissolved after a Reset, its parent arrived) follows the missing-id
  rule below; a `Missing` row whose parent arrived selects that parent instead.
- List scroll offsets are not stored: the windowed list derives them to keep the selection in view. The Body pager
  has no selection, so it stores `topLine`.
- `viaRun` records which run's list a trace was opened from. It is used for the breadcrumb only, never for lookup.

## Operations

Pure functions over `Nav`, in `src/nav/`, unit-tested without a renderer:

- `push(nav, screen)`;
- `replace(nav, screen)`: swaps the top screen (the Body screen's `Tab`);
- `back(nav)`: pops one screen; does nothing on `[Runs]`;
- `update(nav, f)`: applies `f` to the top screen's `view`;
- `updateBelow(nav, f)`: applies `f` to the screen under the top (used when a seeded id resolves, below).

Invariants (property-tested): `back(push(nav, s))` equals `nav`; `replace` never grows the stack; the head is always
`Runs`.

`navAtom` holds the `Nav`. Key handlers change it through `useAtomSet`. Live data never goes through navigation:
screens read the snapshot through atoms keyed by their ids.

## Pushes

| From   | Action                          | Pushes                                                                                           |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Runs   | `⏎` on a run                    | `Traces { runId, view: { filter: <Runs filter> } }`                                              |
| Traces | `⏎` on a trace                  | `Trace { traceId, viaRun: Some(runId), view: { selected: <opening>, search: <Traces filter> } }` |
| Trace  | `b`, or a click on a Bodies row | `Body { traceId, spanId, prefix }`                                                               |

- **Queries seed down once, at push.** The pushed screen's `filter` (Traces) or `search` (Trace) starts as the list's
  active query. `logFilter` is not seeded. After the push each copy is independent.
- **The opening selection** of a trace is computed once ([06-trace-view.md](06-trace-view.md#opening-a-trace)) and
  stored in `selected`. When the trace is not in the snapshot at push (a seeded `--trace`, or after a Reset),
  `selected` stays `None`; the first time the Trace screen renders with the trace present, it computes the opening
  selection and stores it with `update`. It is never recomputed after that.
- A jump that pushes `Trace` straight onto `Runs` is allowed by the stack (the CLI does it), but no key does it in v1.

## Seeding from the CLI

The initial `Nav` is built from the arguments before the first render ([10-cli.md](10-cli.md)):

| Arguments           | Stack                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| none                | `[Runs]`                                                                 |
| `--run R`           | `[Runs { selected: R }, Traces R]`                                       |
| `--trace X`         | `[Runs, Trace X]`                                                        |
| `--run R --trace X` | `[Runs { selected: R }, Traces R { selected: Trace(X) }, Trace X via R]` |

Seeded ids have `idIsPrefix: true`, and the screens below them carry the seeded `selected`, so they do not follow
when the user goes back ([05-list-screens.md](05-list-screens.md#following)).

**Prefix resolution.** While a screen's `idIsPrefix` is true, each snapshot resolves its id: an exact match wins;
otherwise the ids that start with it. On the first snapshot where exactly one matches, the screen's id is rewritten
to the full id, `idIsPrefix` becomes false, and the `selected` of the screen below is rewritten to match. It is never
re-resolved. Before that the screen shows a placeholder (below), with `9f3c matches 3 traces` when the prefix is
ambiguous.

**One-run files.** If the stack is still exactly the initial `[Runs]` (no `--run`, no `--trace`) and no key has been
pressed, then when the phase first leaves `loading` (the first `CaughtUp`) and the snapshot holds exactly one run,
`Traces R` is pushed. `Esc` still reaches Runs. Deciding at the end of the initial read, not at the first publish,
matters because the first publish covers only the first 1 MB, which can hold one run of several.

## Missing ids

A screen whose id is not in the snapshot stays on the stack, keeps its `view`, and shows a placeholder in place of
its content (the status bar and breadcrumb stay):

| Situation                    | Placeholder                        |
| ---------------------------- | ---------------------------------- |
| phase `waiting` or `loading` | `Loading… looking for trace 9f3c…` |
| a prefix matching several    | `9f3c matches 3 traces`            |
| otherwise                    | `Trace 9f3c… is not in the file`   |
| …after a Reset               | adds `(file reset at 12:03:04)`    |
| always                       | `Esc to go back`                   |

The noun is `run`, `trace` or, on Body, `span`. If the id appears later the screen renders normally: a seeded id that
arrives late, or a replaced file with the same content re-read from offset 0.

- **A Reset never rewrites the stack** and never pops to Runs. Each screen re-checks its id on render; the status bar
  carries the Reset notice.
- **A missing selected id in a list** shows the first row as selected, but the stored id is not overwritten until the
  user moves, so the selection returns if the id does.
- **A missing selected row** in a present trace falls back to the root, or to the first row of a partial trace,
  without overwriting the stored key.
- **A body that cannot be read** shows the `BodyMissing` or `BodyReadFailed` state ([07-body-viewer.md](07-body-viewer.md#states)).

## Breadcrumb

The first line of every screen, dim, with the current screen's segment bright:

```
Runs › shop-api · 14:03:27 › POST /orders 5643b831 › llm.request
```

| Screen | Segment                                                                       |
| ------ | ----------------------------------------------------------------------------- |
| Runs   | `Runs`                                                                        |
| Traces | the run label ([09](09-keys-and-chrome.md#formatting)), or the placeholder id |
| Trace  | the trace's `headName` and its short id                                       |
| Body   | the prefix                                                                    |

A Trace pushed without `viaRun` follows `Runs` directly. When the line is too narrow, segments are cut from the left,
keeping the current one, behind a leading `…`. No mouse interaction.
