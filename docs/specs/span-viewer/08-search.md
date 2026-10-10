# 08 · Search and filter

One small query language for the Runs, Traces and Trace screens. Flat lists **filter**; the span tree, whose shape
carries meaning, **highlights and jumps**; the logs pane filters. The Body screen has its own plain substring search
([07-body-viewer.md](07-body-viewer.md#search)).

Source: [Search and filter](../../../.wayfinder/span-viewer-tui/tickets/17-search-and-filter.md).

## Where `/` applies

| Screen / pane          | Field                 | Effect                                                                    |
| ---------------------- | --------------------- | ------------------------------------------------------------------------- |
| Runs                   | `RunsView.filter`     | hides runs that don't match                                               |
| Traces                 | `TracesView.filter`   | hides traces that don't match; group headings count matching members only |
| Trace, tree or details | `TraceView.search`    | highlights matching spans; never hides                                    |
| Trace, logs            | `TraceView.logFilter` | hides log lines that don't match, within the scope `s` picks              |
| Body                   | `BodyView.search`     | plain substring search, not this language                                 |

## Syntax

A query is a list of **terms** separated by spaces. Every term must match.

| Term                                     | Matches                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `payment`                                | a substring of any searchable text (below)                                                           |
| `"card declined"`                        | a quoted term keeps its spaces                                                                       |
| `key=value`                              | an attribute whose key is exactly `key` and whose value, as a string, contains `value`               |
| `key=`                                   | an attribute named `key` is present                                                                  |
| `is:failed` · `is:interrupted` · `is:ok` | the span's exit (`Failure`, `Interrupted`, `Success`)                                                |
| `is:<level>`                             | on a log line only: its level (`is:error`, `is:warn`, `is:info`, `is:debug`, `is:trace`, `is:fatal`) |

- **Smart case**: a term in all lowercase ignores case (by Unicode's simple case folding); any capital letter makes it
  case-sensitive. This applies to plain terms and to the value of `key=value` (keys always match exactly).
- **A query that does not parse** (an unclosed quote) is read as plain terms split on spaces, quotes included. A query
  is never an error.
- An unknown `is:` value matches nothing.
- Not in v1: regex, negation, `OR`, numeric comparisons, field prefixes. Each can be added later without changing
  what existing queries mean.

The parser is a pure function `parse(query) → ReadonlyArray<Term>` in `src/query/`, and matching is pure over a span
or log line.

## What a span's text is

A plain term matches a span through: its name; attribute keys and values (stringified; a body only through its
`.preview`); event names and event attribute keys and values (so log messages and annotations); `exception.type` and
`exception.message`; span id and trace id; `service`; the file paths of `site` and `def`; and its fiber as `#n`. Body
files are never read for search.

| Level           | Matches when                                                               |
| --------------- | -------------------------------------------------------------------------- |
| Span (tree)     | every term matches that one span                                           |
| Trace (Traces)  | each term matches some span of the trace, not necessarily the same one     |
| Run (Runs)      | each term matches some span of the run, or the run id                      |
| Log line (logs) | each term matches its message, level, fiber `#n`, span name or annotations |

So `is:failed http.route=/orders` on Traces finds the traces where some span carries the route and some span failed,
and `shop-api` on Runs narrows to one service. On Runs, a span "of the run" is a span whose `run` is that run.

## Evaluation

- A debounced (about **150 ms**) linear scan over the snapshot in a derived atom, with no index. Results are cached per
  (query, trace identity) in a `WeakMap` keyed by the `Trace` object, so a publish rescans only the traces that
  changed.
- Filters and highlights are re-applied on every snapshot: matching rows appear and counts update. Records never
  change once written, so a selected row never stops matching. After a Reset the query is kept and the list refills.
- The search budget ([12-performance.md](12-performance.md)) decides whether the scan is enough; the inverted index
  is the pre-approved remedy.

## The input

- `/` opens a one-line input **in place of the status bar**, prefilled with the current query, with the match count
  on the right: `/ payment declined▏      12 of 3000 traces`.
- While it is open every key is text, except: `←`/`→`, `Ctrl-a`/`Ctrl-e`, `Backspace`, `Ctrl-w` and `Ctrl-u` edit;
  `↑`/`↓` recall earlier queries from a session-wide history (in memory, most recent first, duplicates collapsed);
  `⏎` keeps the query and returns keys to the screen; `Esc` restores the query from before `/`; `Ctrl-c` quits.
- **Incremental**: lists and the logs filter update as you type (after the debounce). In the tree, highlights update
  live and the selection moves to the first match at or after the current span, unfolding to it.
- An empty query submitted clears it.
- No mouse interaction for search in v1.

## Showing an active query

- The status bar's left part shows it in place of the hints: `/ payment declined · 12 of 3000` on lists,
  `/ payment declined · match 3/17` in the tree.
- **Lists** highlight the matched text in visible columns (service, root span, error). A row that matched only
  through content not shown gets no extra hint in v1.
- **Tree**: a matching span has the accent `▌` in the match gutter and its matched text highlighted in the name; bars
  keep their exit colours. A folded span or closed group hiding matches shows ` · 3 matches`.
- **Logs**: the matched text is highlighted.
- Highlights fold case exactly as matching does, with the same regular expression, so a column whose text matched
  always shows where (`status` highlights all of `ſtatus`, `μs` the `µs` of `12 µs`). Lowercasing each character would
  miss what simple case folding finds.

## Movement with a query

- **Lists**: `n`/`N` keep meaning next/previous problem, among visible rows.
- **Tree**: while `search` is non-empty, `n`/`N` move between matches in tree order, wrapping, unfolding folds and
  opening groups on the way. With it cleared they move between problem spans again.

## `Esc`

`Esc` on a screen first clears its active query; the next `Esc` goes back. On the Trace screen it clears the focused
pane's query (`search` from tree or details, `logFilter` from logs).

## Seeding

Queries seed down **once, at push** ([04-navigation.md](04-navigation.md#pushes)): opening a run from a filtered Runs
list seeds the Traces `filter`; opening a trace from a filtered Traces list seeds the tree `search`. `logFilter` is not
seeded. After the push each copy is independent. There is no global search screen: Runs → Traces → Trace with the
query seeded down is the cross-run search.
