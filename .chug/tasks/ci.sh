#!/bin/sh
# The gate sequencer. `just check` is a thin wrapper around this, and the
# pre-commit hook calls the individual gates directly — the sequencing has one
# definition, here.
#
# THE PROTOCOL IS 0 clean, 1 finding, 2 could-not-run, and this script keeps the
# distinction all the way to its own exit. Not every gate uses all three —
# check-roster has no finding state — and a gate that could not run is a failure
# here, reported under its own heading.
#
# THE CALL IS THE ROSTER. A gate named below must exist and be executable;
# absent or unexecutable, it is a could-not-run like any other. A gate that
# belongs to a later stage is left unnamed rather than named and guarded, so
# that "not part of this run" and "should have run and was not there" cannot
# print the same.
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
	if [ ! -x "$1" ]; then
		if [ -e "$1" ]; then why="is not executable"; else why="is missing"; fi
		echo "ci: LINTER ERROR — $1 $why; this is not a pass"
		errored=$((errored + 1))
		return 0
	fi
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

run_gate "doc-lint" ./.chug/tasks/doc-lint.sh

run_gate "check-figures" ./.chug/tasks/check-figures.sh
run_gate "check-paths" ./.chug/tasks/check-paths.sh
run_gate "check-shell-quoting" ./.chug/tasks/check-shell-quoting.sh
run_gate "check-duplication" ./.chug/tasks/check-duplication.sh
run_gate "check-gates" ./.chug/tasks/check-gates.sh
run_gate "check-comments" ./.chug/tasks/check-comments.sh
run_gate "check-knowledge" ./.chug/tasks/check-knowledge.sh
run_gate "check-roster" ./.chug/tasks/check-roster.sh

if [ "${CHUG_CI_SHELL_SUITES:-1}" = "0" ]; then
	printf '\n--- shell suites: SKIPPED (CHUG_CI_SHELL_SUITES=0)\n'
else
	printf '\n--- shell suites\n'
	suite_cap="${CHUG_CI_SUITE_TIMEOUT_SECS:-60}"
	suite_budget="${CHUG_CI_SUITES_BUDGET_SECS:-120}"

	# Probed functionally — `command -v` says a binary exists, not that it
	# runs. macOS ships no GNU `timeout`; `gtimeout` arrives with coreutils.
	# Its absence warns rather than errors: what the rule forbids is
	# announcing a bound that is not being applied, and the uncapped path says
	# exactly that.
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
			# Checked between suites: a post-loop check bounds nothing.
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

run_gate "check-boundaries" ./.chug/tasks/check-boundaries.sh
run_gate "check-source" ./.chug/tasks/check-source.sh

run_gate "check-conformance" ./.chug/tasks/check-conformance.sh

run_gate "check-random" ./.chug/tasks/check-random.sh

run_gate "check-postgres" ./.chug/tasks/check-postgres.sh
run_gate "check-queries" ./.chug/tasks/check-queries.sh

run_gate "check-model" ./.chug/tasks/check-model.sh
run_gate "check-model-api" ./.chug/tasks/check-model-api.sh

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
