#!/bin/sh
# The gate sequencer. `just check` is a thin wrapper around this, and the
# pre-commit hook calls the individual gates directly — the sequencing has one
# definition, here.
#
# THE NAME AND PATH ARE THE ONES THIS FILE KEEPS FOREVER. When this repo is
# eventually orchestrated by the platform it implements, `.chug/tasks/ci.sh`
# becomes the command evaluator appended to every job type, unchanged. Every
# gate's header, error messages and reproduce-locally lines already name their
# own paths, so a later rename is a sweep of the whole tree rather than an edit.
#
# ORDERING: pure-shell gates first, cheapest first, before anything that needs a
# toolchain. A docs-only or scripts-only change is exactly the change that
# breaks them, and it is also the change that would exit early from a
# language-scoped stage.
#
# EACH GATE IS THREE-VALUED — 0 clean, 1 finding, 2 could-not-run — and this
# script keeps the distinction all the way to its own exit. A gate that could
# not run is a failure here, reported under its own heading, because "the check
# passed" and "the check never ran" must never print the same.
#
# Env:
#   CHUG_CI_SHELL_SUITES=0        skip the shell-suite stage (set for the
#                                 suites themselves, so ci.test.sh cannot
#                                 recurse into a real run)
#   CHUG_CI_SUITE_TIMEOUT_SECS    per-suite cap, default 60
#   CHUG_CI_SUITES_BUDGET_SECS    total suite budget, default 120
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "ci: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

failed=0
errored=0

run_gate() { # <label> <script> [args...]
	label="$1"
	shift
	printf '\n--- %s\n' "$label"
	set +e
	"$@"
	rc=$?
	set -e
	case "$rc" in
	0) ;;
	1)
		echo "ci: FAILED — $label"
		failed=$((failed + 1))
		;;
	*)
		echo "ci: LINTER ERROR ($rc) — $label could not run; this is not a pass"
		errored=$((errored + 1))
		;;
	esac
}

# --- Pure-shell gates --------------------------------------------------------

run_gate "doc-lint" ./.chug/tasks/doc-lint.sh

# Before check-paths: one awk pass over the prose corpus, where that one shells
# out to git for the whole deletion history.
if [ -x ./.chug/tasks/check-figures.sh ]; then
	run_gate "check-figures" ./.chug/tasks/check-figures.sh
fi

if [ -x ./.chug/tasks/check-paths.sh ]; then
	run_gate "check-paths" ./.chug/tasks/check-paths.sh
fi

if [ -x ./.chug/tasks/check-shell-quoting.sh ]; then
	run_gate "check-shell-quoting" ./.chug/tasks/check-shell-quoting.sh
fi

if [ -x ./.chug/tasks/check-duplication.sh ]; then
	run_gate "check-duplication" ./.chug/tasks/check-duplication.sh
fi

if [ -x ./.chug/tasks/check-gates.sh ]; then
	run_gate "check-gates" ./.chug/tasks/check-gates.sh
fi

# --- The TypeScript toolchain ------------------------------------------------
# After every pure-shell gate, because a scripts-only change breaks those and
# should not wait on a toolchain to hear so; before the shell suites, because
# it is cheaper than they now are — its own suite scaffolds a git checkout per
# case and drives the real toolchain over each, which is what makes that stage
# the dearer of the two. Cheapest first, all the way down.
#
# Guarded like the gates above rather than called unconditionally, and the
# reason is worth writing down because the opposite reading is tempting: a
# purity gate that quietly vanished would read exactly like a passing one.
# Three things make the guard the better answer anyway. The `-x` form is what
# every gate but the first uses. The fixtures in `.chug/tasks/ci.test.sh`
# exercise the sequencer, not the roster, and requiring each to stub every gate
# would give this file the list-to-update that the suite stage's discovery glob
# exists to avoid. And the failure the unconditional form would catch is caught
# already, one stage down: `.chug/tasks/check-ts.test.sh` invokes the script
# directly and fails loudly when it is missing or not executable, and
# `.chug/tasks/check-gates.sh` is what keeps that suite from going missing too.

if [ -x ./.chug/tasks/check-ts.sh ]; then
	run_gate "check-ts" ./.chug/tasks/check-ts.sh
fi

# --- The conformance spine ---------------------------------------------------
# Beside check-ts because it needs the same toolchain — node, though not the
# installed packages — and after it because a tree whose TypeScript does not
# typecheck is a tree whose replayer cannot be believed. Before the shell
# suites and far ahead of check-model.sh: it replays committed fixtures and
# runs no quint, which is what keeps it among the cheapest stages here.
# `time ./.chug/tasks/check-conformance.sh` is how to see that rather than take
# it on trust, and it is what to re-run if the corpus ever grows enough to move
# this gate's place in the order.

