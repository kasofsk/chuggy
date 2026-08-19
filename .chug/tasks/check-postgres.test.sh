#!/bin/sh
# Shell test for check-postgres.sh.
#
# WHAT IT HAS TO PROVE IS THAT ALL THREE EXITS ARE REACHABLE, because this gate
# is the one place in the tree where "could not run" is the likely answer on a
# developer's machine and is the answer most easily mistaken for a pass. So the
# cases drive a missing suite, a missing docker and a red suite, and each is
# required to answer with its own code.
#
# THE CASES SUPPLY THEIR OWN SERVER URL AND THEIR FIXTURE SUITES IGNORE IT.
# What is under test here is the gate's sequencing and its verdict, not the
# adapter — the adapter is tested against a real server by the gate itself. A
# fixture that connected would make this suite need a database to say anything
# about a script, and then a machine without one could not check the script
# either.
#
# The clean line's figure is asserted against a fixture whose suites this file
# writes, so the line cannot report a scope the run did not have.
#
# Run:  .chug/tasks/check-postgres.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-postgres.sh"
R="$WORK/repo"

# A PATH with no docker on it, so the missing-docker case is about the gate
# rather than about whichever machine runs this suite.
NODE_DIR="$(dirname "$(command -v node)")"
BIN="$WORK/bin"
mkdir -p "$BIN"
ln -sf "$NODE_DIR/node" "$BIN/node"
for tool in git find grep sort dirname mktemp sed; do
	if command -v "$tool" >/dev/null 2>&1; then
		ln -sf "$(command -v "$tool")" "$BIN/$tool"
	fi
done

fixture() { # a throwaway repo with a test/postgres directory
	fresh_repo "$R"
	mkdir -p "$R/test/postgres"
}

passing_suite() { # <path>
	cat > "$1" <<'TS'
import { test } from "node:test";
test("a fixture case that needs no server", () => undefined);
TS
}

failing_suite() { # <path>
	cat > "$1" <<'TS'
import assert from "node:assert/strict";
import { test } from "node:test";
test("a fixture case that fails on purpose", () => assert.fail("as designed"));
TS
}

run_gate() { # <dir> [env=value...]
	OUT="$WORK/.out"
	set +e
	(cd "$1" && shift && env "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

# --- A suite that is not there is a could-not-run ----------------------------

fresh_repo "$R"
git -C "$R" add -A 2>/dev/null || true
run_gate "$R" CHUG_PG_URL=postgres://fixture/ignored
check "no test/postgres directory is a could-not-run" 2 "$RC" "the glob matched nothing"

# --- No server and no way to start one is a could-not-run --------------------
#
# The gate is run with a PATH holding node and the shell's own tools and no
# docker, and with no CHUG_PG_URL, which is the state of a machine that has
# never started a container.

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" "PATH=$BIN" HOME="$HOME"
check "no docker and no URL is a could-not-run" 2 "$RC" "no docker"

# --- A red suite is a finding ------------------------------------------------

fixture
failing_suite "$R/test/postgres/red.test.ts"
git -C "$R" add -A
run_gate "$R" CHUG_PG_URL=postgres://fixture/ignored
check "a red suite is a finding" 1 "$RC" "the suite went red"

# --- A green run is clean, and says what it consumed --------------------------

fixture
passing_suite "$R/test/postgres/one.test.ts"
passing_suite "$R/test/postgres/two.test.ts"
git -C "$R" add -A
run_gate "$R" CHUG_PG_URL=postgres://fixture/ignored
check "a green suite is clean" 0 "$RC" "clean against"
check "the clean line counts the suites it ran" 0 "$RC" "2 suite(s) clean"

done_ "check-postgres.test.sh"
