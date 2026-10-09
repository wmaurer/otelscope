# 09 · Keys, chrome and shared pieces

Key handling, the status bar, hints, help, the bad-lines overlay, mouse rules, the windowed list, the theme,
formatting, and the editor and clipboard hand-offs.

Sources: [Keymap and help across screens](../../../.wayfinder/span-viewer-tui/tickets/19-keymap-and-help.md),
[Live-tail UX](../../../.wayfinder/span-viewer-tui/tickets/18-live-tail-ux.md),
[OpenTUI building blocks](../../../.wayfinder/span-viewer-tui/tickets/05-opentui-building-blocks.md),
[Source locations](../../../.wayfinder/span-viewer-tui/tickets/11-source-locations.md),
[Body viewer](../../../.wayfinder/span-viewer-tui/tickets/16-body-viewer.md).

## Key handling

- **Our own binding table, not `@opentui/keymap`.** Its scoping follows OpenTUI renderable focus, while ours is app
  state (the Trace view's `pane`, whether an input or overlay is open), and its strengths (sequences, leaders) go
  unused.
- **One `useKeyboard` at the root** feeds a pure dispatch in `src/keys/`:

    ```ts
    type Mode = "input" | "overlay" | "screen";
    type Scope = "global" | "movement" | Screen["_tag"] | `Trace.${TraceView["pane"]}`;
    interface Binding {
        readonly keys: ReadonlyArray<string>;   // as received: "j", "G", "/", "?", "ctrl+d", "shift+tab", "return", "escape", "space"
        readonly action: Action;
        readonly label: string;                 // for hints and help
        readonly hintRank?: number;             // shown in the hint line when set, lowest first
        readonly scope: Scope;
    }
    const dispatch = (mode: Mode, nav: Nav, key: KeyEvent): Option<Action> => …
    ```

    `Action` is a tagged union of everything a key can do (move, open, fold, toggle group, sort, focus pane, quit, …).
    The root applies it to `navAtom`, `panesAtom` or component state. Dispatch is tested without a renderer.

- **Lookup order** in `screen` mode: the focused pane's scope (Trace only), then the screen's scope, then movement,
  then global. In `input` mode only the input's editing keys, `⏎`, `Esc` and `Ctrl-c` act; everything else is text.
  In `overlay` mode only movement, the overlay's own key (`?` or `!`), `Esc` and `q` (each closes it) and `Ctrl-c`
  act; the other overlay's key does nothing.
- The same table generates the hint line and the `?` overlay, so help cannot drift from behaviour.
- **Keys match on the character received**, not the physical key, so `/`, `+`, `<`, `?` work on any layout
  (Swiss-German included).
- Unbound keys are ignored silently.

## Global keys

- **`Esc` peels one layer**, innermost first: an open input or overlay closes; else an active query clears (a list
  filter, the focused pane's query on Trace, the Body search); else the screen goes back (nothing on Runs).
- **`q` quits immediately**, with no confirmation: the viewer is read-only. In an input it is text; in an overlay it
  closes the overlay.
- **`Ctrl-c` quits from anywhere**, inputs included. The renderer is created with `exitOnCtrlC: false`; the quit action
  completes the app's quit `Deferred`, so Effect's scope closes the watcher and restores the terminal. The renderer
  never exits on its own.
- **`Ctrl-z` suspends** to the shell: `renderer.suspend()`, then `process.kill(process.pid, "SIGTSTP")`; a `SIGCONT`
  handler calls `renderer.resume()`. Raw mode does not deliver `Ctrl-z` as a signal, so this must be ours.
- `/` query, `?` help, `!` bad lines.

## The v1 keymap

| Scope             | Keys                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global            | `/` query · `Esc` peel one layer · `?` help · `!` bad lines · `q` quit · `Ctrl-c` quit anywhere · `Ctrl-z` suspend                                   |
| Movement (shared) | `j`/`k`/`↑`/`↓` row · `Ctrl-d`/`Ctrl-u` half page · `PgDn`/`PgUp` page · `g`/`G`/`Home`/`End` ends · wheel · click                                   |
| Runs, Traces      | `⏎` open, or toggle a group · `Space` toggle a group · `n`/`N` problem · `S` sort · `r` reverse · `g`/`G` at the newest end resumes following        |
| Trace (any pane)  | `1`/`2`/`3` focus tree, details, logs · `Tab`/`Shift-Tab` cycle · `-`/`+`/`=` split · `<`/`>` name column · `s` log scope · `b` body · `e` editor    |
| Trace, tree       | `⏎`/`Space` fold or toggle a group · `h`/`←` fold or parent · `l`/`→` unfold · `n`/`N` problem or match · `o` origin · `E` expand all · `C` collapse |
| Trace, logs       | `⏎` select the log's span                                                                                                                            |
| Body              | `Space` page · `h`/`l`/`←`/`→` sideways · `Tab`/`Shift-Tab` body · `r` raw · `w` wrap · `n`/`N` match · `y` copy · `e` editor                        |

Notes:

- **`h`/`l` mean left/right on every screen**: fold/parent and unfold in the tree, sideways in Body. Pane focus is on
  `1`/`2`/`3`, not letters.
- **`Space` toggles where rows fold** (lists, tree) and **pages down in Body**, the pager convention.
- Per-screen meanings where keys never meet on one screen: `r` reverse (lists) / raw (Body); `e` source location
  (Trace) / body file (Body); `s` log scope (Trace) vs `S` sort (lists).
- `y` is Body-only in v1.

### Hint ranks

| Screen / pane  | Hints, in rank order                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Runs           | `⏎ open` · `/ filter` · `n problem` · `S sort` · `? help`              |
| Traces         | `⏎ open` · `/ filter` · `n problem` · `S sort` · `? help`              |
| Trace, tree    | `⏎ fold` · `/ search` · `n problem` · `b body` · `o origin` · `? help` |
| Trace, details | `b body` · `e editor` · `1 tree` · `? help`                            |
| Trace, logs    | `⏎ go to span` · `/ filter` · `s scope` · `? help`                     |
| Body           | `/ search` · `r raw` · `w wrap` · `y copy` · `? help`                  |

`o origin` shows only on a propagated span; `n match` replaces `n problem` while a tree search is active.

## Status bar

One line at the bottom of every screen; the search input replaces it while open.

**Left**: the hint line, or a status message, or an active query's line. A status message (`no bodies on this span`,
`file truncated — reloaded`, `copied 12.4 KB`) replaces the hints for **5 s**, then the hints return.

**Right**, in this order:

| Part     | Shows                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| new rows | `↑ 3 new` / `↓ 12 new`, on a list that has stopped following ([05](05-list-screens.md#new-rows))                                                                      |
| problems | `⚠ 3 bad lines` amber (`!` opens the samples) · `120 lines from otelscope < 0.3 skipped` dim                                                                          |
| file     | the file's basename, dim                                                                                                                                              |
| phase    | `waiting for <absolute path>…` · `loading 43% · 41 / 96 MB` · `● following` green while a record arrived in the last 5 s, else `following` dim · `read once` (`done`) |
| size     | `57 runs · 12,480 spans`                                                                                                                                              |

- **Resets** flash `file truncated — reloaded`, `file replaced — reloaded` or `file removed` on the left for 5 s;
  the phase then reads `following · reloaded 12:03:04` until the next record arrives.
- **Read and watch errors** (`status.error`) show `⚠ <error>` in red in place of the phase until a read succeeds.
- **Drop order** when the line is too narrow: hints by rank from the last (keeping `? help`), then new rows, problems,
  file and size, then `? help`. The phase never drops; it is cut with `…` as a last resort.
- Runs and spans are shown, not lines read: bad lines are counted on their own.

## Help overlay (`?`)

- A centred bordered box over the current screen, which stays visible and live around it.
- **Current screen only**, in three groups: the screen's keys (on Trace, by pane, the focused pane first and marked),
  movement, and global keys plus one line on the mouse.
- Generated from the binding table. It scrolls with the movement keys when it does not fit; `?`, `Esc` or `q` close
  it; other keys, `!` included, are ignored.

## Bad-lines overlay (`!`)

Same modal rules as help. Lists the samples (`status.badLines.samples`): `line 1,204 · byte 412,330 · <issue>` and
the first 200 characters, dim. The title reads `Bad lines · 3 malformed · 120 legacy (not sampled)`. `!` opens it whenever
`malformed + legacy > 0`; with only legacy lines it shows the title and `legacy lines are not sampled`. With no bad
lines `!` sets the status message `no bad lines`.

## Mouse

- A click on a row selects it and focuses its pane; on a list it stops following, like any move.
- A click on the already-selected row acts as `⏎`. No double-click detection: OpenTUI sends only down and up, so a
  "click" is a down and up on the same row.
- A click on a fold mark or a group row toggles it.
- **The wheel scrolls the pane under the pointer**, without moving focus or selection. In a windowed list this is a
  transient scroll offset (component state) that snaps back to keep the selection in view on the next key move; a
  following list keeps following.
- Dragging the tree/details divider resizes the split. A click on a Bodies row opens that body.
- No mouse on the breadcrumb, hint line, column headers or axis.

## Windowed list

OpenTUI's `<scrollbox>` keeps every row as a React element and Yoga node, and `<select>` rows are plain strings, so
the run list, trace list, span tree and logs use one custom windowed list (`Select.ts` in OpenTUI is the template):

- Input: the full row model (an array of row descriptors, computed by `model/`), the selected index, the viewport
  height, and a row renderer.
- Only the visible slice is rendered.
- **Scroll derivation**: the offset keeps the selected row in view with at least 2 rows of context above and below
  when possible. When rows are inserted above the selection, the offset grows by the same amount, so the selected row
  keeps its screen position.
- The wheel offset (above) overrides the derived offset until the next key move.

## Theme

One theme object, every colour named by role, in `src/ui/theme.ts`. v1 ships this dark palette only; a light palette
is GitHub issue [#1](https://github.com/wmaurer/otelscope/issues/1). The background is the terminal's own.

| Role                  | Colour                | Used for                                       |
| --------------------- | --------------------- | ---------------------------------------------- |
| `text`                | `#d4d4d4`             | default text                                   |
| `muted`               | `#7f848e`             | dim text, headers, run ids, partial            |
| `faint`               | `#4b5263`             | guides, borders                                |
| `accent`              | `#61afef`             | running mark, match gutter, current breadcrumb |
| `focusBorder`         | `#61afef`             | focused pane border                            |
| `selectionBg`         | `#2c323c`             | selected row background                        |
| `matchBg`             | `#4d4220`             | matched text background                        |
| `bar`                 | `#56b6c2`             | success bars                                   |
| `failure`             | `#ff5f5f`             | failure origin, failed counts, `✗` bright      |
| `failurePropagated`   | `#a14848`             | propagated failure, `✗` dim                    |
| `interrupted`         | `#e5a50a`             | `⊘`, interrupted bars                          |
| `live`                | `#98c379`             | `●`                                            |
| `warning`             | `#e5c07b`             | `⚠` bad lines, truncated                       |
| `logTrace`/`logDebug` | `#5c6370` / `#7f848e` | log levels                                     |
| `logInfo`             | `#61afef`             |                                                |
| `logWarn`             | `#e5c07b`             |                                                |
| `logError`/`logFatal` | `#ff5f5f`             | `FATAL` also bold                              |
| `jsonKey`             | `#61afef`             | Body JSON                                      |
| `jsonString`          | `#98c379`             |                                                |
| `jsonNumber`          | `#d19a66`             |                                                |
| `jsonLiteral`         | `#c678dd`             |                                                |

Adjusting a value by eye during the build is fine; adding a role is fine; colouring by anything other than a role is
not.

## Formatting

Pure functions in `src/model/format.ts`:

| What          | Rule                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duration      | `< 1 ms` → `347µs` · `< 10 ms` → `2.36ms` · `< 100 ms` → `23.5ms` · `< 1 s` → `235ms` · `< 10 s` → `2.35s` · `< 60 s` → `23.5s` · `< 1 h` → `2m 03s` · else `1h 02m`; a running one ends in `…` |
| Offset        | the duration format with a leading `+`                                                                                                                                                          |
| Clock time    | local, `14:03:27.315` in details, `14:03:27` in run labels                                                                                                                                      |
| Run label     | `service · started`, `started` as in [05](05-list-screens.md#runs-screen)                                                                                                                       |
| Counts        | thousands separators with `,`, independent of locale                                                                                                                                            |
| Sizes         | decimal units, one decimal: `812 B`, `12.4 KB`, `3.4 MB`; exact bytes with separators where the text says "bytes"                                                                               |
| Short id      | the first 8 characters; full ids in details and the bad-lines overlay                                                                                                                           |
| Paths         | the last two segments for cause frames, `site` and `def`                                                                                                                                        |
| Empty service | `(unnamed)`, muted                                                                                                                                                                              |

## Editor

Shared by the Trace screen (`e`: source location) and Body (`e`: body file), in `src/editor.ts`:

- The command is `$VISUAL`, else `$EDITOR`, split on spaces (so `code --wait` works).
- Arguments: `--goto <file>:<line>:<col>` when the command's basename is `code`, `cursor` or `codium`; otherwise
  `+<line> <file>` (vi, vim, nvim, nano, emacs, micro, helix and kak accept it), for any other editor too. A body file
  opens without a line.
- A location's `file` is used as written; a relative path (as in the fixture) is resolved against the current
  directory.
- The renderer is suspended (`renderer.suspend()`) while the editor runs in the foreground with inherited stdio, and
  resumed when it exits, whatever its exit code.
- With no editor set: the status message `set $VISUAL or $EDITOR to open files`. Nothing runs.

## Clipboard

`y` on Body writes OSC 52 (`ESC ] 52 ; c ; <base64> BEL`) through the renderer's output, wrapped for tmux passthrough
when `$TMUX` is set. Limit 100 KB of text, as [07-body-viewer.md](07-body-viewer.md#handing-off) says.

## Terminal size

Frames are tested at 120×40 and 80×24. Below 80×24 nothing special happens: layouts keep their rules and clip.
Resizing re-lays out at once (`useTerminalDimensions`).
