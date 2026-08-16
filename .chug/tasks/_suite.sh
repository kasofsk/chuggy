#!/bin/sh
# Shared harness for the `*.test.sh` suites. Sourced, never executed:
#
#   . "$(cd "$(dirname "$0")" && pwd)/_suite.sh"
#
# WHY THIS EXISTS RATHER THAN A COPY PER SUITE. The duplication gate runs at
# threshold 0 and does NOT exempt test files. The usual argument for exempting
# them — "a test should read top to bottom as the scenario it is" — protects a
# test's SCENARIO, and what the suites were sharing is HARNESS: a `check`
# helper, a temp dir, a trap, two counters. None of it is the thing a reader of
# a case needs in front of them, and it grew with every gate.
#
# What stays in each suite is everything that makes its cases different — the
# fixtures, the drivers, the assertions. A case still reads top to bottom.
#
# It carries no `set -eu`: the sourcing suite sets its own options, and a
# sourced file that changed them would be surprising.
#
# Contract for a sourcing suite:
#   provides   $WORK   a temp dir, removed on exit
#              $OUT    where a driver should write captured output
#              check   assert an exit code and a substring of $OUT
#              fresh_repo   a throwaway git checkout
#              tools_only   a PATH holding only the tools named
#              done_   print the tally and exit non-zero if anything failed
#   expects    the suite to set $OUT before each check

export LC_ALL=C

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/.out"

pass=0
fail=0

check() { # <name> <expected-rc> <actual-rc> <must-contain>
	_name="$1"; _want="$2"; _got="$3"; _needle="$4"
	if [ "$_got" = "$_want" ] && grep -qF "$_needle" "$OUT"; then
		echo "ok   - $_name (rc=$_got)"
		pass=$((pass + 1))
	else
		echo "FAIL - $_name: rc want=$_want got=$_got; expected output to contain: $_needle"
		echo "----- output -----"; cat "$OUT"; echo "------------------"
		fail=$((fail + 1))
	fi
}

# A throwaway git checkout. Gates read git rather than the filesystem, so a
# fixture that is not a repo tests nothing they actually do.
fresh_repo() { # <dir>
	rm -rf "$1"
	mkdir -p "$1"
	git -C "$1" init -q -b main
	git -C "$1" config user.email t@example.com
	git -C "$1" config user.name t
}

# A directory to use as the whole of PATH, holding only the tools named. Gates
# separate a clean tree from a tree they could not read, and the second half is
# only reachable by taking a tool away — every suite that drives a could-not-run
# path needs one of these, and what makes each case worth anything is which
# tools it leaves IN: strip more than the one under test and the gate refuses
# for some other reason and the case passes without the guard existing.
tools_only() { # <dir> <tool>...
	_dir="$1"
	shift
	rm -rf "$_dir"
	mkdir -p "$_dir"
	for _t in "$@"; do
		ln -sf "$(command -v "$_t")" "$_dir/$_t"
	done
}

done_() { # <suite name>
	echo "$1: $pass passed, $fail failed"
	[ "$fail" -eq 0 ]
}
