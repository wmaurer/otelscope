# Implementation prompts

One prompt per step of the [order of work](README.md#order-of-work), for the pstack plugin's `poteto-mode`. Run each
in a fresh session (`/clear` between steps). Every prompt ends with the same rules: pstack's playbooks open a PR by
default, and work here is committed on `main`. To review PRs instead, replace "Commit on main, no PR" with
"Open a PR".

## 1. Repo on Node 26

Install Node 26.9 or later first.

```text
Use poteto-mode to do step 1 of the order of work in docs/specs/span-viewer/README.md: move the repo to Node 26
per 02-package.md#repo-changes. Node 26 is installed.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 2. `@wmaurer/otelscope-effect` 0.3.0

This is the biggest single step. If it runs long, split it into two sessions: first the package, then the fixture
generator.

```text
Use poteto-mode to do step 2 of the order of work in docs/specs/span-viewer/README.md: @wmaurer/otelscope-effect
0.3.0 per 01-record-format.md. That covers the Schema, the new fields (including `fiber`), the tracer hook,
the 1 s exportInterval, the @otelscope/source export condition, tests and the README. Then rebuild the fixture
generator's writer from 0.3.0's src pieces, regenerate the sample and add the HUGE scale.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 3. `packages/tui` scaffold

```text
Use poteto-mode to do step 3 of the order of work in docs/specs/span-viewer/README.md: scaffold packages/tui per
02-package.md and 10-cli.md. That covers the package, tsconfig, vitest, the lint override, the bin shim, and
main.ts with the CLI parse and startup checks. The renderer shows an empty frame.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 4. Data layer

```text
Use poteto-mode to do step 4 of the order of work in docs/specs/span-viewer/README.md: the data layer per
03-data-layer.md. That means InputFile, SpanSource, SpanStore and Bodies, then the bridge atoms, all tested
without a renderer.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 5. Navigation and chrome

```text
Use poteto-mode to do step 5 of the order of work in docs/specs/span-viewer/README.md: navigation and chrome per
04-navigation.md and 09-keys-and-chrome.md. That covers Nav, the binding table and dispatch, the status bar,
the help overlay, the bad-lines overlay and the theme.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 6a. Runs and Traces screens

```text
Use poteto-mode to do the first part of step 6 of the order of work in docs/specs/span-viewer/README.md: the Runs
and Traces screens per 05-list-screens.md, with the parts of 08-search.md that apply to them.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 6b. Trace screen

```text
Use poteto-mode to do the second part of step 6 of the order of work in docs/specs/span-viewer/README.md: the
Trace screen per 06-trace-view.md (tree, waterfall, details, logs), with the parts of 08-search.md that apply
to it.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 6c. Body screen

```text
Use poteto-mode to do the last part of step 6 of the order of work in docs/specs/span-viewer/README.md: the Body
screen per 07-body-viewer.md, with the parts of 08-search.md that apply to it.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 7. Golden smoke set, journeys and perf

```text
Use poteto-mode to do step 7 of the order of work in docs/specs/span-viewer/README.md: the golden smoke set,
the journeys and the perf harness per 11-testing.md and 12-performance.md. `perf` must pass on this machine.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 8. READMEs and `AGENTS.md`

```text
Use poteto-mode to do step 8 of the order of work in docs/specs/span-viewer/README.md: the READMEs and AGENTS.md
per 02-package.md#readme-the-npm-page, and the screenshot.
The spec is docs/specs/span-viewer/; it wins over the .wayfinder tickets. Done means `pnpm pre-push` is green.
Commit on main, no PR. Do not publish anything.
```

## 9. Release

Not a prompt: wmaurer publishes. Publish the effect package before the viewer.

```sh
cd packages/effect && pnpm publish   # @wmaurer/otelscope-effect@0.3.0
cd ../tui && pnpm publish            # @wmaurer/otelscope@0.1.0
```
