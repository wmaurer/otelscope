# @wmaurer/otelscope-effect verification map

This directory is the maintained source for verifying what a user of `@wmaurer/otelscope-effect` sees. Read
this index, then use the matching feature file as the recipe. Paths are relative to `packages/effect/`, and
`V=.claude/skills/verify`.

## Baseline preconditions

- `pnpm build` has run since the last edit to `src/`.
- `$V/doctor.sh` prints `doctor: OK`.
- Every drive goes through `$V/drive.sh`, which gives it a fresh directory under `.verify/`.

## Driving conventions

- Import the package by name: `@wmaurer/otelscope-effect` or `@wmaurer/otelscope-effect/format`.
- Pass an explicit `runId` when the proof compares runs; the default is a timestamp.
- Read results from the run directory with `jq` and `cat`; quote the run directory with every claim.

## Proof and skip reporting

- A proof names the run directory and quotes the records, stderr and exit code that show the claim.
- Exit code `0` alone is never proof; tracing failures are designed not to change it.
- For bodies, prove both the attribute triple in the record and the file in `bodies/`.
- Report an entry point you could not drive with the command you ran and what was missing. Do not report it as
  verified through a different entry point.

## Features

- [Span capture](./span-capture.md): `JsonlTrace.layer` writes one record per span, with runs, parents, logs as
  events and all three exits.
- [Bodies](./bodies.md): `bodies: true` moves `.body` attributes to `bodies/<sha256>.txt`, deduplicates and caps
  them.
- [Failure behaviour](./failure-behaviour.md): an unwritable file yields one stderr warning and an unchanged
  program result.
- [Format entry](./format-entry.md): a reader that imports only `/format` can parse the file and resolve bodies.
- [Sample fixture](./sample-fixture.md): the generator rewrites the committed span-viewer fixture byte for byte.
