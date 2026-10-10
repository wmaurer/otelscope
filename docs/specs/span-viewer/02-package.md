# 02 · Package, runtime and tooling

Sources: [OpenTUI React under Node](../../../.wayfinder/span-viewer-tui/tickets/02-opentui-runtime-and-tooling.md),
[Runtime and Node version policy](../../../.wayfinder/span-viewer-tui/tickets/12-runtime-policy.md),
[Lint rules for React TSX](../../../.wayfinder/span-viewer-tui/tickets/13-tsx-lint-rules.md),
[CLI surface and npm packaging](../../../.wayfinder/span-viewer-tui/tickets/20-cli-surface.md),
[Bridging an Effect data layer](../../../.wayfinder/span-viewer-tui/tickets/04-effect-react-bridge.md).

## Runtime

- **Node >= 26.9 only.** OpenTUI opens its native Zig library through Node's experimental `node:ffi`, which is on by
  default from 26.9 and missing before 26. It does not run on 22 or 24. Node 26 is LTS from 2026-10-28.
- **Bun is not supported or tested.** It gets a different OpenTUI build and platform layer. The README says it
  probably works with `bunx --bun`.
- **Effect owns the process.** `NodeRuntime.runMain` builds the layers, acquires the renderer as a scoped resource,
  renders the root, and waits for quit. React only renders.

## Layout

```
packages/tui/
├── package.json · tsconfig.json · tsconfig.build.json · vitest.config.ts · README.md
├── docs/screenshot.png            not in `files`
├── src/
│   ├── bin.ts                     the shim; no top-level imports
│   ├── main.ts                    CLI parse and startup checks, then import("./app.tsx")
│   ├── app.tsx                    layers, renderer, root component
│   ├── cli/                       Command, startup checks, initial Nav
│   ├── data/                      InputFile, SpanSource, SpanStore, Bodies, Snapshot types, decode, index
│   ├── bridge/                    atoms: snapshot, nav, panes, clock, derived views
│   ├── nav/                       Screen, Nav and its operations
│   ├── keys/                      binding table, dispatch, hints
│   ├── query/                     query parser and matchers
│   ├── model/                     pure view models: rows, tree flattening, waterfall, axis, cause, logs, format
│   ├── ui/                        components (.tsx): screens, panes, windowed list, status bar, overlays, theme
│   ├── editor.ts                  $VISUAL/$EDITOR launch
│   └── clipboard.ts               OSC 52
├── test/
│   ├── support/                   record and snapshot builders
│   └── fixtures/sample/           committed; large/ and huge/ gitignored
└── perf/
    ├── run.ts
    └── startup.ts
```

Files with JSX are `.tsx`; everything else is `.ts`. Nothing outside `ui/` and `app.tsx` imports React or OpenTUI.
`data/` imports neither. `model/`, `nav/`, `keys/` and `query/` are pure: no Effect runtime, no renderer.

## `package.json`

```json
{
    "name": "@wmaurer/otelscope",
    "version": "0.1.0",
    "description": "A terminal viewer for otelscope JSONL span files.",
    "license": "MIT",
    "author": "Wayne Maurer",
    "repository": { "type": "git", "url": "git+https://github.com/wmaurer/otelscope.git", "directory": "packages/tui" },
    "type": "module",
    "bin": { "otelscope": "./dist/bin.js" },
    "exports": { "./package.json": "./package.json" },
    "files": ["dist", "src"],
    "engines": { "node": ">=26.9" },
    "publishConfig": { "access": "public" },
    "scripts": {
        "build": "rm -rf dist tsconfig.build.tsbuildinfo && tsc -p tsconfig.build.json",
        "test": "vitest run",
        "test:watch": "vitest",
        "perf": "pnpm --filter \"@wmaurer/otelscope...\" build && node --expose-gc --conditions=@otelscope/source --import tsx perf/run.ts",
        "prepublishOnly": "pnpm build && pnpm test"
    },
    "dependencies": {
        "@effect/atom-react": "<effect version>",
        "@effect/platform-node": "<effect version>",
        "@opentui/core": "0.5.14",
        "@opentui/react": "0.5.14",
        "@wmaurer/otelscope-effect": "workspace:^",
        "effect": "<effect version>",
        "react": "~19.2.0",
        "scheduler": "^0.27.0"
    },
    "devDependencies": {
        "@effect/vitest": "<effect version>",
        "@types/react": "~19.2.0",
        "vitest": "^5.0.3"
    }
}
```

