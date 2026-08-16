#!/bin/sh
# The TypeScript gate. Its stages over `src/`, in the order they run: format,
# types, lint, purity, test.
#
# THE RULE IT EXISTS FOR. THE PURE CORE reaches no I/O and no ambient
# capability — no clock, no randomness, no process, no fetch, no timers, no
# filesystem, no sockets — transitively. That is what makes a decider
# replayable, and replay is the whole conformance argument: the same Core and
# the same event must produce the same StepRecord on any host at any hour, or
# the golden traces the model emits prove nothing about this code. Convention
# cannot hold it. The breach that matters is never the one somebody argued for;
# it is the helper three imports down that started reading the clock.
#
# THE PURE CORE IS `$PURE_DIRS` BELOW: `src/domain/`, and `src/spine/` — the
# decision-event vocabulary, the machine's own step and the replayer that
# drives the golden corpus through them. The spine was claimed pure in its own
# headers before any gate covered it, which is the shape of control this repo
# refuses: a clock there voids replay exactly as a clock in a decider does, and
# s5's recovery-by-replay folds over that code next. `src/tools/` is
# deliberately outside the rule — the emitter spawns quint, the gate driver
# reads the corpus — and what keeps that honest is direction rather than
# naming: `.dependency-cruiser.mjs` forbids anything pure from reaching it.
#
# THE RULE HAS TWO HALVES AND NEEDS BOTH. A module graph cannot see
# `Date.now()`, because a global is not an import. A lint rule cannot see a
# three-hop path into `node:fs`, because it reads one file at a time. The
# `purity` stage runs both — `.dependency-cruiser.mjs` for the graph,
# `eslint.purity.config.js` for the ambient globals — and each of those files
# states in its own header what it catches and what it cannot.
#
# AND A THIRD THING, WHICH IS NOT A HALF BUT A FLOOR: every file under
# `src/domain/` is handed to eslint BY NAME, under `--max-warnings=0`, so a
# file no configuration matches is a finding instead of a silence. Both halves
# above are only as wide as the globs that select their inputs, and a glob is
# the one part of a rule that fails without saying anything — a `.mts` file
# under a `*.ts` glob went UNLINTED while this gate printed clean on every
# stage, and `Date.now()` inside it was therefore invisible to the ambient
# roster. It was still typechecked, as long as something imported it: an
# import pulls a file into the program whatever the `include` glob says, so
# tsc reported type errors inside that same file while eslint never opened it.
# Only the linting was missing, and the ambient half is entirely lint.
# Widening the globs fixed that file; passing the files explicitly is what
# makes the next extension loud.
#
# THAT FLOOR DOES NOT COVER JAVASCRIPT, and the types stage is what does.
# ESLint always has a configuration for `.js`, `.mjs` and `.cjs`, so no
# "ignored" warning ever fires for them and `--max-warnings=0` has nothing to
# escalate. What keeps them out is the stray check below: `src/` holds
# TypeScript and nothing else, so no file there can sit outside the program
# `tsconfig.json` describes. Two floors, two file classes, neither covering
# for the other.
#
# WHY ONE GATE AND NOT ONE PER STAGE. `.chug/tasks/check-gates.sh` requires a
# sibling suite per gate, so a gate per stage would be a suite per stage
# sharing one fixture builder — the duplication `.chug/tasks/_suite.sh` exists
# to stop — behind labels in `.chug/tasks/ci.sh` that pass and fail together
# after the same `npm ci`. What a split buys is running one check alone, and
# that is an argument, not a file:
#
#   .chug/tasks/check-ts.sh            every stage, in the order below
#   .chug/tasks/check-ts.sh purity     the purity rule alone, in about a second
#
# EVERY SELECTED STAGE RUNS, even after one fails. Stopping at the first
# finding would let a formatting slip hide a purity breach, and the author
# would re-run once per stage to learn what one run could have told them.
#
# STAGE ORDER IS A READING ORDER, NOT A SCHEDULE, and the difference is worth
# stating because `.chug/tasks/ci.sh` orders GATES by cost and this file does
# not order its stages that way. Every selected stage runs regardless, so cost
# cannot be saved by going first — and it does not discriminate anyway: no
# stage on this tree is an order of magnitude dearer than its neighbours, and
# `time ./.chug/tasks/check-ts.sh <stage>` is how to see that rather than take
# it on trust. What the fixed order buys is that the same tree always reports
# the same way, coarsest question first: is it written the way this repo writes
# things, does it typecheck, does it lint, is the domain pure, do the tests
# pass. Where the gate as a whole sits in `.chug/tasks/ci.sh` IS a cost
# decision, and it is made there.
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

