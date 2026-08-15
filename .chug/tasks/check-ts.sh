#!/bin/sh
# The TypeScript gate. Five stages over `src/`: format, types, lint, purity,
# test.
#
# THE RULE IT EXISTS FOR. `src/domain/` reaches no I/O and no ambient
# capability — no clock, no randomness, no process, no fetch, no timers, no
# filesystem, no sockets — transitively. That is what makes a decider
# replayable, and replay is the whole conformance argument: the same Core and
# the same event must produce the same StepRecord on any host at any hour, or
# the golden traces the model emits prove nothing about this code. Convention
# cannot hold it. The breach that matters is never the one somebody argued for;
# it is the helper three imports down that started reading the clock.
#
# THE RULE HAS TWO HALVES AND NEEDS BOTH. A module graph cannot see
# `Date.now()`, because a global is not an import. A lint rule cannot see a
# three-hop path into `node:fs`, because it reads one file at a time. The
# `purity` stage runs both — `.dependency-cruiser.mjs` for the graph,
# `eslint.purity.config.js` for the ambient globals — and each of those files
# states in its own header what it catches and what it cannot.
#
# WHY ONE GATE AND NOT FIVE. `.chug/tasks/check-gates.sh` requires a sibling
# suite per gate, so five gates over one toolchain would be five suites sharing
# one fixture builder — the duplication `.chug/tasks/_suite.sh` exists to stop
# — behind five labels in `.chug/tasks/ci.sh` that pass and fail together after
# the same `npm ci`. What a split actually buys is running one check alone, and
# that is an argument, not a file:
#
#   .chug/tasks/check-ts.sh            every stage, in the order below
#   .chug/tasks/check-ts.sh purity     the purity rule alone, in about a second
#
# EVERY SELECTED STAGE RUNS, even after one fails. Stopping at the first
# finding would let a formatting slip hide a purity breach, and the author
# would re-run four times to learn what one run could have told them.
#
# STAGE ORDER IS A READING ORDER, NOT A SCHEDULE, and the difference is worth
# stating because `.chug/tasks/ci.sh` orders GATES by cost and this file does
# not order its stages that way. Every selected stage runs regardless, so cost
# cannot be saved by going first — and it does not discriminate anyway:
# measured on this tree, 2026-08-15, 8 source files, format 0.15s, types 0.27s,
# lint 0.70s, purity 0.59s, test 0.11s, 1.8s for the lot. What the fixed order
# buys is that the same tree always reports the same way, coarsest question
# first: is it written the way this repo writes things, does it typecheck, does
# it lint, is the domain pure, do the tests pass. Where the gate as a whole
# sits in `.chug/tasks/ci.sh` IS a cost decision, and it is made there.
#
# NOT IN `.githooks/pre-commit`, deliberately. That hook's budget is about two
# seconds and it already declines the shell suites for being slower than that.
# This gate needs an installed `node_modules` the hook cannot assume, and a
# hook that is slow or that fails open on a fresh clone is a hook people
# disable — after which none of it runs. `just check` is where this belongs,
# beside `check-model.sh`, which stays out of the hook for the same reason.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run — and 2 is not a pass.
# A missing `node_modules` is a 2, never a 0: "the check passed" and "the check
# never ran" must not print the same thing. Could-not-run dominates a finding,
# exactly as `.chug/tasks/ci.sh` resolves the same pair at its own exit.
#
# Usage:
#   .chug/tasks/check-ts.sh [<stage>...]     stages: format types lint purity test
set -eu
export LC_ALL=C

STAGES="format types lint purity test"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-ts: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# --- Stage selection ---------------------------------------------------------

selected="$*"
if [ -z "$selected" ]; then
	selected="$STAGES"
fi
for want in $selected; do
	case " $STAGES " in
	*" $want "*) ;;
	*)
		echo "check-ts: LINTER ERROR — unknown stage $want; known stages: $STAGES"
		exit 2
		;;
	esac
done

wanted() { # <stage>
	case " $selected " in
	*" $1 "*) return 0 ;;
	*) return 1 ;;
	esac
}

# --- The toolchain -----------------------------------------------------------
# Local binaries only, with no `npx` fallback. A gate whose verdict depends on
# which version happens to be reachable on PATH is not a gate, and every
# version here is pinned exactly in package.json so `npm ci` is reproducible.

PRETTIER=./node_modules/.bin/prettier
TSC=./node_modules/.bin/tsc
ESLINT=./node_modules/.bin/eslint
DEPCRUISE=./node_modules/.bin/depcruise

for bin in "$PRETTIER" "$TSC" "$ESLINT" "$DEPCRUISE"; do
	if [ ! -x "$bin" ]; then
		echo "check-ts: LINTER ERROR — $bin is missing. Install with: npm ci"
		exit 2
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
OUT="$work/out"

failed=0
errored=0
verdict=0

# --- The stages --------------------------------------------------------------
# Each sets $verdict to 0, 1 or 2 and leaves its own output in $OUT. The exit
# codes are the tools own conventions and they do not agree with each other,
# which is why each stage translates rather than passing one through.

