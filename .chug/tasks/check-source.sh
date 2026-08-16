#!/bin/sh
# The TypeScript gate. Typechecks the sources and the suites, lints them, holds
# them to the formatter's output, and runs the unit suite.
#
# ONE GATE PER TOOLCHAIN, NOT ONE PER TOOL, which is the shape
# `.chug/tasks/check-model.sh` already has: it typechecks every Quint module
# and runs several kinds of suite behind a single verdict. A gate per tool
# would be a header, a sibling suite and a sequencer entry apiece, each saying
# "the TypeScript did not survive its own tooling" in different words.
#
# WHERE THE RULES ARE STATED, and why none of them is stated here. House rules
# 3, 4 and 5 are `eslint.config.js`, which holds their text because it holds
# their enforcement. House rule 6 — formatting is the formatter's defaults,
# never argued — is `.prettierrc.json`, whose emptiness IS the rule: there is
# no configuration to disagree about. House rule 2's graph half is
# `check-boundaries.sh` and its ambient half is `eslint.config.js`. House rule
# 1 is `check-comments.sh`. This file runs the tools and reports; a rule
# restated here would be a second copy with nothing keeping it current.
#
# THE UNIT SUITE IS PART OF THE GATE rather than a stage of its own, for the
# reason `check-model.sh` runs the model's suites: a specification that
# typechecks and fails its own tests has not been checked, and splitting the
# verdict invites the half that is red to be read as the half that is
# optional.
#
# Node runs TypeScript with no build step and needs no runner installed, which
# is why the test-runner row of this plan's dependency table cost nothing. The
# same erasure has a condition — no syntax that survives type stripping — and
# `tsconfig.json`'s `erasableSyntaxOnly` is what turns a run-time failure there
# into a compile error.
#
# Local binaries win over anything on PATH, on `check-model.sh`'s argument: a
# gate whose verdict depends on which version happens to be installed is not a
# gate. Each missing one is a could-not-run, reported as itself.
#
# Usage:
#   .chug/tasks/check-source.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-source: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

sources="$(git ls-files 'src/*.ts' 'src/**/*.ts' 'test/*.ts' 'test/**/*.ts' 2>/dev/null || true)"
if [ -z "$sources" ]; then
	echo "check-source: LINTER ERROR — no tracked TypeScript; the glob matched nothing"
	exit 2
fi

for tool in tsc eslint prettier; do
	if [ ! -x "./node_modules/.bin/$tool" ]; then
		echo "check-source: LINTER ERROR — no local $tool. Install with \`npm ci\`."
		exit 2
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failed=0

stage() { # <label> <command>...
	label="$1"
	shift
	printf '%s: ' "$label"
	set +e
	"$@" >"$work/out" 2>&1
	rc=$?
	set -e
	if [ "$rc" -eq 0 ]; then
		echo "clean"
	else
		echo "FAILED"
		sed 's/^/    /' "$work/out"
		failed=$((failed + 1))
	fi
}

stage "  typecheck" ./node_modules/.bin/tsc --noEmit
stage "  lint     " ./node_modules/.bin/eslint .
stage "  format   " ./node_modules/.bin/prettier --check --log-level warn .

# The suite glob is the runner's, not this script's: `--test` with no paths
# discovers `*.test.ts` under the whole tree. A glob matching nothing would be
# a silent pass, so the discovery is checked first and separately.
suites="$(git ls-files 'test/**/*.test.ts' 'test/*.test.ts' 2>/dev/null || true)"
if [ -z "$suites" ]; then
	echo "check-source: LINTER ERROR — no tracked *.test.ts; the suite glob matched nothing"
	exit 2
fi
stage "  unit     " node --test --test-reporter=dot

echo "check-source: $failed stage(s) failed across $(printf '%s' "$sources" | grep -c .) file(s)"
[ "$failed" -eq 0 ]
