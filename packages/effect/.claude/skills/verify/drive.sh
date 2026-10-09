#!/usr/bin/env bash
# Runs one consumer program against the built package and keeps everything it produced as evidence.
#
#   drive.sh <label> <program.ts>
#
# The program is copied into packages/effect/.verify/<stamp>-<label>/ and run there with `node`, so its relative
# paths land in that directory and `@wmaurer/otelscope-effect` resolves to this checkout's dist/ through the
# package's own exports map. Prints the evidence directory on the last line.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: drive.sh <label> <program.ts>" >&2; exit 2; }
label="$1"
program="$(realpath "$2")"
here="$(cd "$(dirname "$0")" && pwd)"
pkg="$(cd "$here/../../.." && pwd)"

"$here/doctor.sh" | tail -1

run="$pkg/.verify/$(date '+%Y%m%d-%H%M%S')-$$-$label"
mkdir -p "$run"
cp "$program" "$run/program.ts"
cd "$run"

set +e
timeout 60 node program.ts >stdout.txt 2>stderr.txt
echo $? >exit.txt
set -e

# Every file the program wrote, with its size and hash, so a later reader needs no rerun.
find . -type f ! -name program.ts ! -name stdout.txt ! -name stderr.txt ! -name exit.txt ! -name files.txt \
    -printf '%P\t%s\n' | sort | while IFS=$'\t' read -r file size; do
    printf '%s\t%s\t%s\n' "$file" "$size" "$(sha256sum "$file" | cut -c1-64)"
done >files.txt

echo "exit:   $(cat exit.txt)"
echo "stderr: $(wc -l <stderr.txt) lines"
echo "files:"
sed 's/^/  /' files.txt
echo "$run"
