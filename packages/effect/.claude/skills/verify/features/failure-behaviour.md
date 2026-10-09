# Failure behaviour

Tracing never fails the program it observes. If the JSONL file or a body cannot be written, the first failure
prints one `otelscope:` warning to stderr and all further writes stop. The program runs to completion with the
result it would have had untraced.

## Sub-features

- `fail-one-warning` prints exactly one warning, however many spans follow.
- `fail-program-unaffected` leaves the program's output and exit code unchanged.
- `fail-no-partial-files` writes nothing to the unwritable location.

## How to get to it (user POV)

- Point `file` at a path that cannot be created: under a regular file, in a read-only directory, or on a full
  disk.

## Driving it with drive.sh

Preconditions:

- `$V/doctor.sh` prints `doctor: OK`.

- **Trace into an impossible path.** Run `$V/drive.sh unwritable $V/programs/unwritable.ts`. `exit.txt` is
  `0`, stdout shows `step 1`, `step 2`, `step 3` and then `program finished`.
- **Check the warning.** `stderr.txt` is exactly one line:
  `otelscope: stopped writing blocker/out/spans.jsonl: BadResource: FileSystem.makeDirectory (blocker/out)`.
- **Check the disk.** `files.txt` lists only `blocker`, the 16-byte file the program made itself.
- **Fail after writing has started.** Run `$V/drive.sh midrun $V/programs/midrun.ts`. `exit.txt` is `0`, stdout
  ends `program finished`, and `stderr.txt` is exactly one line:
  `otelscope: stopped writing out/spans.jsonl: PermissionDenied: FileSystem.writeFile (out/spans.jsonl)`.
  `out/spans.jsonl` holds six records, runs `first` and `second` only; the earlier lines survive the failure.

## Gotchas

- In `unwritable.ts` the warning comes from opening the sink, before any span exists. `midrun.ts` is the
  recipe for a failure while spans are being written.
- Running as root ignores read-only permissions, so `midrun.ts` exits without a warning. Use the regular-file
  blocker instead.
- `could not decode a batch of spans` is the other stderr warning. Effect's own exporter never sends an
  undecodable batch, so it is not reachable from a user program; `test/ReceiverClient.test.ts` covers it.