- `<effect version>` is one exact version for all four Effect packages ([README](README.md#packages-and-pinned-versions)),
  matching `packages/effect`'s dev dependency. Bump them together.
- `workspace:^` publishes as `^0.3.0`. Effect is a normal, exactly pinned dependency because this is an app.
- `scheduler` is listed because `@effect/atom-react` declares it as a peer; `^0.27.0` is what `react-reconciler`
  0.33 uses. If OpenTUI moves to `react-reconciler` 0.34, check the peer range before upgrading.
- **Bin only**: no programmatic API in v1.

### Pins and upgrades

- `@opentui/core` and `@opentui/react` are pinned to the same exact version. An upgrade bumps both, re-pins
  `.repos/deps/opentui` (`pnpm deps:check`) and runs the viewer's tests on Node 26. `node:ffi` is experimental, so
  only our upgrades should change what users get.
- `react` stays at `~19.2.0`, the version `react-reconciler` 0.33 is built for.
- Install bloat (about 68 MB globally, from `react-devtools-core`, `ws` and a `typescript@5` peer pulled in by
  OpenTUI's manifests) has no workaround in v1. Reporting it upstream is wmaurer's call.

## `tsconfig.json` and `tsconfig.build.json`

```jsonc
// tsconfig.json
{
    "extends": "../../tsconfig.effect.json",
    "compilerOptions": {
        "composite": true,
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "lib": ["ES2024"],
        "jsx": "react-jsx",
        "jsxImportSource": "@opentui/react",
        "erasableSyntaxOnly": true,
        "customConditions": ["@otelscope/source"],
        "outDir": "dist",
        "tsBuildInfoFile": "tsconfig.tsbuildinfo",
        "types": ["node"]
    },
    "references": [{ "path": "../effect" }],
    "include": ["src", "test", "perf"]
}
```

```jsonc
// tsconfig.build.json: compiles against packages/effect's dist, as npm users will
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "rootDir": "src",
        "outDir": "dist",
        "tsBuildInfoFile": "tsconfig.build.tsbuildinfo",
        "customConditions": []
    },
    "include": ["src"]
}
```

- Add `{ "path": "packages/tui" }` to the root `tsconfig.json` references.
- `erasableSyntaxOnly` keeps every `.ts` file runnable under Node's type stripping (the spawned CLI tests rely on it).
- Sources import each other with `.ts`/`.tsx` extensions; `rewriteRelativeImportExtensions` (in the base config)
  turns them into `.js` in `dist/`, dynamic `import()` with a literal included.
- **Acceptance for the scaffold step:** on a fresh clone with no `dist/` anywhere, `pnpm install && pnpm pre-push`
  passes, and `pnpm -r build` builds `packages/effect` before `packages/tui`. If the project reference and the source
  condition fight in `pnpm typecheck` (TS6307 on effect's sources), keep the condition for vitest and Node and fix
  the reference; the workspace must not need a build to typecheck.

## `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { conditions: ["@otelscope/source"] },
    test: {
        include: ["test/**/*.test.{ts,tsx}"],
        globals: false,
    },
});
```

Every test file imports `describe`, `it` and `expect` from `@effect/vitest` (see [11-testing.md](11-testing.md)).

## The bin shim (`src/bin.ts`)

Compiles to `dist/bin.js` with `#!/usr/bin/env node`. It has no top-level imports, and its syntax parses on old Node,
so the guard can speak before anything fails. In order:

1. **Guard.** Under Bun (`process.versions.bun`) skip. Otherwise, if `process.getBuiltinModule?.("node:ffi")` is
   missing, print one line to stderr and exit 1:
   `otelscope needs Node >= 26.9 (found v24.14.0). On Node 26.1–26.8, run it with --experimental-ffi.`
2. **musl.** On Linux with `OPENTUI_LIBC` unset, if `process.report.getReport().header.glibcVersionRuntime` is
   undefined, set `process.env.OPENTUI_LIBC = "musl"`.
3. **Warning.** Replace Node's default `warning` listener with one that drops only the `ExperimentalWarning` about FFI
   and prints every other warning as Node would. No `--disable-warning`.
4. **React's production build.** If `NODE_ENV` is unset, set it to `production`. React picks its build from it when
   it is first loaded, and the development build records a `performance.measure`, with a diff of the props, for every
   component render. Node keeps every measure: on the Traces screen, following `huge` while 5,000 spans/s arrived grew
   the heap by 15 to 20 MB per publish and reached Node's 4 GB heap limit after about a minute.
5. **Compile cache.** `module.enableCompileCache()` (through `process.getBuiltinModule("node:module")`).
6. **Start.** `await import("./main.ts")`, so nothing loads before the guard has passed.

## `src/main.ts`

1. Parse arguments with `effect/cli` and run the startup checks ([10-cli.md](10-cli.md)), with no React or OpenTUI
   loaded. Usage errors exit 2, startup errors exit 1, each before the terminal is touched.
2. Build the initial `Nav` from the arguments ([04-navigation.md](04-navigation.md#seeding-from-the-cli)).
3. `await import("./app.tsx")` and run it with the parsed arguments and the initial `Nav`.

`main.ts` and the modules it imports before step 3 are `.ts` and must not import `@wmaurer/otelscope-effect` (see
[11-testing.md](11-testing.md#cli) for why it matters to the spawned tests).

## `src/app.tsx`

Runs under `NodeRuntime.runMain`:

- Layers: `NodeServices.layer`, `InputFile`, `SpanSource`, `SpanStore`, `Bodies`, and a layer that builds the atom
  registry ([03-data-layer.md](03-data-layer.md#bridge)).
- The renderer is `Effect.acquireRelease(createCliRenderer({ exitOnCtrlC: false, exitSignals: [], ... }),
  (r) => r.destroy())`. The terminal uses the alternate screen and mouse tracking. `exitSignals: []` stops OpenTUI
  from registering its own signal handlers, which would destroy the renderer behind Effect's back.
- It renders `<RegistryContext.Provider value={registry}><App /></RegistryContext.Provider>` and waits on a quit
  `Deferred`. Quit (`q`, `Ctrl-c`) completes it; the program then returns, the scope closes the tail, the layers and
  the renderer, and the terminal is restored.
- **Signals.** `runMain` handles SIGINT and SIGTERM by interrupting the main fiber, which closes the same scope. The
  app adds a SIGHUP listener (removed by a finalizer) that completes the quit `Deferred`. `runMain` gets a `teardown`
  that maps an interrupt-only exit to code **0** (Effect's default maps it to 130) and otherwise defers to
  `Runtime.defaultTeardown`.
- A defect at runtime tears the renderer down first, then prints the cause to stderr and exits 1.
- OpenTUI captures `console` output and unhandled rejections, so no code may log to the console; errors become UI
  state.

## Build

**`tsc` output, not a bundle**, the same as `packages/effect`: `tsc -p tsconfig.build.json` into `dist/`, and the package
ships `dist/` and `src/`. npm and pnpm already install a single React copy, and `@opentui/core` must stay external (a
dynamic `import()` of its native package, tree-sitter assets, top-level await), so a bundle would save little. If a
startup budget is missed because Node loads Effect as hundreds of modules, bundling is the pre-approved remedy in
[12-performance.md](12-performance.md#remedies-approved-in-advance).

## Lint

One `overrides` entry in the root `oxlint.config.ts` (no "do not edit" banner there; project rules are folded in by
hand on upgrade):

```ts
{
    // The react plugin turns on 31 rules at "warn" (fatal under --max-warnings=0). They stay unpinned:
    // correctness-rules.ts pins only what the root plugins turn on, and `pnpm lint:sync` reports this scope.
    files: ["packages/tui/**"],
    plugins: ["react"],
    rules: {
        "react/rules-of-hooks": "error",
    },
}
```

- `plugins: ["react"]` alone: an override's plugins union with the base five, and restating them leaves every React
  rule silently off.
- No `jsx-a11y`. The glob is the whole package, because custom hooks live in `.ts` files too.
- `effect-native/native-array-method` stays on: views map with Effect's `Array.map(rows, (row) => <… key={row.id} />)`.
  `react/jsx-key` misses a missing key in that data-first form; React's dev warning is the backstop.
- No exceptions up front. `effecttsgo/global-timers` stays on in views: timing belongs to the data layer and the
  injected clock. A deliberate exception gets an `oxlint-disable-next-line` comment with a reason.

## Repo changes

- **`.nvmrc`** at the root containing `26`. No mise.
- **Root `package.json`** `engines.node` goes from `>=22.18` to `>=26.9`. The root is private, so this binds only
  development.
- **`.npmrc`** at the root with `engine-strict=true`, so `pnpm install` on older Node fails.
- **`packages/effect`** gets its own `"engines": { "node": ">=22.18" }`. Nothing tests it on 22 or 24 any more; that
  risk is accepted (it uses only `FileSystem`, `Path` and the OTLP exporter).
- **`.gitignore`** gains `packages/tui/test/fixtures/huge/` next to `large/`.
- `pnpm pre-push` is unchanged and runs every package on 26. A shell that skipped `nvm use` fails it, because the
  viewer's tests throw OpenTUI's "native FFI is not available". No extra check.
- The repo has no CI. One added later reads the Node version from `.nvmrc`.

## `AGENTS.md`

Add a `## Viewer Package (packages/tui/)` section in the same style as the effect package's:

- what it is (`@wmaurer/otelscope`, bin `otelscope`, reads the JSONL file `JsonlTrace.layer` writes);
- Node >= 26.9 and why; OpenTUI pinned exactly, with the upgrade steps above;
- the layer rules: `data/` never imports React or OpenTUI; views stay thin and decisions live in pure modules;
  nothing logs to the console;
- to release: bump `version`, commit, run `pnpm --filter @wmaurer/otelscope perf` on the reference machine (it must
  pass, see [12-performance.md](12-performance.md)), then `pnpm publish` from `packages/tui`, after
  `@wmaurer/otelscope-effect` at the version it depends on is published. Publish only when the user asks.

## README (the npm page)

`packages/tui/README.md`, in this order:

1. One-line pitch and the screenshot, referenced by an absolute
   `https://raw.githubusercontent.com/wmaurer/otelscope/main/packages/tui/docs/screenshot.png` URL. The screenshot is
   a trace view of the sample fixture, taken by hand in a real terminal.
2. Requirements: Node >= 26.9; probably works with `bunx --bun`; about 68 MB installed globally; sized for about
   250k spans, larger files load slower.
3. Usage: `npx @wmaurer/otelscope <file>`, the flag table, and a pointer to `@wmaurer/otelscope-effect` for writing
   the file (it must be >= 0.3).
4. The screens in brief (runs → traces → trace, body viewer) and the `/` query syntax.
5. Keys: the essentials and "press `?` for the full list on each screen".
6. Environment: `OPENTUI_LIBC` as an override, `$VISUAL`/`$EDITOR` for `e`, OSC 52 for `y` (tmux needs
   `set-clipboard on`).
7. Exit codes.
