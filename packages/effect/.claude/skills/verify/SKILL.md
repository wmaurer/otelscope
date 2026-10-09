---
name: verify
description: Prove a change to @wmaurer/otelscope-effect works the way a consumer sees it. Builds dist/, runs a small Effect program that imports the package by its published name, and keeps the JSONL, bodies/, stdout, stderr and exit code as evidence. Use after changing anything in packages/effect (src, record format, bodies, failure handling, the fixture generator), before claiming it works.
---

# Verify @wmaurer/otelscope-effect

The user-facing surface of this repo today is a library: `@wmaurer/otelscope-effect` on npm. A user adds
`JsonlTrace.layer` to an Effect program, runs it, and reads the JSONL file it leaves behind. Proof means doing
exactly that against this checkout's build, then reading the file. Unit tests (`pnpm test`) are not proof; they
import `src/` directly and never touch the exports map or `dist/`.

There is no server, port or long-lived process. Each drive is one `node` process that exits on its own.

Other surfaces:

- `packages/effect/scripts/sample-fixture.ts` writes the committed span-viewer fixture. See
  [features/sample-fixture.md](features/sample-fixture.md).
- The span-viewer TUI (`packages/tui`, specified in `docs/specs/span-viewer/`) is not built yet. When it lands it
  needs its own verify skill in `packages/tui/.claude/skills/verify/`, driven through tmux. Do not stretch this
  one to cover it.

All paths below are relative to `packages/effect/`. `V=.claude/skills/verify`.

## Launch

```sh
pnpm build            # rm -rf dist tsconfig.build.tsbuildinfo && tsc -p tsconfig.build.json
```

Ready when `$V/doctor.sh` prints `doctor: OK`. Rebuild after every edit to `src/`; the doctor refuses a stale
`dist/`.

Teardown: nothing to stop. `dist/` is gitignored build output and stays.

## Doctor

```sh
$V/doctor.sh
```

Read-only. Checks that `node` runs `.ts` files natively (Node 26 per `.nvmrc`), prints the package version,
fails if `dist/` is missing or older than any `src/*.ts`, and confirms that `@wmaurer/otelscope-effect` and
`@wmaurer/otelscope-effect/format` resolve to this checkout's `dist/`. Run it first whenever a result looks off.

## Drive

```sh
$V/drive.sh <label> <program.ts>
```

It runs the doctor, copies the program into `.verify/<stamp>-<pid>-<label>/`, runs `node program.ts` there
with a 60 s timeout, and records:

| File         | Content                                                          |
| ------------ | ---------------------------------------------------------------- |
| `program.ts` | The exact program that ran                                       |
| `stdout.txt` | Its stdout (Effect's console logger lines, the program's prints) |
| `stderr.txt` | Its stderr (every `otelscope:` warning lands here)               |
| `exit.txt`   | Exit code; `124` means the timeout hit                           |
| `files.txt`  | Every file the program wrote: path, bytes, sha256                |
| `out/`       | The JSONL file and `bodies/`, by the programs' convention        |

The last line of output is the run directory. Relative paths in the program resolve inside it, so runs never
share files and any number can run side by side.

The program imports the package by name, so resolution goes through `package.json` `exports` into `dist/`,
exactly as an installed copy would. `effect` and `@effect/platform-node` come from the package's dev
dependencies. Write a new program when a change needs one; start from the closest file in `programs/`:

| Program                   | What it does                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `programs/capture.ts`     | Two runs (`verify-a`, `verify-b`) into one file; nested spans, logs, all exits; `DEFAULT_RUN_ID=1`, `CAPTURE_SEED` |
| `programs/bodies.ts`      | `bodies: true`; a body, the same body again, one over the 1,000,000-char cap                                       |
| `programs/unwritable.ts`  | JSONL path under a regular file; the program must still finish                                                     |
| `programs/midrun.ts`      | Three runs share a file; it turns read-only before the third                                                       |
| `programs/read-format.ts` | Reads a JSONL file through `/format` only; set `OTELSCOPE_FILE` (absolute)                                         |

Inspect output with `jq`, for example:

```sh
jq -c '{run, name, parent, exit, attrs, ev: [.events[].name]}' .verify/<run>/out/spans.jsonl
```

Feature recipes, with the exact expected results, are in [features/README.md](features/README.md).

## Evidence

A proof is the run directory, quoted by path, plus the lines from it that show the claim. Standards:

- Drive through the published entry points (`@wmaurer/otelscope-effect`, `/format`), never a relative import of
  `src/` or `dist/`. A program that bypasses the exports map proves nothing about what users get.
- Show the action and its result: the program, the JSONL records, and stderr. A clean exit alone proves nothing;
  the failure behaviour exists precisely so that tracing problems do not change the exit code.
- Check side effects on disk, not just stdout: `files.txt` lists every file written, and `bodies/<sha>.txt` must
  exist for every `*.sha256` attribute.
- No mocks. `ReceiverClient` already keeps everything in process; nothing reaches the network.
- After a record-format change, also run `pnpm exec tsx packages/effect/scripts/sample-fixture.ts sample` from
  the repo root and report the `git diff --stat` it causes (see the sample-fixture feature).

## Cleanup

Nothing runs after a drive exits, so there is no instance to kill. A drive that hit the timeout was killed by
`timeout`; confirm with `exit.txt` = `124`.

Evidence stays: `packages/effect/.verify/` is gitignored and is never removed by this skill. Delete old run
directories only when the user asks.

Only the sample-fixture feature touches tracked files. If it was run as a check and the change was not meant to
alter the fixture, restore it with `git checkout -- packages/tui/test/fixtures/sample` and delete the gitignored
`packages/tui/test/fixtures/large/` if it was generated.

## Helpers

- `doctor.sh`: `$V/doctor.sh`. Read-only readiness check, exits non-zero with the fix on failure.
- `drive.sh`: `$V/drive.sh <label> <program.ts>`. Runs one program and keeps its evidence. Environment variables
  pass through to the program.
