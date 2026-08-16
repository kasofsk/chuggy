#!/bin/sh
# The TypeScript gate. Typechecks the sources and the suites, lints them, holds
# them to the formatter's output, and runs the unit suite.
#
# ONE GATE PER TOOLCHAIN, NOT ONE PER TOOL. The rules the tools apply are
# stated where they are enforced — `eslint.config.js`, `.prettierrc.json`
# (whose emptiness is house rule 6), `tsconfig.json` — and
# `.chug/tasks/review-change.md` routes each house rule to its home. This file runs them and reports.
#
# Each tool resolves its own scope, and the formatter's reaches past TypeScript
# to every JSON and config file in the tree; the tracked-source glob below is a
# precondition rather than a measurement of what any stage read.
#
# Local binaries win over anything on PATH: a verdict that depends on which
# version happens to be installed is not a verdict. Each missing one is a
# could-not-run, reported as itself.
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
ran=0

stage() { # <label> <command>...
	label="$1"
	shift
	printf '%s: ' "$label"
	set +e
	"$@" >"$work/out" 2>&1
	rc=$?
	set -e
	ran=$((ran + 1))
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

# The runner discovers its own suites, so a glob matching nothing would be a
# silent pass; the discovery is checked first and separately.
suites="$(git ls-files 'test/**/*.test.ts' 'test/*.test.ts' 2>/dev/null || true)"
if [ -z "$suites" ]; then
	echo "check-source: LINTER ERROR — no tracked *.test.ts; the suite glob matched nothing"
	exit 2
fi
stage "  unit     " node --test --test-reporter=dot

echo "check-source: $failed stage(s) failed, $ran run"
[ "$failed" -eq 0 ]
