#!/bin/sh
# Shared harness for the `*.test.sh` suites. Sourced, never executed:
#
#   . "$(cd "$(dirname "$0")" && pwd)/_suite.sh"
#
# It holds the harness and nothing that makes a case what it is: the fixtures,
# the drivers and the assertions stay in each suite. It carries no `set -eu` —
# the sourcing suite sets its own options.
#
# Contract for a sourcing suite:
#   provides   $WORK        a temp dir, removed on exit
#              $OUT         where a driver should write captured output
#              check        assert an exit code and a substring of $OUT
#              fresh_repo   a throwaway git checkout
#              done_        print the tally and exit non-zero if anything failed
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

# Gates read git rather than the filesystem, so a fixture that is not a repo
# tests nothing they actually do.
fresh_repo() { # <dir>
	rm -rf "$1"
	mkdir -p "$1"
	git -C "$1" init -q -b main
	git -C "$1" config user.email t@example.com
	git -C "$1" config user.name t
}

done_() { # <suite name>
	echo "$1: $pass passed, $fail failed"
	[ "$fail" -eq 0 ]
}
