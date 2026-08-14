#!/bin/sh
# The model gate. Typechecks every Quint module, runs the unit suite, the eight
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

failed=0

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
"$QUINT" test model/tests/chuggy_test.qnt >/dev/null 2>&1 \
	|| { echo "ERROR model/tests/chuggy_test.qnt failed"; failed=$((failed + 1)); }

# The witness modules prove each named shape REACHABLE and assert every
# invariant after every step. The eighth is the odd one out: it witnesses
# something the machine deliberately does not guarantee, so that the accepted
# position is held by the suite rather than by a paragraph.
echo "--- witnesses"
for w in free cascade stage carry multirepo gate gate_deadline draft_wait; do
	"$QUINT" test --main="chuggy_witness_${w}_test" \
		model/tests/chuggy_witness_test.qnt >/dev/null 2>&1 \
		|| { echo "ERROR witness $w failed"; failed=$((failed + 1)); }
done

echo "--- refinement"
for r in unit witness hazard; do
	"$QUINT" test --main="chuggy_refinement_${r}_test" \
		model/tests/chuggy_refinement_test.qnt >/dev/null 2>&1 \
		|| { echo "ERROR refinement $r failed"; failed=$((failed + 1)); }
done

echo "--- invariants (randomized)"
for i in budgeted deadline_only retryfree citations; do
	"$QUINT" run model/mc/mc_chuggy.qnt --main="mc_chuggy_${i}" \
		--invariant=allInvariants --max-samples=2000 --max-steps=40 >/dev/null 2>&1 \
		|| { echo "ERROR instance $i violated an invariant"; failed=$((failed + 1)); }
done

echo "check-model: $failed failure(s)"
[ "$failed" -eq 0 ]
