# Bodies

With `bodies: true`, every attribute whose key ends in `.body` leaves the record. Its text goes to
`bodies/<sha256>.txt` next to the JSONL file, and the record keeps `<prefix>.sha256`, `<prefix>.bytes` and
`<prefix>.preview` instead. Identical bodies are stored once, and a body over 1,000,000 characters is truncated
before it is stored.

## Sub-features

- `bodies-offload` replaces `<prefix>.body` with the three attributes and writes the text file.
- `bodies-dedupe` stores an identical body once, even when several spans carry it.
- `bodies-cap` truncates a body over 1,000,000 characters; `sha256` addresses the stored text, `bytes` measures
  the full text.
- `bodies-off` leaves `.body` attributes inline without `bodies: true`.

## How to get to it (user POV)

- Pass `bodies: true` to `JsonlTrace.layer`, and name an attribute with a `.body` suffix, such as
  `llm.request.body`.

## Driving it with drive.sh

Preconditions:

- `$V/doctor.sh` prints `doctor: OK`.

- **Write spans with bodies.** Run `$V/drive.sh bodies $V/programs/bodies.ts`. `exit.txt` is `0`, `stderr.txt`
  is empty, and `files.txt` lists `out/spans.jsonl` and exactly two files in `out/bodies/`: one of 470 bytes
  and one of 1000023 bytes. Each file's name equals its sha256 column.
- **Check the attribute triple.** Run
  `jq -c '{name, attrs: (.attrs | with_entries(.value |= (tostring | .[0:40])))}' <run>/out/spans.jsonl`.
  `ask` and `ask-again` both carry the same `llm.request.sha256`, `llm.request.bytes` `470` and a preview
  starting `Summarise the order history`; no record has a key ending in `.body`; `llm.model` stays `m1`.
- **Check the cap.** `upload` has `http.request.bytes` `1200000`, and its `http.request.sha256` names the
  1000023-byte file. Run `tail -c 40 <run>/out/bodies/<that sha>.txt`. It ends with
  `truncated 200000 chars`.
- **Bodies off.** Copy `programs/bodies.ts`, drop `bodies: true` and the `upload` span, and drive it. No
  `bodies/` directory is created, and `ask` carries `llm.request.body` inline.

## Gotchas

- `preview` is the first 200 characters of the full text. Compare it to the program's input, not to the file.
- `bodies/` is created next to the JSONL file, not in the working directory.
- `jq`'s `tostring` in the recipe above turns `bytes` into a string; in the file it is a number.
- Dedupe holds across runs that share a file too. `programs/midrun.ts` stores one body file for six spans in
  two runs.
