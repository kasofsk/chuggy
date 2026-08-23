#!/bin/sh
# The module graph points inward, and `src/domain/` reaches nothing outside
# itself by any path through it.
#
# The console is cruised beside them: `ui/` reaches nothing outside itself, so
# what a browser is served needs no build step and no client dependency, and
# `ui/app/` reaches no document.
#
# This is house rule 2's graph half; `eslint.config.js` holds the ambient half.
# What no per-file check can see is reachability — a helper inside the domain
# that imports a filesystem module names no forbidden global, and the decider
# that calls it imports nothing forbidden either. The rules are in
# `.dependency-cruiser.cjs`, beside the layer table they encode.
#
# THE WRAPPER IS WHAT SPLITS THE EXIT CODES. dependency-cruiser exits non-zero
# both on a violation and when it cannot resolve a module; the tool run
# unwrapped would report those as one answer.
#
# WHAT IT CANNOT SEE. A capability reached without an import — a global, a
# dynamic `import()` built from a computed string, a value injected at run time
# — is invisible to a static graph. The first is eslint's half; the second is
# not written here and would be a finding on sight; the third is what the ports
# exist to make legible, and the reviewer's.
#
# Usage:
#   .chug/tasks/check-boundaries.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-boundaries: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if [ ! -f .dependency-cruiser.cjs ]; then
	echo "check-boundaries: LINTER ERROR — no .dependency-cruiser.cjs; there are no rules to apply"
	exit 2
fi

# The local binary wins over anything on PATH: a verdict that depends on which
# version happens to be installed is not a verdict.
if [ -x ./node_modules/.bin/depcruise ]; then
	DEPCRUISE=./node_modules/.bin/depcruise
elif command -v depcruise >/dev/null 2>&1; then
	DEPCRUISE=depcruise
else
	echo "check-boundaries: LINTER ERROR — no depcruise found. Install with \`npm ci\`."
	exit 2
fi

# An empty tree is a could-not-run: the gate would print a clean verdict having
# asked nothing.
sources="$(git ls-files 'src/*.ts' 'src/**/*.ts' 2>/dev/null || true)"
if [ -z "$sources" ]; then
	echo "check-boundaries: LINTER ERROR — no tracked src/*.ts; the graph would be empty"
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

set +e
# `ui` is named only when the tree has one: depcruise fails on a root that
# does not exist, and that would be a could-not-run rather than a verdict.
roots="src test"
[ -d ui ] && roots="$roots ui"
# shellcheck disable=SC2086 # the root list is space-separated by construction
"$DEPCRUISE" --config .dependency-cruiser.cjs --output-type err $roots >"$work/out" 2>"$work/err"
rc=$?
set -e

# Violations land on stdout and the tool's own failures on stderr, so a
# non-zero exit with nothing on stdout is the tool failing to run.
if [ "$rc" -ne 0 ] && [ ! -s "$work/out" ]; then
	echo "check-boundaries: LINTER ERROR — depcruise could not complete (rc=$rc)"
	sed 's/^/    /' "$work/err"
	exit 2
fi

if [ "$rc" -ne 0 ]; then
	cat "$work/out"
	echo "check-boundaries: the module graph violates a rule above"
	exit 1
fi

cruised="$(awk '{ gsub(/\033\[[0-9;]*m/, "") }
/ modules,/ {
	if (match($0, /[0-9]+ modules/)) {
		token = substr($0, RSTART, RLENGTH)
		sub(/ modules/, "", token)
		print token
		exit
	}
}' "$work/out")"
echo "check-boundaries: graph clean across ${cruised:-?} module(s)"