if [ -x ./.chug/tasks/check-conformance.sh ]; then
	run_gate "check-conformance" ./.chug/tasks/check-conformance.sh
fi

# --- Shell suites ------------------------------------------------------------
# The gates' own tests. Discovery is a glob over tracked files, so adding a
# suite is enough — there is no list to update. A glob matching nothing is a
# failure, not a quiet pass.

if [ "${CHUG_CI_SHELL_SUITES:-1}" = "0" ]; then
	printf '\n--- shell suites: SKIPPED (CHUG_CI_SHELL_SUITES=0)\n'
else
	printf '\n--- shell suites\n'
	suite_cap="${CHUG_CI_SUITE_TIMEOUT_SECS:-60}"
	suite_budget="${CHUG_CI_SUITES_BUDGET_SECS:-120}"

	# Probe FUNCTIONALLY — `command -v` says a binary exists, not that it runs.
	# macOS ships no GNU `timeout`; `gtimeout` arrives with coreutils.
	#
	# WHY A MISSING CAP WARNS RATHER THAN ERRORS. On a Linux container host
	# `timeout` always exists, so its absence there would be a real anomaly
	# worth erroring on. Here the developer's macOS
	# machine is the whole of CI, and erroring would make `just check`
	# permanently red on stock macOS — and a gate that is always red is a gate
	# that gets bypassed, which is how a suite stage stops running at all. What
	# the rule actually forbids is announcing a bound that is not being
	# applied, so the uncapped path says exactly that, loudly, and a hung suite
	# is the developer's Ctrl-C rather than a wedged pipeline.
	timeout_cmd=""
	if timeout 5 true >/dev/null 2>&1; then
		timeout_cmd="timeout"
	elif gtimeout 5 true >/dev/null 2>&1; then
		timeout_cmd="gtimeout"
	fi

	suites="$(git ls-files '*.test.sh' 2>/dev/null || true)"
	if [ -z "$suites" ]; then
		echo "ci: LINTER ERROR — no *.test.sh found; the suite glob matched nothing"
		errored=$((errored + 1))
	else
		if [ -n "$timeout_cmd" ]; then
			echo "ci: cap ${suite_cap}s per suite, ${suite_budget}s total"
		else
			echo "ci: WARNING — no working \`timeout\` or \`gtimeout\`, so suites run"
			echo "ci:           UNCAPPED. The ${suite_budget}s total budget still"
			echo "ci:           applies between suites. Install coreutils for the cap."
		fi
		started="$(date +%s)"
		stopped=""
		IFS='
'
		for suite in $suites; do
			elapsed=$(( $(date +%s) - started ))
			# Checked BETWEEN suites, never after the loop: a post-loop check
			# bounds nothing, because the real ceiling would be count x cap.
			if [ "$elapsed" -ge "$suite_budget" ]; then
				stopped="$stopped$suite
"
				continue
			fi
			printf '  - %s\n' "$suite"
			set +e
			if [ -n "$timeout_cmd" ]; then
				CHUG_CI_SHELL_SUITES=0 "$timeout_cmd" "$suite_cap" sh "$suite" >/dev/null 2>&1
			else
				CHUG_CI_SHELL_SUITES=0 sh "$suite" >/dev/null 2>&1
			fi
			rc=$?
			set -e
			if [ "$rc" -ne 0 ]; then
				echo "ci: FAILED — $suite (rc=$rc); rerun with: sh $suite"
				failed=$((failed + 1))
			fi
		done
		unset IFS
		echo "ci: suites finished in $(( $(date +%s) - started ))s"
		if [ -n "$stopped" ]; then
			echo "ci: BUDGET REACHED — these suites did NOT run:"
			printf '%s' "$stopped" | sed 's/^/    /'
			failed=$((failed + 1))
		fi
	fi
fi

# --- The model ---------------------------------------------------------------
# Last because it is by far the slowest, and a fast gate that runs after a slow
# one is a fast gate nobody benefits from.

if [ -x ./.chug/tasks/check-model.sh ]; then
	run_gate "check-model" ./.chug/tasks/check-model.sh
fi

# --- Verdict -----------------------------------------------------------------

printf '\n'
if [ "$errored" -gt 0 ]; then
	echo "ci: $errored gate(s) could not run, $failed failed"
	exit 2
fi
if [ "$failed" -gt 0 ]; then
	echo "ci: $failed gate(s) failed"
	exit 1
fi
echo "ci: all gates clean"
