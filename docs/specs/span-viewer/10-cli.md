# 10 · CLI

Source: [CLI surface and npm packaging](../../../.wayfinder/span-viewer-tui/tickets/20-cli-surface.md), with the
`--last-runs` amendment from [Performance budgets](../../../.wayfinder/span-viewer-tui/tickets/23-performance-budgets.md).

## Usage

```
otelscope <file> [--no-follow] [--run <id>] [--trace <id>]
otelscope --help | --version
```

- Package `@wmaurer/otelscope`, bin `otelscope`, so `npx @wmaurer/otelscope spans.jsonl` runs it.
- **Parsed with `effect/cli`** (`Command`, `Argument`, `Flag`) in `src/cli/`. Only the `Help` and `Version` built-ins
  are enabled, which drops `--wizard`, `--completions` and `--log-level`. `--version` prints `otelscope 0.1.0` (the
  package version).
- **`<file>`**: one required positional argument. No default path (`JsonlTrace.layer` has none) and no `-` for stdin,
  which would rule out following, the head-hash guard and `bodies/`.
- **`--no-follow`**: read the file once, with no watcher and no Reset handling. The phase reads `read once` when done.
- **`--run <id>`**, **`--trace <id>`**: seed the screen stack ([04-navigation.md](04-navigation.md#seeding-from-the-cli)).
  Each is matched exactly, or as a unique prefix (`--run 2026-10-07T10-01`, `--trace 9f3c`), resolved as snapshots
  arrive. A seeded selection does not follow.
- Not in v1: `--last-runs` (it would still read and decode every line), a run filter flag (`/ key=value` covers it),
  `--filter`. Each can be added later without changing the above.

## Startup sequence

In `main.ts`, before React or OpenTUI is loaded ([02-package.md](02-package.md#srcmaints)):

1. Parse arguments. A usage error (no file, unknown flag, a flag missing its value) prints the usage to stderr and
   exits **2**. `--help` and `--version` print to stdout and exit 0.
2. Resolve `<file>` to an absolute path, then check, in this order, each failing with one line to stderr,
   `otelscope: <message>`, and exit **1**:
    1. the file's directory is missing: `no such directory: <absolute dir>`;
    2. the path is a directory: `is a directory: <absolute path>`;
    3. under `--no-follow`, the file is missing: `no such file: <absolute path>` (without `--no-follow` a missing file
       is waited for, like `tail -F`);
    4. the file exists but cannot be read: `cannot read <absolute path>: <reason>`;
    5. **last**, stdin or stdout is not a TTY: `needs an interactive terminal`. There is no plain-text dump mode.

    The TTY check is last so the file errors stay testable with piped stdio.

3. Build the initial `Nav`, then `import("./app.tsx")` and run it.

A file of 0.2.x records has no CLI special case: the Runs screen shows the legacy notice, and under `--no-follow` it
stays.

## Exit codes

| Code | When                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | quit (`q`, `Ctrl-c`), a signal, `--help`, `--version`                                                         |
| 1    | a startup error above, or a defect at runtime: the renderer is torn down, then the cause is printed to stderr |
| 2    | a usage error                                                                                                 |

A normal quit prints nothing; the alternate screen restores the terminal as it was. The Node version guard in the
bin shim also exits 1 ([02-package.md](02-package.md#the-bin-shim-srcbints)).
