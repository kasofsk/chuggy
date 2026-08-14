#!/bin/sh
# Every gate script has a sibling `*.test.sh`.
#
# The predecessor enforced this by habit, and habit is not a gate: it reached
# seventeen suites that nothing executed, one of them red for weeks. This is
# the check that makes the convention a rule, and it is fifteen lines.
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
	fi
done
unset IFS

echo "check-gates: $missing gate(s) without a suite, across $count gate(s)"
[ "$missing" -eq 0 ]
