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

# BOTH ARTIFACTS ARE CHECKED, so drift in either is a finding. A gate that read
# one of them would report current while the other was stale.
printf 'stale\n' >"$WORK/model-api.ts"
printf 'stale\n' >"$WORK/modelTypes.ts"
set +e
(cd "$ROOT" && node ./scripts/generate-model-api.mjs --check \
	--out-schemas="$WORK/model-api.ts" --out-types="$WORK/modelTypes.ts") >"$OUT" 2>&1
RC=$?
set -e
check "drift is a finding" 1 "$RC" "is stale"

# Drift in the types artifact alone is still drift.
set +e
(cd "$ROOT" && node ./scripts/generate-model-api.mjs \
	--out-schemas="$WORK/model-api.ts" --out-types="$WORK/modelTypes.ts") >"$OUT" 2>&1
printf 'stale\n' >"$WORK/modelTypes.ts"
(cd "$ROOT" && node ./scripts/generate-model-api.mjs --check \
	--out-schemas="$WORK/model-api.ts" --out-types="$WORK/modelTypes.ts") >"$OUT" 2>&1
RC=$?
set -e
check "drift in the types artifact alone is a finding" 1 "$RC" "modelTypes.ts is stale"

# An argument that moved is a could-not-run, never an answer about some other file.
set +e
(cd "$ROOT" && node ./scripts/generate-model-api.mjs --check --out="$WORK/model-api.ts") >"$OUT" 2>&1
RC=$?
set -e
check "an unknown argument exits 2, not 0" 2 "$RC" "is not an argument"

done_ "check-model-api.test.sh"
