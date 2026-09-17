#!/bin/sh
# The model gate. Typechecks every Quint module, runs the unit suite, the
# adopted ticket suites.
#
# Quint is pinned in package.json, and the local binary wins over anything on
# PATH: a verdict that depends on which version happens to be installed is not
# a verdict. A version this gate does not expect is a could-not-run.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-model: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# Every verdict below is read out of Quint's own output — the passing count, the
# failure line, the error marker — so a colour escape in front of a numeral is
# a suite that ran reported as one that did not. `NO_COLOR` is the switch and a
# caller's `FORCE_COLOR` beats it.
unset FORCE_COLOR
export NO_COLOR=1

QUINT_VERSION="0.32.0"

if [ -x ./node_modules/.bin/quint ]; then
	QUINT=./node_modules/.bin/quint
elif command -v quint >/dev/null 2>&1; then
	QUINT=quint
else
	echo "check-model: LINTER ERROR — no quint found. Install with \`npm ci\`."
	exit 2
fi

have="$("$QUINT" --version 2>/dev/null || true)"
if [ "$have" != "$QUINT_VERSION" ]; then
	echo "check-model: LINTER ERROR — quint $have, expected $QUINT_VERSION."
	echo "check-model: a different release can change what typechecks; not guessing."
	exit 2
fi

modules="$(git ls-files 'model/*.qnt' 'model/**/*.qnt' | while IFS= read -r module; do
	[ ! -f "$module" ] || printf '%s\n' "$module"
done)"
if [ -z "$modules" ]; then
	echo "check-model: LINTER ERROR — no model modules found; the glob matched nothing"
	exit 2
fi

failed=0
errored=0
tests=0

# A COULD-NOT-RUN IS NOT A FINDING, AND THE EXIT CODE CANNOT TELL THEM APART.
# Quint exits 1 for a violated invariant, an unknown module and a parse error
# alike, and the crash behind #12 leaves on a signal with both streams empty.
# So each stage is judged on the marker it prints when it reached a verdict,
# and the output is printed either way: a failure that said nothing is exactly
# what left that crash undiagnosable.
verdict() { # <label> <status> <output> <marker> <finding-message>
	if printf '%s\n' "$3" | grep -q "$4"; then
		echo "ERROR $5"
		failed=$((failed + 1))
	else
		echo "check-model: LINTER ERROR — $1 could not run (exit $2)"
		errored=$((errored + 1))
	fi
	printf '%s\n' "$3" | sed 's/^/    /'
}

# Quint selects only run names ending in `Test`, and exits 0 when that selects
# NOTHING: a suite whose runs were renamed passes exactly as loudly as one that
# ran. So a call is judged on the count it reports as well as on its status,
# and that total is what the success line accounts for.
run_suite() { # <label> <quint test args...>
	label="$1"
	shift
	if out="$("$QUINT" test "$@" 2>&1)"; then
		rc=0
	else
		rc=$?
	fi
	if [ "$rc" -ne 0 ]; then
		# A suite that ran and failed counts its failures; one that never got
		# that far prints no such line.
		verdict "$label" "$rc" "$out" '^ *[0-9][0-9]* failed' "$label failed"
		return 0
	fi
	passing="$(printf '%s\n' "$out" | sed -n 's/^ *\([0-9][0-9]*\) passing.*$/\1/p')"
	if [ -z "$passing" ] || [ "$passing" -eq 0 ]; then
		echo "ERROR $label selected no tests; a suite that did not run is not a pass"
		failed=$((failed + 1))
		return 0
	fi
	tests=$((tests + passing))
}

echo "--- typecheck"
IFS='
'
for m in $modules; do
	if out="$("$QUINT" typecheck "$m" 2>&1)"; then
		continue
	else
		rc=$?
	fi
	verdict "$m" "$rc" "$out" '^error' "$m: does not typecheck"
done
unset IFS

echo "--- unit suite"
run_suite "model/ticket-domain/ticket_tests.qnt" model/ticket-domain/ticket_tests.qnt
run_suite "model/application/project-decision-processing/processing_tests.qnt" model/application/project-decision-processing/processing_tests.qnt

echo "check-model: $failed failure(s), $tests test(s) run"
if [ "$errored" -ne 0 ]; then
	echo "check-model: LINTER ERROR — $errored stage(s) could not run; not a pass"
	exit 2
fi
[ "$failed" -eq 0 ]
