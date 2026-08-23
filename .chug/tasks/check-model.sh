#!/bin/sh
# The model gate. Typechecks every Quint module, runs the unit suite, the
# deterministic witness modules, the refinement suites, and the randomized
# invariant runs over each instance.
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

modules="$(git ls-files 'model/*.qnt' 'model/mc/*.qnt' 'model/tests/*.qnt' || true)"
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
run_suite "model/tests/chuggy_test.qnt" model/tests/chuggy_test.qnt
run_suite "model/tests/capacity_test.qnt" model/tests/capacity_test.qnt
run_suite "model/tests/runner_test.qnt" model/tests/runner_test.qnt
run_suite "model/tests/execution_requirement_test.qnt" model/tests/execution_requirement_test.qnt

# The witness modules prove each named shape reachable and assert every
# invariant after every step. `wrapup_none` is the odd one out: it witnesses
# something the machine deliberately does not guarantee.
#
# They name their runs for what they are, so the selection is named here too:
# quint's default takes `Test` and would take none of them.
echo "--- witnesses"
for w in free cascade stage sparse gate gate_deadline dependency wrapup_none; do
	run_suite "witness $w" --match 'Witness$' \
		--main="chuggy_witness_${w}_test" \
		model/tests/chuggy_witness_test.qnt
done

echo "--- refinement"
for r in unit witness hazard; do
	run_suite "refinement $r" --main="chuggy_refinement_${r}_test" \
		model/tests/chuggy_refinement_test.qnt
done

echo "--- invariants (randomized)"
for i in budgeted deadline_only retryfree; do
	if out="$("$QUINT" run model/mc/mc_chuggy.qnt --main="mc_chuggy_${i}" \
		--invariant=allInvariants --max-samples=2000 --max-steps=40 2>&1)"; then
		continue
	else
		rc=$?
	fi
	# A refuted invariant announces itself and carries the seed to reproduce it.
	verdict "instance $i" "$rc" "$out" '\[violation\]' \
		"instance $i violated an invariant"
done

if out="$("$QUINT" run model/mc/mc_runner.qnt --main=mc_registered_runner \
		--invariant=allInvariants --max-samples=2000 --max-steps=30 2>&1)"; then
	:
else
	rc=$?
	verdict "registered runner instance" "$rc" "$out" '\[violation\]' \
		"registered runner instance violated an invariant"
fi

echo "check-model: $failed failure(s), $tests test(s) run"
if [ "$errored" -ne 0 ]; then
	echo "check-model: LINTER ERROR — $errored stage(s) could not run; not a pass"
	exit 2
fi
[ "$failed" -eq 0 ]
