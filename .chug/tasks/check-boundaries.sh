#!/bin/sh
# The module graph points inward, and `src/domain/` reaches nothing outside
# itself by any path through it.
#
# THIS IS HOUSE RULE 2'S OTHER HALF. `eslint.config.js` holds the ambient half
# — the globals a domain module may not name — and states both there. What no
# per-file check can see is reachability: a path helper inside the domain that
# imports a filesystem module names no forbidden global, and the decider that
# calls it imports nothing forbidden either, so every per-file rule passes on a
# tree where the invariant is broken. The rule is about the graph, and this
# gate is where the graph is asked.
#
# WHY A WRAPPER AND NOT THE TOOL DIRECTLY. dependency-cruiser exits non-zero on
# a violation and non-zero when it cannot resolve a module, and this tree's
# gates must tell those apart: 1 is a finding a reader should act on, 2 is a
# verdict that never happened. Running the tool from `ci.sh` unwrapped would
# collapse the two into "failed", which is the exact confusion every gate here
# separates. The rules themselves are in `.dependency-cruiser.cjs`, next to the
# layer table they encode.
#
# THE RULES ARE PROVED TO BITE, in `.chug/tasks/check-boundaries.test.sh`,
# against fixture trees carrying the violation each one names. A boundary rule
# that has never rejected anything is an unverified control, and this repo's
# standing position is that one of those is worse than none.
#
# WHAT IT CANNOT SEE. A capability reached without an import — a global, a
# dynamic `import()` built from a computed string, a value injected at run time
# — is invisible to a static graph. The first is eslint's half. The second is
# not written in this tree and would be a finding on sight. The third is what
# the ports exist to make legible, and the reviewer's, not this gate's.
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

# The local binary wins over anything on PATH, for check-model.sh's reason: a
# gate whose verdict depends on which version happens to be installed is not a
# gate.
if [ -x ./node_modules/.bin/depcruise ]; then
	DEPCRUISE=./node_modules/.bin/depcruise
elif command -v depcruise >/dev/null 2>&1; then
	DEPCRUISE=depcruise
else
	echo "check-boundaries: LINTER ERROR — no depcruise found. Install with \`npm ci\`."
	exit 2
fi

# `src/` arrives one slice at a time, and a directory the graph has no module
# for is a rule that is inert rather than absent. An empty tree is still a
# could-not-run: the gate would print a clean verdict having asked nothing.
sources="$(git ls-files 'src/*.ts' 'src/**/*.ts' 2>/dev/null || true)"
if [ -z "$sources" ]; then
	echo "check-boundaries: LINTER ERROR — no tracked src/*.ts; the graph would be empty"
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

set +e
"$DEPCRUISE" --config .dependency-cruiser.cjs --output-type err src test >"$work/out" 2>"$work/err"
rc=$?
set -e

# dependency-cruiser reports rule violations on stdout and its own failures on
# stderr. A non-zero exit with nothing on stdout is the tool failing to run,
# not the tree failing the rules.
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

echo "check-boundaries: graph clean across $(printf '%s' "$sources" | grep -c .) module(s)"
