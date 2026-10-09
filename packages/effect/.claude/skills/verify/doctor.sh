#!/usr/bin/env bash
# Read-only: is this checkout worth driving? Exits non-zero on the first problem.
set -euo pipefail

pkg="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$pkg"

fail() { echo "doctor: FAIL: $*" >&2; exit 1; }

node_version="$(node --version)"
[[ "$(node -p 'process.features.typescript')" =~ ^(strip|transform)$ ]] || fail "node $node_version cannot run .ts files natively; use the version in .nvmrc"
echo "node:     $node_version"
echo "package:  $(node -p 'require("./package.json").name + "@" + require("./package.json").version')"

[[ -f dist/index.js && -f dist/format/index.js ]] || fail "dist/ is missing; run: pnpm --dir $pkg build"
stale="$(find src -name '*.ts' -newer dist/index.js | head -5)"
[[ -z "$stale" ]] || fail "dist/ is older than: $stale; run: pnpm --dir $pkg build"
echo "dist:     built $(date -r dist/index.js '+%F %T'), newer than every src file"

main="$(node --input-type=module -e "console.log(import.meta.resolve('@wmaurer/otelscope-effect'))")"
format="$(node --input-type=module -e "console.log(import.meta.resolve('@wmaurer/otelscope-effect/format'))")"
[[ "$main" == "file://$pkg/dist/index.js" ]] || fail "package name resolves to $main, not this checkout's dist/"
[[ "$format" == "file://$pkg/dist/format/index.js" ]] || fail "/format resolves to $format, not this checkout's dist/"
echo "resolves: $main"
echo "          $format"
echo "evidence: $pkg/.verify/ (drive.sh creates it)"
echo "doctor: OK"
