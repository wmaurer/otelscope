# 07 · Body viewer

A full-screen pager for a span's bodies. Bodies are never shown inline in the trace view; its details pane keeps
one-line previews.

Source: [Body viewer](../../../.wayfinder/span-viewer-tui/tickets/16-body-viewer.md), with the `Esc` and `Home`/`End`
amendments from [Keymap and help](../../../.wayfinder/span-viewer-tui/tickets/19-keymap-and-help.md).

## Opening and switching

- From the trace view, `b` (any pane) pushes `Body { traceId, spanId, prefix: <first prefix>, view: default }`
  ([04-navigation.md](04-navigation.md)). A click on a Bodies row in details pushes that prefix.
- The span's body prefixes come from its `<prefix>.sha256` attributes, sorted by prefix, the same order as the details
  pane's Bodies section.
- **`Tab`/`Shift-Tab`** switch to the next/previous body on the span with `replace`, keeping `search`, `wrap` and
  `raw`, and resetting `topLine`, `leftCol` and `current`.
- `Esc` returns to the trace with its view state intact.

## Layout

```
Runs › shop-api · 14:03:27 › POST /orders 5643b831 › llm.request
llm.request · llm.chat · 118.2 KB · json · L 120–160 / 4,210 · match 3/41
 llm.request │ llm.response
⚠ truncated: showing 1,000,000 of 1,213,045 bytes
  "messages": [
    {
      "role": "user",
      "content": "Summarise the invoice
        and list the line items"
…
/ search · r raw · w wrap · y copy · ? help                   spans.jsonl  following  4 runs · 511 spans
```

- **Header**: prefix, span name, size (`<prefix>.bytes`), detected format (`json` or `text`, plus `· raw` in raw
  view), position `L <first>–<last> / <total>` in rendered rows, and `match 3/41` while a search is active.
- **Tab row**: every body prefix of the span, the current one highlighted. Shown only when the span has more than one.
- **Truncated** (`BodyText.truncated`): a warning line under the tab row, `⚠ truncated: showing <stored bytes> of
  <declared bytes> bytes`. The writer's `truncated N chars` line stays at the end of the text.

## Rendering

- **JSON is detected by parsing**: trimmed text starting with `{` or `[` that `JSON.parse` accepts is shown
  pretty-printed with two-space indents, compact bodies included.
- **Colours** come from a small tokenizer that walks the parsed value and emits keys, strings, numbers and literals
  (`true`, `false`, `null`) in the theme's JSON roles. No tree-sitter: OpenTUI's `<code>` needs a worker and ships no
  JSON grammar.
- **A string holding `\n`** is shown as real lines, the continuation lines indented under its key, in the string
  colour. This is no longer strictly JSON; raw view is the exact text.
- **`r`** toggles raw (the file exactly as stored) and formatted.
- **Everything else is plain text**, HTML and Markdown included.
- **Wrapping** is on by default, at word boundaries (a word longer than the width is broken). `w` turns it off; then
  `h`/`l`/`←`/`→` scroll sideways by 8 columns (`leftCol`).
- **Windowed drawing.** The rendered rows are computed once per (body, width, wrap, raw) and memoised; only the
  visible rows are drawn. A body is at most about 4 MB and splits in milliseconds; `G` and the position need the
  total row count.
- `topLine` counts rendered rows, so it resets to 0 when `wrap`, `raw` or `prefix` changes, and is clamped when the
  width changes.

## States

| State                                 | Shows in place of the text                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| loading                               | `loading…`                                                                                             |
| `BodyMissing`                         | `bodies/<sha256>.txt not found next to <file>`, then the attribute's `.preview`, marked `preview only` |
| `BodyReadFailed`                      | the same, with the error message in place of "not found"                                               |
| span or trace missing (after a Reset) | the usual placeholder ([04-navigation.md](04-navigation.md#missing-ids))                               |

No size limit beyond the writer's cap: the 32 MB body cache loads any body whole.

## Search

- `/` opens the input in place of the status bar, prefilled with the current `search`. The query is a **plain
  substring**, not the query language of [08-search.md](08-search.md): case-insensitive unless it holds a capital
  letter, matched against the text as shown (formatted or raw), so a match may cross a wrapped row.
- `⏎` keeps the query and jumps to the first match at or after the top row, else to the first match. Typing only
  highlights; it never scrolls. Every match is highlighted and the current one marked.
- `n`/`N` go to the next/previous match, wrapping around. They continue from the current match while it is on screen,
  else from the top row. The current match is `BodyView.current`, its offset in the shown text; it counts only while
  a match starts there, and `r` and `Tab` reset it.
- `Esc` in the input restores the previous query. An empty query submitted clears the highlights.
- With highlights active, `Esc` clears them first; the next `Esc` goes back.

## Handing off

- **`e`** opens `bodies/<sha256>.txt` in `$VISUAL`/`$EDITOR` ([09-keys-and-chrome.md](09-keys-and-chrome.md#editor)).
  It is the raw stored file; the status line warns `editing changes the stored body (bodies are shared by hash)`.
- **`y`** copies the body as shown (formatted or raw) through OSC 52 and says `copied 12.4 KB`. Above **100 KB** it
  copies nothing and says `too large to copy (3.4 MB), use e`, because terminals cap OSC 52 and some truncate
  silently. Under tmux the system clipboard needs `set-clipboard on`.
- No `$PAGER`: the screen is already a pager.

## Keys

| Keys                   | Action                             |
| ---------------------- | ---------------------------------- |
| `j`/`k`/`↑`/`↓`        | one row                            |
| `Ctrl-d`/`Ctrl-u`      | half page                          |
| `Space`/`PgDn`, `PgUp` | page                               |
| `g`/`G`/`Home`/`End`   | ends                               |
| `h`/`l`/`←`/`→`        | sideways (wrapping off)            |
| mouse wheel            | scroll                             |
| `Tab`/`Shift-Tab`      | next / previous body on the span   |
| `r` · `w`              | raw / formatted · wrapping         |
| `/` · `n`/`N`          | search · next / previous match     |
| `y` · `e`              | copy · open in `$VISUAL`/`$EDITOR` |
| `Esc` · `q`            | clear search, else back · quit     |
