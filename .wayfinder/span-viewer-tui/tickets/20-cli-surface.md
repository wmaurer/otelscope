---
id: "20"
title: CLI surface and npm packaging
labels: [wayfinder:grilling]
status: closed
assignee: wmaurer
blocked_by: [15, 18]
---

## Question

What does the published command look like? The runtime, bin shim and build are settled in "Runtime and Node
version policy for packages/tui". Decide:

- the npm package name and the bin name;
- arguments and flags: the file, a run filter, `--no-follow`, `--last-runs`, `--run`/`--trace` to seed the
  screen stack, `--version`, `--help`;
- what happens with no file, a missing file, or a file of 0.2.x records;
- exit codes and what is printed on exit;
- the README that becomes the npm page.

**Amended by** [Live-tail UX](18-live-tail-ux.md): without following, the status bar's phase reads `read once`; a seeded
`--run` or `--trace` selection does not follow.

## Resolution

2026-10-09, grilled with wmaurer.

### Name

- **Package `@wmaurer/otelscope`, bin `otelscope`**, next to `@wmaurer/otelscope-effect`. With a single bin,
  `npx @wmaurer/otelscope spans.jsonl` runs it. The unscoped name is not claimed.
- **Bin only.** `exports` exposes only `./package.json`; there is no programmatic API in v1. The package still
  ships `dist/` and `src/`, as "Runtime and Node version policy for packages/tui" settled.

### Arguments

```
otelscope <file> [--no-follow] [--run <id>] [--trace <id>]
otelscope --help | --version
```

- **Parsed with `effect/cli`** (`Command`, `Argument`, `Flag`). `CliConfig.layer({ builtIns: [Help, Version] })`
  drops `--wizard`, `--completions` and `--log-level`. `--version` prints `otelscope 0.1.0`.
- **`<file>` is one required positional argument.** There is no default path, because `JsonlTrace.layer` has
  none, and no `-` for stdin, which would rule out following, the head-hash guard and `bodies/`. With no file,
  the usage message goes to stderr and the exit code is 2.
- **`--no-follow`** reads the file once, with no watcher and no Reset handling. The status bar's phase reads
  `read once`.
- **`--run <id>` and `--trace <id>`** seed the screen stack, as "Route tree and URL state" settled: `--run R`
  gives `[Runs, Traces R]`, `--trace X` gives `[Runs, Trace X]`, and both together give
  `[Runs, Traces R, Trace X via R]`. A seeded selection does not follow ("Live-tail UX").
- **An id is matched exactly, or as a unique prefix**, so `--run 2026-10-07T10-01` and `--trace 9f3c` work.
  Until the id matches exactly one run or trace, the seeded screen shows the existing placeholder ("Loading…
  looking for trace 9f3c…", then "not in the file"), plus a new one, "9f3c matches 3 traces", when it is
  ambiguous. On the first snapshot where it matches exactly one, the screen's id is rewritten to the full id
  once, and it is never re-resolved.
- **Not in v1:** `--last-runs` (the "Performance limits" fog can add it), a separate run filter (`/` with
  `key=value` covers it) and a `--filter` that seeds the `/` query. Each can be added later without changing
  the above.

### Errors and exit

Every startup error goes to stderr as one line, `otelscope: <message>`, before the renderer takes the
terminal, and exits 1:

- a missing file under `--no-follow` (`no such file: <absolute path>`); without `--no-follow` a missing file
  is waited for, as the data layer settled;
- a missing directory, as the data layer settled;
- a path that is a directory, or a file that cannot be read;
- stdout or stdin not a TTY (`needs an interactive terminal`). There is no plain-text dump mode.

A file of 0.2.x records has no CLI special case. The data layer's full-screen notice shows, and under
`--no-follow` it stays.

| Code | When                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | quit (`q`, `Ctrl-c`)                                                                                          |
| 1    | a startup error above, or a defect at runtime: the renderer is torn down, then the cause is printed to stderr |
| 2    | a usage error (no file, unknown flag)                                                                         |

A normal quit prints nothing; the alternate screen restores the terminal as it was.

### Versions and release

- **Independent versions**, starting at `0.1.0`. `@wmaurer/otelscope-effect` `^0.3.0` (for the record Schema)
  and `effect`, pinned exactly, are normal dependencies, since this is an app. The legacy notice names the
  writer's version, so users never match version numbers.
- **Release order:** `@wmaurer/otelscope-effect@0.3.0` first, then `@wmaurer/otelscope@0.1.0`.
- **`AGENTS.md`** gains a `packages/tui` section with the same release steps as the effect package, including a
  `prepublishOnly` that rebuilds `dist/` and runs the tests.

### README (the npm page)

1. One-line pitch and a screenshot.
2. Requirements: Node >= 26.9; probably works with `bunx --bun`; about 68 MB installed globally; sized for
   about 250k spans.
3. Usage: `npx @wmaurer/otelscope <file>`, the flag table, and a pointer to `@wmaurer/otelscope-effect` for
   writing the file.
4. The screens in brief (runs → traces → trace, body viewer) and the `/` query syntax.
5. Keys: a short table of essentials and "press `?` for the full list on each screen", not the whole binding
   table, which would drift.
6. Environment: `OPENTUI_LIBC` as an override, `$EDITOR` for `e`, OSC 52 for `y` (tmux needs
   `set-clipboard on`).
7. Exit codes.

The screenshot is `packages/tui/docs/screenshot.png`, a trace view of the sample fixture taken by hand in a
real terminal, referenced by an absolute `raw.githubusercontent.com/wmaurer/otelscope/main/...` URL and left
out of `files`. `packages/effect/README.md` gains a "View the file" line:
`npx @wmaurer/otelscope traces/spans.jsonl`.
