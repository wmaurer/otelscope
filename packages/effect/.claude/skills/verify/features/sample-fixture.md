# Sample fixture

`scripts/sample-fixture.ts` traces four seeded Effect programs under virtual time and writes the span-viewer
fixture: `packages/tui/test/fixtures/sample/` (committed, byte-stable) and `packages/tui/test/fixtures/large/`
(gitignored). Its user is a span-viewer developer who needs the same fixture on every regeneration.

## Sub-features

- `fixture-stable` regenerates `sample/` byte for byte when the record format has not changed.
- `fixture-summary` prints the span, trace, event and body counts it wrote.
- `fixture-large` writes the gitignored `large/` variant.

## How to get to it (user POV)

- From the repo root: `pnpm exec tsx packages/effect/scripts/sample-fixture.ts [sample|large]`. With no
  argument, both variants are rewritten.

## Driving it with the shell

Preconditions:

- `git status --porcelain packages/tui/test/fixtures/sample` is empty, so any diff afterwards is the
  generator's.
- No other agent is running the generator. It rewrites tracked files in place and cannot be isolated.

- **Regenerate the sample.** From the repo root, run
  `mkdir -p packages/effect/.verify && pnpm exec tsx packages/effect/scripts/sample-fixture.ts sample 2>&1 | tee packages/effect/.verify/fixture-$(date +%Y%m%d-%H%M%S).txt`.
  It prints
  `sample: 511 spans, 10 traces, 57 events, 8 bodies, 0.2 MB of JSONL in packages/tui/test/fixtures/sample`
  and exits `0` in about a second.
- **Check stability.** Run `git status --porcelain packages/tui/test/fixtures/sample`. Output is empty. After
  an intentional format change, `git diff --stat packages/tui/test/fixtures/sample` instead shows the
  expected change and nothing else, and the diff is committed with it.
- **Large variant.** Run `pnpm exec tsx packages/effect/scripts/sample-fixture.ts large`. It writes
  `packages/tui/test/fixtures/large/`, which `git status` does not show.

## Gotchas

- The generator writes through its own layer, `scripts/fixture/FixtureWriter.ts`, not through
  `JsonlTrace.layer`. It is built from `toRecord`, `slimSpan`, `spansOf`, `ReceiverClient` and `withSites` in
  `src/`, so a change to the record or the tracer hook reaches the fixture. A change to `JsonlSink.ts` or
  `JsonlTrace.ts` does not, because the fixture needs its own exporter settings, normalisation and write hold.
- Fiber ids are renumbered in order of first appearance, across `fiber`, `effect.fiberId` and `fiber #n` in
  text, so `fiber` equals `effect.fiberId` on a span's own logs in the fixture too.
- It deletes and rewrites the whole variant directory. Uncommitted edits under `sample/` are lost.
- Counts in this recipe hold for the current scenarios. When `scripts/fixture/scenarios.ts` changes, update
  them here.