stage_format() {
	# prettier: 0 formatted, 1 differences, 2 could not parse something. An
	# unparseable file is reported here as could-not-run and by `types` as a
	# finding; the tree is broken either way and neither reads as a pass.
	set +e
	"$PRETTIER" --check . >"$OUT" 2>&1
	rc=$?
	set -e
	case "$rc" in
	0) verdict=0 ;;
	1) verdict=1 ;;
	*) verdict=2 ;;
	esac
}

stage_types() {
	# tsc: 0 clean; 1 and 2 both mean diagnostics were present (they differ
	# only in whether output was written, and --noEmit writes none); 3 and up
	# mean the project itself could not be read.
	set +e
	"$TSC" --noEmit -p tsconfig.json >"$OUT" 2>&1
	rc=$?
	set -e
	case "$rc" in
	0) verdict=0 ;;
	1 | 2) verdict=1 ;;
	*) verdict=2 ;;
	esac
}

stage_lint() {
	# eslint: 0 clean, 1 lint errors (a parse error is one of these), 2 a
	# problem with the configuration or the invocation.
	set +e
	"$ESLINT" . >"$OUT" 2>&1
	rc=$?
	set -e
	case "$rc" in
	0) verdict=0 ;;
	1) verdict=1 ;;
	*) verdict=2 ;;
	esac
}

stage_purity() {
	verdict=0

	# The module graph. depcruise exits with the NUMBER of violations, so the
	# exit code alone cannot separate "three findings" from "crashed with code
	# three" — the verdict line is what distinguishes them, the same way
	# `.chug/tasks/check-duplication.sh` refuses to read a fetch failure as
	# "no duplication".
	set +e
	"$DEPCRUISE" src --config .dependency-cruiser.mjs >"$OUT" 2>&1
	rc=$?
	set -e
	if grep -qF "no dependency violations found" "$OUT"; then
		[ "$rc" -eq 0 ] || verdict=2
	elif grep -qE "dependency violations|dependency violation" "$OUT"; then
		verdict=1
	else
		echo "check-ts: depcruise produced no verdict (rc=$rc)" >>"$OUT"
		verdict=2
	fi

	# The ambient capabilities. A second, syntax-only eslint run over
	# `src/domain/` alone: it needs no type information, so it costs
	# milliseconds, and it means the purity rule is one stage a developer can
	# run rather than a property spread across two.
	set +e
	"$ESLINT" --no-config-lookup --config eslint.purity.config.js src/domain \
		>>"$OUT" 2>&1
	rc=$?
	set -e
	case "$rc" in
	0) ;;
	1) [ "$verdict" -eq 2 ] || verdict=1 ;;
	*) verdict=2 ;;
	esac
}

stage_test() {
	# Node runs TypeScript directly from 22.18.0 on. Probe it rather than
	# trusting `node --version`: a version string says a release is installed,
	# not that this build strips types. Without the probe a host that cannot
	# would fail every test file and read as a finding, which is a lie about
	# what happened.
	mkdir -p "$work/probe"
	printf '{"type":"module"}\n' >"$work/probe/package.json"
	printf 'const answer: number = 1;\nif (answer !== 1) throw new Error("no");\n' \
		>"$work/probe/probe.ts"
	if ! node "$work/probe/probe.ts" >"$OUT" 2>&1; then
		echo "check-ts: LINTER ERROR — this node cannot run TypeScript directly." >>"$OUT"
		echo "check-ts: package.json requires node >=22.18.0; found $(node --version)" >>"$OUT"
		verdict=2
		return
	fi

	# The reporter is pinned because the default depends on whether stdout is a
	# terminal, and the count below is parsed from it. A gate must not read
	# differently when a human is watching.
	set +e
	node --test --test-reporter=tap "src/**/*.test.ts" >"$OUT" 2>&1
	rc=$?
	set -e

	total="$(sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' "$OUT" | tail -1)"
	if [ -z "$total" ]; then
		echo "check-ts: the test runner produced no count (rc=$rc)" >>"$OUT"
		verdict=2
		return
	fi
	if [ "$total" -eq 0 ]; then
		# A glob that matched nothing exits 0 with no tests, which is the one
		# way this stage could pass without checking anything.
		echo "check-ts: no tests ran; src/**/*.test.ts matched nothing" >>"$OUT"
		verdict=2
		return
	fi
	if [ "$rc" -ne 0 ]; then
		verdict=1
		return
	fi
	verdict=0
}

# --- The run -----------------------------------------------------------------
# Canonical order, whatever order the arguments arrived in: a gate that runs
# its stages in the order they were typed reports differently for the same
# tree.

for stage in $STAGES; do
	wanted "$stage" || continue
	verdict=0
	set +e
	"stage_$stage"
	set -e
	case "$verdict" in
	0)
		echo "check-ts: $stage clean"
		;;
	1)
		sed 's/^/    /' "$OUT"
		echo "check-ts: FINDING — $stage"
		failed=$((failed + 1))
		;;
	*)
		sed 's/^/    /' "$OUT"
		echo "check-ts: LINTER ERROR — $stage could not run; this is not a pass"
		errored=$((errored + 1))
		;;
	esac
done

if [ "$errored" -gt 0 ]; then
	echo "check-ts: $errored stage(s) could not run, $failed with findings"
	exit 2
fi
if [ "$failed" -gt 0 ]; then
	echo "check-ts: $failed stage(s) with findings"
	exit 1
fi
echo "check-ts: clean ($selected)"
