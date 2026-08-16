#!/bin/sh
# The model gate. Typechecks every Quint module, runs the unit suite, the
# deterministic witness modules, the refinement suites, and the randomized
# invariant runs over each instance.
#
# THE MODEL LEADS. It is proved before the implementation exists and it emits
# the golden traces the implementation replays, so this gate is not a test of
# the code — it is the check that the specification the code answers to is
# still true. When the two disagree, the implementation is wrong.
#
# Quint is pinned in package.json. The local binary wins over anything on PATH,
# because a gate whose verdict depends on which version happens to be installed
# is not a gate; if neither resolves, that is a could-not-run and not a pass.
#
# THE SUITE LISTS ARE DISCOVERED, NEVER TYPED. They used to be hand-copied
# module names in `for` loops here, and a hand-copied list of the model's
# modules is a list that stops being the model's. The failure it hid was
# reproduced by appending a witness module whose only run asserts something
# FALSE: it typechecks, it fails under `quint test --main=`, and because no loop
# here named it the gate ran every module it did know about and printed a clean
# tally. Discovery reads the module declarations out of the model source
# instead, so a module the model gains is a module this gate runs. A scan that
# matches NOTHING is a could-not-run, not a clean tree — a pattern that has
# stopped finding modules reports exactly what a model with no modules would.
#
# AND A SUITE THAT RAN NOTHING IS NOT A SUITE THAT PASSED. `quint test` exits 0
# on a module with no `*Test` runs, so renaming a run's suffix empties a suite
# in silence; every `quint test` here is required to report a tally of what it
# ran. `.chug/tasks/check-ts.sh` holds the same guard over the TAP count, for
# the same reason and with the same verdict.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes.
#
#   - It runs what the model declares; it does not judge whether the model
#     declares enough. A machine change with no witness module for it is
#     invisible here, and `model/` is where that argument lives.
#   - Discovery reads a module DECLARATION line. A module nested in a way that
#     does not open at the left margin would be missed, and the typecheck pass
#     is what keeps such a file from being silently unread.
#   - The tally guard proves a run happened, not that the run was the right
#     one. A module whose every run is trivially true still reports a passing
#     tally, and that is the reviewer's, not this gate's.
#   - The randomized instance runs are sampled, so a clean run is an absence of
#     counterexample at that sample count rather than a proof; the proofs are
#     in `model/`, and this gate is the check that they still hold.
#   - Nothing here compares the model against the implementation. That is
#     `.chug/tasks/check-conformance.sh`, over the golden traces.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-model: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

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

UNIT_FILE=model/tests/chuggy_test.qnt
WITNESS_FILE=model/tests/chuggy_witness_test.qnt
REFINEMENT_FILE=model/tests/chuggy_refinement_test.qnt
INSTANCE_FILE=model/mc/mc_chuggy.qnt

failed=0
errored=0

run_out="$(mktemp)"
trap 'rm -f "$run_out"' EXIT

# Module names read out of the model source, into $MODULES. A scan that matches
# nothing is a refusal: the loop that follows would otherwise run no module and
# the tally would print the same as a clean model.
MODULES=""
discover() { # <label> <file> <name-pattern>
	MODULES=""
	if [ ! -f "$2" ]; then
		echo "check-model: LINTER ERROR — no $2 to read $1 modules from"
		errored=$((errored + 1))
		return 1
	fi
	MODULES="$(sed -n "s/^module \($3\) {.*/\1/p" "$2" || true)"
	if [ -z "$MODULES" ]; then
		echo "check-model: LINTER ERROR — no $1 modules declared in $2;"
		echo "check-model:     the scan matched nothing, which is not a pass."
		errored=$((errored + 1))
		return 1
	fi
	return 0
}

# One `quint test`, three-valued. A non-zero exit is a finding; a zero exit with
# no tally is a suite that ran nothing, and that is a could-not-run.
run_test() { # <label> <file> [<main-module>]
	_label="$1"
	set +e
	if [ -n "${3:-}" ]; then
		"$QUINT" test --main="$3" "$2" >"$run_out" 2>&1
	else
		"$QUINT" test "$2" >"$run_out" 2>&1
	fi
	_rc=$?
	set -e
	if [ "$_rc" -ne 0 ]; then
		echo "ERROR $_label failed"
		failed=$((failed + 1))
		return
	fi
	if ! grep -qE '^[[:space:]]*[0-9]+ (passing|failed)' "$run_out"; then
		echo "check-model: LINTER ERROR — $_label reported no tests run."
		echo "check-model:     A suite that ran nothing is not a suite that passed."
		errored=$((errored + 1))
	fi
}

echo "--- typecheck"
IFS='
'
for m in $modules; do
	if ! "$QUINT" typecheck "$m" >/dev/null 2>&1; then
		echo "ERROR $m: does not typecheck"
		failed=$((failed + 1))
	fi
done
unset IFS

echo "--- unit suite"
run_test "$UNIT_FILE" "$UNIT_FILE"

# The witness modules prove each named shape REACHABLE and assert every
# invariant after every step. One of them is the odd one out: it witnesses
# something the machine deliberately does not guarantee, so that the accepted
# position is held by the suite rather than by a paragraph. Which module that
# is, and how many there are, is the model's to say — hence the discovery.
echo "--- witnesses"
if discover witness "$WITNESS_FILE" 'chuggy_witness_[A-Za-z_0-9]*_test'; then
	for w in $MODULES; do
		run_test "witness $w" "$WITNESS_FILE" "$w"
	done
fi

echo "--- refinement"
if discover refinement "$REFINEMENT_FILE" 'chuggy_refinement_[A-Za-z_0-9]*_test'; then
	for r in $MODULES; do
		run_test "refinement $r" "$REFINEMENT_FILE" "$r"
	done
fi

echo "--- invariants (randomized)"
if discover instance "$INSTANCE_FILE" 'mc_chuggy_[A-Za-z_0-9]*'; then
	for i in $MODULES; do
		"$QUINT" run "$INSTANCE_FILE" --main="$i" \
			--invariant=allInvariants --max-samples=2000 --max-steps=40 >/dev/null 2>&1 \
			|| { echo "ERROR instance $i violated an invariant"; failed=$((failed + 1)); }
	done
fi

if [ "$errored" -gt 0 ]; then
	echo "check-model: $errored check(s) could not run, $failed failure(s)"
	exit 2
fi
echo "check-model: $failed failure(s)"
[ "$failed" -eq 0 ]
