#!/bin/sh
# The TypeScript gate. Typechecks the sources and the suites, typechecks the
# public contract a second time as a browser sees it, lints them, holds them to
# the formatter's output, and runs the unit suites.
#
# THE BROWSER STAGE IS A SECOND PROGRAM OVER ONE DIRECTORY. `src/contract/` is
# imported by the server and by a browser, and `tsconfig.json` gives every
# source the platform's own globals and library — under which a `node:` import
# or a platform type in the contract typechecks and then fails in a browser at
# run time. `tsconfig.contract.json` is the same directory with the browser's
# library and no ambient platform types, so the import that cannot work there
# is a finding here. `check-boundaries.sh` holds the graph half of the same
# claim; neither sees what the other does, because a type is not an edge and an
# edge is not a type.
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
# and would fail every check on a machine with no database. `ui/` is subtracted
# for a different reason and a stronger one: a console that builds pins its own
# runner, and a suite written for it would not merely run twice here — it would
# run under a runner it was never written for, and report the import failure as
# a defect in the console. `check-console.sh` is what runs those, through the
# console's own `test` script. So this stage
# subtracts their directories from the tracked
# suites rather than naming the ones it wants — a suite added anywhere else
# runs here without being listed, and a directory nothing covers is a glob
# matching nothing rather than a quiet pass. The clean line reports the split,
# because a stage that narrowed its own scope has to say so.
#
# EVERY UNIT TEST IS CAPPED, by `.chug/tasks/_test-timeout.sh`, whose header
# says why.
#
# A SUITE NAMED `*.linux.test.ts` STATES WHAT LINUX DOES, and says in its own
# header what that is. On any other kernel such a suite runs in the node of the
# worker image, the image the platform's jobs run in, so its claim is checked
# where it is true and nowhere it is false. A docker that cannot run it there —
# none running, the image not to be had, the tree not visible inside it at its
# own path — is a could-not-run, never a finding against the tree.
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
# Env: CHUG_TEST_TIMEOUT_MS — the cap on one unit test, read by
# `.chug/tasks/_test-timeout.sh`.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

here="$(cd "$(dirname "$0")" && pwd)"

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

# A merge tool's leftovers under src/ or test/. Every static stage above selects
# `*.ts`, so a file named `nativeWeb.ts.orig` is source-shaped, is copied
# into the API image by `COPY src/`, and is invisible to every one of them —
# which is how a stale duplicate of three live modules reached a branch with a
# green `ci.sh` (chuggy#530). The suffixes are what `git merge`, `git apply`
# and an editor leave behind, and none of them is ever a file somebody wrote.
residue() {
	found="$(git ls-files 'src/*' 'src/**' 'test/*' 'test/**' 2>/dev/null |
		grep -E '(\.orig|\.rej|\.bak|~)$' || true)"
	[ -z "$found" ] && return 0
	printf '%s\n' "$found" | sed 's/^/tracked merge residue: /'
	return 1
}

