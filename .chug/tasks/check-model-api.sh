#!/bin/sh
# The generated model API is checked in so changes to Quint declarations are
# reviewed as TypeScript/schema/codec diffs, never discovered at runtime.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-model-api: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if [ ! -x ./node_modules/.bin/quint ]; then
	echo "check-model-api: LINTER ERROR — no local pinned Quint. Install with \`npm ci\`." >&2
	exit 2
fi

set +e
node ./scripts/generate-model-api.mjs --check
rc=$?
set -e
if [ "$rc" -eq 1 ]; then exit 1; fi
if [ "$rc" -ne 0 ]; then exit 2; fi

echo "check-model-api: generated API is current"