# The directories the purity rule names. One list, read by the stage below;
# `eslint.purity.config.js` globs the same set and `.dependency-cruiser.mjs`
# carries a reachability rule per entry.
PURE_DIRS="src/domain src/spine"

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
	verdict=0

	if [ ! -f tsconfig.json ]; then
		echo "check-ts: LINTER ERROR — tsconfig.json is missing" >"$OUT"
		verdict=2
		return
	fi

	# SRC/ IS TYPESCRIPT, and this is checked here rather than left to the
	# linter because it is a statement about the typechecker's reach. A `.js`
	# or `.mjs` file under `src/` is outside the program `tsconfig.json`
	# describes, so `strict` — the whole first clause of this slice's contract
	# — quietly would not apply to it, and it would still be importable by
	# everything around it. Rather than lint it and leave it type-invisible,
	# it may not be there. `tsconfig.json` includes `src/**` and lets tsc
	# expand the extension list, so this check and that include cannot drift
	# into disagreeing about what a TypeScript file is.
	#
	# `-L` because plain `find -type f` does not match a symlink at all, so a
	# symlinked stray would walk past a check whose whole job is to notice
	# strays. The same flag, for the same reason, builds the purity stage's
	# file list.
	strays="$(find -L src -type f ! -name '*.ts' ! -name '*.mts' ! -name '*.cts' 2>/dev/null || true)"
	if [ -n "$strays" ]; then
		{
			echo "check-ts: src/ holds files that are not TypeScript, so tsc never sees them:"
			printf '%s\n' "$strays" | sed 's/^/    /'
		} >"$OUT"
		verdict=1
		return
	fi

	# tsc's exit codes, MEASURED (2026-08-15, typescript 5.9.3) rather than
	# taken from the enum's names: 0 clean; 1 diagnostics present; 2 also
	# diagnostics present — a malformed tsconfig.json lands on 2, not on some
	# higher could-not-run code, so this gate reports a broken project as a
	# finding and says so here rather than claiming a 2-path it does not have.
	# That is the honest answer anyway: a tsconfig that does not parse is a
	# defect in the tree, and the guard above already covers the one case that
	# genuinely is could-not-run, the file being absent.
	set +e
	"$TSC" --noEmit -p tsconfig.json >"$OUT" 2>&1
	rc=$?
	set -e
	if [ "$rc" -ne 0 ]; then
		verdict=1
	fi
}