# One linter process per configuration. A console under `ui/` carries an
# `eslint.config.js` of its own, which the linter applies to the files below
# it, and each configuration's typed rules hold a TypeScript program of their
# own; one process holding both outgrows the heap V8 sizes for a container. The
# root's run is told to skip each console's directory, so the runs are a
# partition of what `eslint .` reads and not a narrowing of it.
lint() {
	rc=0
	for config in ui/*/eslint.config.js; do
		[ -f "$config" ] || continue
		console="${config%/eslint.config.js}"
		set -- "$@" --ignore-pattern "$console/**"
		CHUG_SAFEQL_DATABASE_URL= ./node_modules/.bin/eslint "$console" || rc=1
	done
	CHUG_SAFEQL_DATABASE_URL= ./node_modules/.bin/eslint "$@" . || rc=1
	return "$rc"
}

if [ "$run_static" -eq 1 ]; then
	stage "  residue  " residue
	stage "  typecheck" ./node_modules/.bin/tsc --noEmit
	stage "  browser  " ./node_modules/.bin/tsc --noEmit -p tsconfig.contract.json
	# Lint is the server-free half of the query checking: the SafeQL block in
	# eslint.config.js activates on CHUG_SAFEQL_DATABASE_URL, and an operator
	# who exports it shell-wide must not make this stage need a database.
	stage "  lint     " lint
	stage "  format   " ./node_modules/.bin/prettier --check --log-level warn .
fi

# The runner is handed its list rather than discovering one, and an empty
# list would send it back to whole-tree discovery; the glob is checked first
# and separately.
if [ "$run_unit" -eq 1 ]; then
	suites="$(git ls-files '*.test.ts' 2>/dev/null || true)"
	if [ -z "$suites" ]; then
		echo "check-source: LINTER ERROR — no tracked suite; the suite glob matched nothing"
		exit 2
	fi

# The server-side arms mirror how those gates find their own work — the
# directory itself, not below it — so a suite nested deeper than they look is
# this stage's, which is what keeps the two halves a partition. The `ui/` arm
# is the whole subtree instead, because a console owns every file under its own
# directory and there is no depth at which one of its suites becomes this
# runner's.
	owned='^test/conformance/[^/]*\.test\.ts$|^test/random/[^/]*\.test\.ts$|^test/postgres/[^/]*\.test\.ts$|^test/keto/[^/]*\.test\.ts$|^ui/'
	unit_suites="$(printf '%s\n' "$suites" | grep -Ev "$owned" || true)"
	if [ -z "$unit_suites" ]; then
		echo "check-source: LINTER ERROR — every tracked suite belongs to another gate; this stage would run nothing"
		exit 2
	fi
	unit_count="$(printf '%s\n' "$unit_suites" | grep -c '' || true)"
	owned_count="$(printf '%s\n' "$suites" | grep -Ec "$owned" || true)"

	. "$here/_test-timeout.sh"
	test_timeout_read "check-source"

	kernel="$(uname -s)"
	linux_suites=""
	if [ "$kernel" != Linux ]; then
		linux_suites="$(printf '%s\n' "$unit_suites" | grep -E '\.linux\.test\.ts$' || true)"
	fi
	host_suites="$(printf '%s\n' "$unit_suites" | grep -Ev '\.linux\.test\.ts$' || true)"
	[ "$kernel" != Linux ] || host_suites="$unit_suites"

	# The worker image's node, read from the file that pins it so there is one
	# pin and not two, and checked before either unit stage starts.
	if [ -n "$linux_suites" ]; then
		linux_image="$(sed -n 's/^FROM \(node:[^ ]*\) AS base$/\1/p' images/worker/Dockerfile 2>/dev/null || true)"
		if [ -z "$linux_image" ]; then
			echo "check-source: LINTER ERROR — images/worker/Dockerfile pins no node base, so the Linux suites have no image to run in"
			exit 2
		fi
		if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
			echo "check-source: LINTER ERROR — the Linux suites need a running docker on $kernel, and there is none"
			exit 2
		fi
		if ! docker image inspect "$linux_image" >/dev/null 2>&1 &&
			! docker pull -q "$linux_image" >/dev/null 2>&1; then
			echo "check-source: LINTER ERROR — $linux_image is neither held nor to be pulled, so the Linux suites have no image to run in"
			exit 2
		fi
		# The installed modules are probed as well as the tree, because a
		# checkout without its own resolves them from a directory the mount
		# does not carry.
		if ! docker run --rm -v "$root:$root:ro" "$linux_image" \
			test -r "$root/package.json" -a -d "$root/node_modules" >/dev/null 2>&1; then
			echo "check-source: LINTER ERROR — docker does not see $root and its node_modules at their own path, so the Linux suites cannot be read there"
			exit 2
		fi
	fi

	set -f
	IFS='
'
	# An empty list would send the runner back to whole-tree discovery, so a
	# stage with nothing to run is not started.
	if [ -n "$host_suites" ]; then
		# shellcheck disable=SC2086 # the suite list is newline-separated by construction
		set -- $host_suites
		unset IFS
		stage "  unit     " node --test --test-reporter=dot \
			--test-timeout="$test_timeout_ms" --test-force-exit "$@"
	fi
	if [ -n "$linux_suites" ]; then
		IFS='
'
		# shellcheck disable=SC2086 # the suite list is newline-separated by construction
		set -- $linux_suites
		unset IFS
		# Mounted at its own path, read-only, so the suites resolve the same
		# installed modules at the same paths they would on the host; `--init`
		# so an interrupt reaches the runner rather than a PID 1 that drops it.
		stage "  linux    " docker run --rm --init -v "$root:$root:ro" -w "$root" "$linux_image" \
			node --test --test-reporter=dot \
			--test-timeout="$test_timeout_ms" --test-force-exit "$@"
	fi
	unset IFS
	set +f

	linux_note=""
	if [ -n "$linux_suites" ]; then
		linux_note=", $(printf '%s\n' "$linux_suites" | grep -c '') of them in $linux_image"
	fi
	echo "check-source: unit ran $unit_count suite(s)$linux_note; $owned_count left to check-conformance, check-random, check-postgres, check-keto and check-console"
fi

echo "check-source: $failed stage(s) failed, $ran run"
[ "$failed" -eq 0 ]
