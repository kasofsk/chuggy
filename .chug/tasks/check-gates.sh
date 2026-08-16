#!/bin/sh
# Every gate script has a sibling `*.test.sh`, and that sibling names it.
#
# Habit is not a gate. "Every gate has a suite" holds right up until the commit
# where it doesn't, and a suite nothing runs is indistinguishable from one that
# passes. This is the check that makes the convention a rule.
#
# THE NAME CHECK IS WHY THIS IS MORE THAN A FILE-EXISTS TEST. Existence alone
# is satisfied by an empty file: a suite holding nothing but `exit 0` passed
# this gate, and a rule an empty file satisfies is a rule that will be
# satisfied that way. So the suite must mention its subject's filename
# somewhere — every real one does, in the `SUT=` line it drives the gate
# through — and a placeholder that names nothing is a finding.
#
# It is deliberately the cheapest possible strengthening rather than the right
# one. A suite that names its gate and then asserts nothing about it still
# passes, and so does one that names it in a comment; what this rules out is
# the empty stub, which is the shape a suite reaches for when it is written to
# satisfy this gate rather than to test something. Whether a suite EXERCISES
# its gate is not a question a grep can answer, and the answer this tree gives
# is `.chug/tasks/review-change.md` — a fresh reviewer, reading the diff.
# Anything heavier here (counting cases, requiring an assertion per exit code)
# would be a gate arguing about test design, which is how a gate acquires
# exemptions and then stops being run.
#
# It also asserts the discovery glob matched something. A glob that matches
# nothing is the failure mode this whole file exists to prevent, so it must not
# be the way this file passes.
#
# Scope: tracked `.chug/tasks/*.sh` plus `.githooks/pre-commit`. A `*.test.sh`
# is not itself a gate and needs no test of its own.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-gates: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# A leading underscore marks a sourced library rather than a gate; it has no
# verdict of its own, so it has nothing to test.
gates="$(git ls-files '.chug/tasks/*.sh' '.githooks/pre-commit' 2>/dev/null \
	| grep -v '\.test\.sh$' | grep -v '/_' || true)"

if [ -z "$gates" ]; then
	echo "check-gates: LINTER ERROR — no gate scripts found; the glob matched nothing"
	exit 2
fi

missing=0
silent=0
unreadable=0
count=0
IFS='
'
for gate in $gates; do
	count=$((count + 1))
	case "$gate" in
	.githooks/pre-commit) suite=".githooks/pre-commit.test.sh" ;;
	*.sh) suite="${gate%.sh}.test.sh" ;;
	*) suite="$gate.test.sh" ;;
	esac
	if ! git ls-files --error-unmatch "$suite" >/dev/null 2>&1; then
		echo "ERROR $gate: no sibling suite — expected $suite"
		missing=$((missing + 1))
		continue
	fi
	if [ ! -r "$suite" ]; then
		# Tracked but not in the working tree: the verdict would be about the
		# checkout rather than about the suite, so there is no verdict.
		echo "check-gates: LINTER ERROR — $suite is tracked but cannot be read"
		unreadable=$((unreadable + 1))
		continue
	fi
	if ! grep -qF "${gate##*/}" "$suite"; then
		echo "ERROR $suite: never names ${gate##*/} — a suite that does not"
		echo "    mention its subject is not driving it"
		silent=$((silent + 1))
	fi
done
unset IFS

if [ "$unreadable" -gt 0 ]; then
	echo "check-gates: $unreadable suite(s) could not be read; this is not a pass"
	exit 2
fi
echo "check-gates: $missing gate(s) without a suite and $silent not naming theirs, across $count gate(s)"
[ "$((missing + silent))" -eq 0 ]
