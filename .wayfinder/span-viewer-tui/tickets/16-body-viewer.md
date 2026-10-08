---
id: "16"
title: Body viewer
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: []
---

## Question

How does the `Body` screen work? The details pane lists bodies one row per prefix with size and preview. Decide:

- the key that opens the selected body, and how a body is selected in the details pane;
- how the body is rendered: plain text, JSON pretty-printed, syntax highlighting, line wrapping;
- what happens when the body file is missing or larger than is sensible to load;
- whether a key hands the body to `$PAGER` or `$EDITOR`, as `e` already does for source locations;
- the screen's keys (scroll, search within the body, back).

## Resolution

2026-10-08, grilled with wmaurer. Checked against the sample fixture's bodies: compact and pretty JSON
(`llm.request`, `llm.response`, `agent.transcript`, with prompts holding `\n` inside strings), a one-line HTML
`email`, and a one-line body cut at the 1,000,000-character cap.

### Opening a body

- **`b` (any pane of the trace view)** opens the selected span's first body, in the order the details pane's
  Bodies section lists them. A span without bodies says "no bodies on this span" in the status line. Clicking a
  Bodies row opens that body. The details pane gets no cursor; it still only scrolls.
- **The Body screen shows the span's bodies as a tab row** (`llm.request │ llm.response`); `Tab`/`Shift-Tab`
  switch between them, so a request and its response are one key apart.
- **The trace view never shows bodies inline.** The details pane keeps its one-line `.preview` per body; the
  full text lives only on the Body screen.

### Route and view state

`Body` becomes `{ trace: TraceId; span: SpanId; prefix: string; view: BodyView }`, so the screen can find the
span's other bodies; `Tab` swaps the top screen with `replace`. The sha256 and
title come from the span's `<prefix>.sha256` attribute and the prefix. A trace or span missing after a Reset
shows the usual placeholder.

```ts
BodyView = { topLine: number; leftCol: number; wrap: boolean; raw: boolean; search: string }
// defaults: 0, 0, true, false, ""
```

`topLine` counts rendered rows, so it resets to 0 when `wrap`, `raw` or `prefix` changes. `search` is kept
across `Tab`.

### Rendering

- **JSON is detected by parsing**: trimmed text starting with `{` or `[` that `JSON.parse` accepts is shown
  pretty-printed with two-space indents, compact bodies included. Keys, strings, numbers and literals take
  theme role colours from a small tokenizer that walks the parsed value; no tree-sitter (OpenTUI's `<code>`
  needs a worker and ships no JSON parser).
- **A string holding `\n` is shown as real lines**, indented under its key in the string colour. This is not
  strictly JSON any more; raw view is the exact text.
- **`r` toggles raw / formatted.** Raw is the file exactly as stored.
- **Everything else is plain text**, HTML and Markdown included. More formats are later work.
- **Wrapping is on by default, at word boundaries**; `w` turns it off, and `h`/`l`/`←`/`→` then scroll
  sideways by `leftCol`.
- **Windowed drawing.** The rendered rows are computed once per (body, width, wrap, raw) and memoized; only the
  visible rows are drawn, like the windowed list. A capped body (at most about 4 MB) splits in milliseconds,
  and `G` and the position need the total row count.

### Header and states

- **Header:** prefix, span name, size in bytes, detected format (`json` / `text`, plus `raw`), position
  (`L 120–160 / 4,210`), and `match 3/41` while a search is active.
- **Truncated** (the data layer's `truncated`): a warning line `truncated: showing 1,000,000 of 3,412,880
  bytes` under the header; the details pane's Bodies row is marked too. The writer's `truncated N chars` line
  stays at the end of the text.
- **`BodyMissing`:** "`bodies/<sha256>.txt` not found next to `<file>`", then the attribute's `.preview`
  marked "preview only". **`BodyReadFailed`:** the same, with the error in place of "not found".
- **Loading:** `loading…` in place of the text.
- No size limit beyond the writer's cap: the 32 MB body LRU already loads any body whole.

### Handing off

- **`e` opens `bodies/<sha256>.txt` in `$VISUAL`/`$EDITOR`**, suspending the renderer until the editor exits,
  as `e` does for source locations. It is the raw stored file; the status line warns that editing changes the
  stored body, since files are content-addressed.
- **`y` copies the body as shown** (formatted or raw) through OSC 52. Above 100 KB it copies nothing and says
  "too large to copy (3.4 MB), use e", because terminals cap OSC 52 and some truncate silently. Under tmux the
  system clipboard needs `set-clipboard on`.
- No `$PAGER`: the screen is already a pager, and the editor covers the rest.

### Search within a body

- `/` opens an input. The query is a plain substring, case-insensitive unless it holds a capital letter, matched
  against the text as shown (formatted or raw), so a match may cross a wrapped row.
- `⏎` jumps to the first match at or after the top row; every match is highlighted and the current one marked.
  `n`/`N` go to the next and previous match and wrap around.
- `Esc` in the input cancels it; an empty query submitted clears the highlights. The global search ticket may
  give `/` a wider meaning elsewhere, but on the Body screen it is always this local search.

### Keys

| Keys                   | Action                             |
| ---------------------- | ---------------------------------- |
| `j`/`k`/`↑`/`↓`        | one row                            |
| `Ctrl-d`/`Ctrl-u`      | half page                          |
| `Space`/`PgDn`, `PgUp` | page                               |
| `g`/`G`                | ends                               |
| `h`/`l`/`←`/`→`        | sideways (wrapping off)            |
| mouse wheel            | scroll                             |
| `Tab`/`Shift-Tab`      | next / previous body on the span   |
| `r` · `w`              | raw / formatted · wrapping         |
| `/` · `n`/`N`          | search · next / previous match     |
| `y` · `e`              | copy · open in `$VISUAL`/`$EDITOR` |
| `Esc` · `q`            | back to the trace · quit           |

**Amended by** [Keymap and help across screens](19-keymap-and-help.md): `Esc` with search highlights active clears
them first, and the next `Esc` goes back; `Home`/`End` join the movement keys.
