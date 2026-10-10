# AGENTS.md

Instructions for coding agents working in this repository.

`CLAUDE.md` is a symlink to this file, so both names resolve to the same rules.

## Effect Source and Docs (`node_modules/`)

Effect is the exception to the usual rule of not reading `node_modules/`. Every Effect package ships its TypeScript source in `src/` next to the build output, so the installed copy is the source at exactly the version in the lockfile. Do not clone Effect into `.repos/deps/`, and do not read it on GitHub, where `main` shows APIs this lockfile does not have.

Each Effect package also ships agent documentation, and it is the first place to look:

- `AGENTS.md` (with `CLAUDE.md` beside it) covers how to write Effect code: `Effect.gen` and `Effect.fn`, services with `Context.Service` and `Layer`, tagged errors, `Schema`, resources and scopes, streams, HTTP servers and clients, and testing with `@effect/vitest`. Follow its conventions.
- `ai-docs/src/` holds the runnable examples that `AGENTS.md` links to, one file per topic.
- `src/` is the source itself, for when the question is "what does this actually do".

The packages are not hoisted to the root `node_modules/`. Reach them through a workspace package that depends on them, for example `packages/effect/node_modules/effect/`, `packages/effect/node_modules/@effect/platform-node/` and `packages/effect/node_modules/@effect/vitest/`. They are symlinks into `node_modules/.pnpm/`, and the version in that path tells you which build you are reading.

## Other Dependency Source (`.repos/`)

`.repos/deps/` is for upstream dependencies that do not ship their source, cloned at the exact version used here. `.repos/refs/` is for repositories read as prior art, tracked at branch tip. Entries go in the `deps` and `refs` arrays of `repos.config.js`; `pnpm deps:fetch` and `pnpm refs:fetch` populate them, and `pnpm deps:check` confirms nothing has drifted. `refs` holds the Effect VS Code extension (`.repos/refs/effect-vscode-extension/`) and otel-tui (`.repos/refs/otel-tui/`); `deps` holds OpenTUI (`.repos/deps/opentui/`), pinned to the installed `@opentui/core`. The directory is gitignored.

> **Location:** `.repos/` lives at the root of the **main repository checkout**, never inside a worktree. From a worktree such as `.claude/worktrees/agent-xxx/`, `git rev-parse --show-toplevel` returns the worktree and is the wrong answer. Use `--git-common-dir` instead. It returns the shared `.git` directory that every worktree points at, and the parent of that directory is the main checkout:
>
> ```sh
> "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.repos"
> ```
>
> Keep `--path-format=absolute`. Without it, git answers relative to the current directory. That answer is right where it is evaluated and wrong once the path is stored or passed anywhere else.

## Before You Push

The git `pre-push` hook runs `pnpm pre-push`, which is `fmt:check`, `lint`, `typecheck` and `test`. Run it yourself before you claim work is done. Do not edit `.git/hooks/pre-push`; edit the `pre-push` script in `package.json` instead.

Generated and vendored files carry a "do not edit" banner: everything under `tools/oxlint/`, the five bundles in `scripts/`, `effect-rules.ts`, `correctness-rules.ts` and `tsconfig.effect.json`. They come from `../project-setup` and are replaced wholesale on upgrade. Change the source there, not the copy here.

Commit messages must not carry a `Co-Authored-By` line naming Claude, because the `commit-msg` hook rejects them.

## Effect Package (`packages/effect/`)

`@wmaurer/otelscope-effect` is published to npm. `JsonlTrace.layer` installs Effect's OTLP tracer and appends every exported span to a JSONL file, one `JsonlSpanRecord` per line. `ReceiverClient` answers the tracer's export requests in process, so no collector or network is involved. The layer needs `FileSystem`, `Path` and `Crypto` from the caller, and it must be provided outermost, so the tracer is installed before any other layer is built.

Tracing must never fail the program it observes. The sink's writer never fails: its first write failure prints one warning to stderr and stops further writes. `ReceiverClient` always answers 200, because on any other status the exporter drops its buffer and stops exporting for 60 seconds; a batch that cannot be decoded is reported on stderr and dropped instead. Keep both properties when changing these modules.

`effect` is a peer dependency (`^4`), and a dev dependency pinned to the version tested against. Sources import each other with `.ts` extensions; `tsc -p tsconfig.build.json` rewrites them to `.js` in `dist/`. The package ships `dist/` and `src/`.

To release: bump `version` in `packages/effect/package.json`, commit, and run `pnpm publish` from `packages/effect`. Its `prepublishOnly` script rebuilds `dist/` and runs the tests first. A published version can never be reused, even after an unpublish, so publish only when the user asks. The user's npm account may need a one-time code, so the user may prefer to run the publish themselves. Update `README.md` when the public API or the record format changes, since it is the npm page.

## Viewer Package (`packages/tui/`)

`@wmaurer/otelscope` is the terminal viewer, bin `otelscope`. It reads the JSONL file that `JsonlTrace.layer` writes, follows it while the program runs, and decodes each line with the `JsonlSpanRecord` Schema from `@wmaurer/otelscope-effect/format`. The spec is `docs/specs/span-viewer/`; read the file that covers a part before you change it.

It needs Node >= 26.9. OpenTUI opens its native library through Node's experimental `node:ffi`, which is on by default from 26.9 and missing before 26. `src/bin.ts` checks for `node:ffi` before it imports anything, so it has no top-level imports and uses only syntax that old Node parses. `main.ts`, and every module it imports before `import("./app.tsx")`, is plain `.ts` and must not import `@wmaurer/otelscope-effect`. The spawned CLI tests run `src/bin.ts` under Node's type stripping, with no build and no TSX loader (`docs/specs/span-viewer/11-testing.md`).

`@opentui/core` and `@opentui/react` are pinned to the same exact version, and `react` stays at `~19.2.0`, the version `react-reconciler` 0.33 is built for. To upgrade OpenTUI, bump both packages together, re-pin `.repos/deps/opentui` to the new version (`pnpm deps:check` confirms it), and run the viewer's tests on Node 26. `effect`, `@effect/platform-node`, `@effect/atom-react` and `@effect/vitest` are pinned to one exact version, the same as `packages/effect`'s dev dependency; bump all four together.

The viewer reads `packages/effect`'s `src/` through the `@otelscope/source` export condition, so it typechecks and tests without building that package first. `tsconfig.build.json` drops the condition and compiles against `packages/effect/dist/`, as npm users will.

Keep the layers apart. `data/` never imports React or OpenTUI. `model/`, `nav/`, `keys/` and `query/` are pure: no Effect runtime and no renderer. Only `ui/` and `app.tsx` import React or OpenTUI, and views stay thin: a decision belongs in a pure module with its own test, not in a component. Nothing logs to the console, because OpenTUI captures console output; an error becomes UI state.

To release: bump `version` in `packages/tui/package.json` and commit. Run `pnpm --filter @wmaurer/otelscope perf` on the reference machine; it must pass (`docs/specs/span-viewer/12-performance.md`). Then run `pnpm publish` from `packages/tui`, once `@wmaurer/otelscope-effect` at the version the viewer depends on is published. Its `prepublishOnly` script rebuilds `dist/` and runs the tests first. Publish only when the user asks, as for the effect package. `README.md` is the npm page; `docs/screenshot.png` is a trace view of the sample fixture, left out of `files` and referenced by its `raw.githubusercontent.com` URL.
