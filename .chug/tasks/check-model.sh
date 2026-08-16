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
# instead. A scan that matches NOTHING is a could-not-run, not a clean tree — a
# pattern that has stopped finding modules reports exactly what a model with no
# modules would.
#
# AND A NAME PATTERN IS ITSELF A LIST, so it is checked against the file rather
# than trusted. `sed` reading `module NAME {` sees one spelling of a
# declaration: indent the line, put the brace on the next one, or the name
# itself on the next one, and the module vanishes from the scan while remaining
# valid Quint that typechecks and that `quint test` finds and runs — the
# original attack again, wearing different whitespace.
#
# WHAT THE AUDIT COUNTS IS THE KEYWORD, NOT THE NAME, and that distinction is
# the whole of it. A second name pattern — even a slightly wider one — shares
# the assumptions of the first, so it agrees with it about every spelling it
# cannot read and reports no discrepancy at all: that is what the first version
# of this audit did, and three spellings walked through both scans together.
# Counting the lines that OPEN a declaration asks a question the name pattern
# cannot influence, because it does not read a name. The count of openers
# against the count of names taken is the check, and any difference is a
# refusal. That closes a declaration the name scan cannot read, a mistyped
# module name, and a pattern narrowed until it drops half the suite; it also
# means a module in one of these files that is deliberately not a suite is a
# question for the author, because this gate will not guess which.
#
# The typecheck pass is NOT a backstop for any of that. It walks the tracked
# `*.qnt` glob and asks only whether each file typechecks, which a module no
# suite loop ever names does perfectly well.
#
# AND A SUITE THAT RAN NOTHING IS NOT A SUITE THAT PASSED. `quint test` exits 0
# on a module with no `*Test` runs, so renaming a run's suffix empties a suite
# in silence; every `quint test` here is required to report a tally with
# something in it. `.chug/tasks/check-ts.sh` carries the counterpart guard over
# the TAP count — it reads a total the runner always prints and refuses a zero,
# where this reads a line quint omits entirely when nothing ran and refuses a
# zero besides.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes.
#
#   - It runs what the model declares; it does not judge whether the model
#     declares enough. A machine change with no witness module for it is
#     invisible here, and `model/` is where that argument lives.
#   - It reads the suite files named below and no others. A module declared in
#     some further file is not discovered, not run, and not counted in any
#     residue — adding a suite file means adding it here.
#   - The opener count reads lines that BEGIN with the keyword, so a
#     declaration that does not begin a line of its own is invisible to it and
#     to the name scan alike, and the two agree about it in silence. Nothing
#     here fixes that; a parser would, and this gate is not one.
#   - It errs towards refusing. A line opening with the keyword inside a string
#     or a block comment inflates the count and the gate stops — which is a
#     could-not-run, so it is the safe direction to be wrong in, but it is a
#     way this gate can be wrong.
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
# the tally would print the same as a clean model. A scan that matches SOME of
# them is the same refusal — see the header; the residue is what a narrowed
# pattern or an unusual declaration line looks like from in here, and neither
# is a thing to guess about.
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
	# The audit: how many declarations the file OPENS, against how many names
	# the pattern above took. It reads the keyword and never a name, which is
	# what keeps it from inheriting the pattern's blind spots — see the header.
	_openers="$(grep -cE '^[[:space:]]*module([[:space:]]|$|\{)' "$2" || true)"
	_taken="$(printf '%s\n' "$MODULES" | grep -c . || true)"
	if [ "$_openers" -ne "$_taken" ]; then
		echo "check-model: LINTER ERROR — $2 opens $_openers module declaration(s)"
		echo "check-model:     and the $1 scan took $_taken name(s), so at least one"
		echo "check-model:     module here is one nothing in this gate would run."
		echo "check-model:     The declarations, by line:"
		grep -nE '^[[:space:]]*module([[:space:]]|$|\{)' "$2" | sed 's/^/        /'
		echo "check-model:     The names taken:"
		printf '        %s\n' $MODULES
		echo "check-model:     Either the name pattern is too narrow or a declaration"
		echo "check-model:     is spelled in a way the scan cannot read. Not guessing."
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
	# A tally line with something in it. Quint omits the line entirely when no
	# run matched, and the leading `[1-9]` refuses a tally of zero besides —
	# the two ways "it passed" and "there was nothing to pass" print alike.
	# Only the zero-exit path reaches here, so there is no `failed` spelling to
	# admit: a suite with a failure has already been counted as one.
	if ! grep -qE '^[[:space:]]*[1-9][0-9]* passing' "$run_out"; then
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
