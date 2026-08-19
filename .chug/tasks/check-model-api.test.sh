#!/bin/sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"

OUT="$WORK/out"
set +e
(cd "$ROOT" && "$HERE/check-model-api.sh") >"$OUT" 2>&1
RC=$?
set -e
check "generated API is current" 0 "$RC" "generated API is current"

printf 'stale\n' >"$WORK/model-api.ts"
set +e
(cd "$ROOT" && node ./scripts/generate-model-api.mjs --check --out="$WORK/model-api.ts") >"$OUT" 2>&1
RC=$?
set -e
check "drift is a finding" 1 "$RC" "is stale"

done_ "check-model-api.test.sh"
