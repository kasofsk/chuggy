#!/bin/sh
# The TypeScript gate. Typechecks the sources and the suites, lints them, holds
# them to the formatter's output, and runs the unit suites.
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
# THE UNIT STAGE RUNS THE SUITES NO OTHER GATE OWNS. `check-conformance.sh`
# replays the corpus, `check-random.sh` walks the seeded sweep and
# `check-postgres.sh` drives a real server, each over its own directory;
# discovering those here as well would replay and walk twice per `ci.sh` run,
# and would fail every check on a machine with no database. So this stage
# subtracts their directories from the tracked
# suites rather than naming the ones it wants — a suite added anywhere else
# runs here without being listed, and a directory nothing covers is a glob
# matching nothing rather than a quiet pass. The clean line reports the split,
# because a stage that narrowed its own scope has to say so.
#
# Local binaries win over anything on PATH: a verdict that depends on which
# version happens to be installed is not a verdict. Each missing one is a
# could-not-run, reported as itself.
#
# Usage:
#   .chug/tasks/check-source.sh
#   .chug/tasks/check-source.sh --static
#   .chug/tasks/check-source.sh --unit
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

mode="${1:-all}"
case "$mode" in
--static) run_static=1; run_unit=0 ;;
--unit) run_static=0; run_unit=1 ;;
all) run_static=1; run_unit=1 ;;
*) echo "check-source: LINTER ERROR — expected --static or --unit"; exit 2 ;;
esac

sources="$(git ls-files 'src/*.ts' 'src/**/*.ts' 'test/*.ts' 'test/**/*.ts' 2>/dev/null || true)"
if [ -z "$sources" ]; then
	echo "check-source: LINTER ERROR — no tracked TypeScript; the glob matched nothing"
	exit 2
fi

if [ "$run_static" -eq 1 ]; then
	for tool in tsc eslint prettier; do
		if [ ! -x "./node_modules/.bin/$tool" ]; then
			echo "check-source: LINTER ERROR — no local $tool. Install with \`npm ci\`."
			exit 2
		fi
	done
fi

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

if [ "$run_static" -eq 1 ]; then
	stage "  typecheck" ./node_modules/.bin/tsc --noEmit
	# Lint is the server-free half of the query checking: the SafeQL block in
	# eslint.config.js activates on CHUG_SAFEQL_DATABASE_URL, and an operator
	# who exports it shell-wide must not make this stage need a database.
	stage "  lint     " env CHUG_SAFEQL_DATABASE_URL= ./node_modules/.bin/eslint .
	stage "  format   " ./node_modules/.bin/prettier --check --log-level warn .
fi

# The runner is handed its list rather than discovering one, and an empty
# list would send it back to whole-tree discovery; the glob is checked first
# and separately.
if [ "$run_unit" -eq 1 ]; then
	suites="$(git ls-files '*.test.ts' 2>/dev/null || true)"
	if [ -z "$suites" ]; then
		echo "check-source: LINTER ERROR — no tracked *.test.ts; the suite glob matched nothing"
		exit 2
	fi

# The pattern mirrors how those gates find their own work — the directory
# itself, not below it — so a suite nested deeper than they look is this
# stage's, which is what keeps the two halves a partition.
	owned='^test/conformance/[^/]*\.test\.ts$|^test/random/[^/]*\.test\.ts$|^test/postgres/[^/]*\.test\.ts$'
	unit_suites="$(printf '%s\n' "$suites" | grep -Ev "$owned" || true)"
	if [ -z "$unit_suites" ]; then
		echo "check-source: LINTER ERROR — every tracked suite belongs to another gate; this stage would run nothing"
		exit 2
	fi
	unit_count="$(printf '%s\n' "$unit_suites" | grep -c '' || true)"
	owned_count="$(printf '%s\n' "$suites" | grep -Ec "$owned" || true)"

	set -f
	IFS='
'
	# shellcheck disable=SC2086 # the suite list is newline-separated by construction
	set -- $unit_suites
	unset IFS
	set +f

	stage "  unit     " node --test --test-reporter=dot "$@"
	echo "check-source: unit ran $unit_count suite(s); $owned_count left to check-conformance, check-random and check-postgres"
fi

echo "check-source: $failed stage(s) failed, $ran run"
[ "$failed" -eq 0 ]
