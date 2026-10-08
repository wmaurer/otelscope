---
id: "17"
title: Search and filter
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: [15]
---

## Question

What can be searched and filtered, and how? Decide:

- what a query matches: span name, attribute keys and values, exit state, log text, exception type;
- the query syntax (plain substring, `key=value` terms, exit filters such as `failed`);
- where it applies: the run and trace lists, the span tree, the logs pane;
- whether a match filters (hides the rest) or highlights and jumps (`n`/`N` already move between problem
  spans in the tree);
- how the search input takes focus and coexists with single-letter keys;
- whether filters live in each screen's view state, so `Esc` back restores them.

**Amended by** [Body viewer](16-body-viewer.md): the Body screen has its own local `/` search (substring, smart
case, `n`/`N` between matches), which stays local whatever `/` means elsewhere.

## Resolution

2026-10-08, grilled with wmaurer.

### Filter or highlight

Flat lists filter; the tree, whose shape carries meaning, highlights and jumps.

- **Runs and Traces:** `/` filters, hiding rows that do not match. A group heading counts only its matching
  members (`▸ POST /orders ×12 (of 3000)`), and the "at most 5 problems shown closed" rule applies to them.
  `n`/`N` keep their meaning, next and previous problem, among the visible rows.
- **Span tree:** `/` highlights and never hides; the tree keeps its full shape. While a query is active, `n`/`N`
  move between matches, opening folds and groups on the way and wrapping around; with the query cleared they go
  back to problem spans. This is the Body viewer's pattern.
- **Logs pane:** `/` filters through `logFilter`, inside the scope `s` picks.
- **Body screen:** unchanged, its own local substring search.

### Query syntax

The same small grammar on every screen except Body. A query that does not parse (an unclosed quote) is read as
plain text, so it is never an error.

- **Terms** are separated by spaces and must all match. `"quoted terms"` keep their spaces.
- **A plain term** is a substring, smart case: all lowercase ignores case, any capital makes it case-sensitive.
- **`key=value`** matches an attribute whose key is exactly `key` and whose value contains `value`
  (`http.status_code=500`); `key=` matches the attribute's presence.
- **`is:failed`, `is:interrupted`, `is:ok`** match the exit state. On a log line `is:` matches the level
  instead (`is:error`, `is:warn`, …).
- Not in v1: regex, negation, `OR`, numeric comparisons, field prefixes. Each can be added later without
  changing what existing queries mean.

### What a term matches

A plain term matches a **span** through its name, attribute keys and values (stringified; a body only through
its `.preview`), event names and their attributes (so log messages), exception type and message, span and trace
id, `service`, and the file paths in `site`/`def`. Body files are never read for search.

| Level           | Matches when                                                               |
| --------------- | -------------------------------------------------------------------------- |
| Span (tree)     | every term matches that one span                                           |
| Trace (Traces)  | each term matches some span of the trace, not necessarily the same one     |
| Run (Runs)      | each term matches some span of the run, or the run id                      |
| Log line (Logs) | each term matches its message, level, fiber `#n`, span name or annotations |

So `is:failed http.route=/orders` finds the traces whose root carries the route and whose child failed, and
`order-api` on the Runs screen narrows to one service. Matching is the data layer's debounced linear scan over
the snapshot (about 150 ms debounce, no index); the performance fog can revisit it.

### Input and focus

- `/` opens a one-line input in place of the status bar, **prefilled with the current query**:
  `/ payment declined▏   12 of 3000 traces`. While it is open every key is text; `←`/`→`, `Ctrl-a`/`Ctrl-e`,
  `Backspace`, `Ctrl-w` and `Ctrl-u` edit, and `↑`/`↓` recall earlier queries from a session-wide history that
  is kept in memory only.
- **Incremental:** lists and the logs filter update as you type; the tree highlights live and moves the
  selection to the first match at or after the current span.
- `⏎` keeps the query and returns keys to the screen. `Esc` in the input restores the query from before `/`.
  An empty query submitted clears it.
- An active query stays on screen: `/ payment declined · 12 of 3000`, or `match 3/17` in the tree.
- **`Esc` on a screen first clears its active query; the next `Esc` goes back.** On the Trace screen it clears
  the focused pane's query.
- On the Trace screen `/` belongs to the focused pane: tree or details search the tree, logs set `logFilter`.
  The two queries are independent.
- No mouse interaction for search in v1.

### Showing matches

- **Lists:** matched text is highlighted in the visible columns (service, root span, error, …). A row that
  matched only through content not shown gets no extra hint in v1; opening it shows the seeded search. A
  "matched in" snippet can come later.
- **Tree:** a matching span has an accent mark in the gutter and its name highlighted; bars keep their exit
  colours. A folded span or closed group hiding matches shows `· 3 matches` on its row.

### View state and seeding

| Screen   | Query fields                                           |
| -------- | ------------------------------------------------------ |
| `Runs`   | `filter: string` (exists)                              |
| `Traces` | `filter: string` (exists)                              |
| `Trace`  | `search: string` (new, the tree), `logFilter` (exists) |

- **Queries seed down once, at push.** Opening a run from a filtered Runs list seeds the Traces `filter`;
  opening a trace from a filtered Traces list seeds the tree `search`. `logFilter` is not seeded. After the push
  each copy is independent: clearing one never touches the screen below.
- A trace opened with a seeded search selects the **first matching span** in tree order, unfolding to reach it.
  When no single span matches every term (the trace matched across spans), it falls back to the first-problem
  rule and the search line reads `no single span matches all terms`.
- **No global search screen in v1.** The Runs filter matches across all spans, so Runs → Traces → Trace with the
  query seeded down is the cross-run search. A jump that pushes `Trace` straight onto `Runs` stays possible in
  the stack but is not built.

### Live data

Filters and highlights are re-applied on every snapshot: matching rows appear and counts update. Selection stays
by id; records never change once written, so a selected row cannot stop matching. After a Reset the query is
kept and the list refills. In the tree `match 3/17` updates as spans arrive, and the cursor never moves by
itself.