stage_lint() {
	# eslint: 0 clean, 1 lint errors (a parse error is one of these), 2 a
	# problem with the configuration or the invocation.
	#
	# `--max-warnings=0` because this tree configures no rule at warning
	# severity, so the only warnings eslint can emit are its own — and the one
	# that matters is "File ignored because no matching configuration was
	# supplied", which is how an unlinted file reads as a linted one.
	set +e
	"$ESLINT" --max-warnings=0 . >"$OUT" 2>&1
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

	# The module graph. NEITHER depcruise's exit code NOR its verdict line is
	# trustworthy alone, and the two fail in opposite directions.
	#
	# The exit code is a raw violation count handed to `process.exit`, so it
	# cannot separate "three findings" from "crashed with code three" — and, at
	# 256 violations, it wraps to 0 and a catastrophically dirty graph reports
	# clean. The printed line cannot stand alone either: it counts violations
	# of EVERY severity, so an `info` note would read as a finding.
	#
	# So the count of ERRORS is read out of the printed line, and the exit code
	# is kept only as a corroborator — non-zero with no errors reported is a
	# disagreement this gate does not get to resolve, and says so. The line's
	# absence is still could-not-run, the same way
	# `.chug/tasks/check-duplication.sh` refuses to read a fetch failure as
	# "no duplication". Every rule in `.dependency-cruiser.mjs` is severity
	# `error`, because a rule that could be violated without reddening this
	# gate is a rule this gate does not enforce.
	set +e
	"$DEPCRUISE" src --config .dependency-cruiser.mjs >"$OUT" 2>&1
	rc=$?
	set -e
	if grep -qF "no dependency violations found" "$OUT"; then
		errors=0
	else
		errors="$(sed -n 's/^x [0-9][0-9]* dependency violations (\([0-9][0-9]*\) errors.*/\1/p' "$OUT" | tail -1)"
	fi
	if [ -z "$errors" ]; then
		echo "check-ts: depcruise produced no verdict (rc=$rc)" >>"$OUT"
		verdict=2
	elif [ "$errors" -gt 0 ]; then
		verdict=1
	elif [ "$rc" -ne 0 ]; then
		echo "check-ts: depcruise reported 0 errors but exited $rc" >>"$OUT"
		verdict=2
	fi

	# The ambient capabilities. A second, syntax-only eslint run over the PURE
	# CORE alone: it needs no type information, so it costs
	# milliseconds, and it means the purity rule is one stage a developer can
	# run rather than a property spread across two.
	#
	# THE FILES ARE PASSED EXPLICITLY, not as the directory, and that is the
	# structural half of this fix rather than a style choice. Handed a
	# directory, eslint enumerates only what its config's `files` patterns
	# already match, so a file no pattern covers is not skipped loudly — it is
	# not seen at all, and the stage prints "purity clean" for a tree it never
	# read. That is exactly how a `.mts` file reached `Date.now()` under a
	# `*.ts` glob. Handed the files, eslint says "File ignored because no
	# matching configuration was supplied" for each one it cannot place, and
	# `--max-warnings=0` turns that into the finding it is. The globs were
	# widened too, but only this makes the NEXT extension loud instead of
	# silent.
	#
	# THAT SAME EXPLICIT LIST IS ALSO WHERE THE STAGE CAN GO BLIND, which is
	# the price of building it here rather than letting eslint walk the tree.
	# `find -type f` does not match a symlink, so a symlinked pure module was
	# dropped from the list and this stage printed clean over a file it never
	# opened — on the path the package scripts advertise for every save. `-L`
	# resolves them. A BROKEN symlink resolves to nothing and so cannot be
	# linted at all: under `-L` it stops being `-type f` and becomes `-type l`,
	# which is precisely the shape that would vanish from the list in silence,
	# so it is looked for by name and reported. Could-not-run would be the
	# wrong verdict for it — nothing about the toolchain failed; a file in the
	# tree points at nothing, which is a defect in the tree, the same class as
	# the stray `.js` the types stage rejects.
	# EVERY PURE DIRECTORY, and each is required to EXIST and to hold at least
	# one file. `$PURE_DIRS` is the same set `eslint.purity.config.js` globs and
	# `.dependency-cruiser.mjs` writes a reachability rule for, and a directory
	# named by the rule that this stage cannot find is a could-not-run: the
	# alternative is a rule whose subject silently left the tree while the gate
	# went on printing clean, which is the exact failure the explicit file list
	# below exists to prevent one level down.
	pure_files=""
	for dir in $PURE_DIRS; do
		if [ ! -d "$dir" ]; then
			echo "check-ts: $dir is named by the purity rule and is not in this tree" >>"$OUT"
			verdict=2
			return
		fi
		dangling="$(find -L "$dir" -type l 2>/dev/null || true)"
		if [ -n "$dangling" ]; then
			{
				echo "check-ts: $dir holds symlinks that resolve to nothing, so the"
				echo "check-ts: ambient half cannot read them:"
				printf '%s\n' "$dangling" | sed 's/^/    /'
			} >>"$OUT"
			verdict=1
		fi
		found="$(find -L "$dir" -type f 2>/dev/null || true)"
		if [ -z "$found" ]; then
			echo "check-ts: no files under $dir — the ambient half checked nothing" >>"$OUT"
			verdict=2
			return
		fi
		# Accumulated HERE, inside the loop that splits `$PURE_DIRS` on the
		# default IFS. The list is split on newlines below, so a directory name
		# reaching that split would arrive as one unsearchable path.
		pure_files="$pure_files$found
"
	done

	set -f
	IFS='
'
	# shellcheck disable=SC2086
	set -- $pure_files
	unset IFS
	set +f
	if [ "$#" -eq 0 ]; then
		echo "check-ts: no files under $PURE_DIRS — the ambient half checked nothing" >>"$OUT"
		verdict=2
		return
	fi
	set +e
	"$ESLINT" --max-warnings=0 --no-config-lookup \
		--config eslint.purity.config.js "$@" >>"$OUT" 2>&1
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
