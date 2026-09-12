#!/bin/sh
# Shell test for check-postgres.sh.
#
# WHAT IT HAS TO PROVE IS THAT ALL THREE EXITS ARE REACHABLE, because this gate
# is the one place in the tree where "could not run" is the likely answer on a
# developer's machine and is the answer most easily mistaken for a pass. So the
# cases drive a missing suite, a missing docker, a server that does not answer
# and a red suite, and each is required to answer with its own code.
#
# THE CASES SUPPLY THEIR OWN SERVER URL AND THEIR FIXTURE SUITES IGNORE IT.
# What is under test here is the gate's sequencing and its verdict, not the
# adapter — the adapter is tested against a real server by the gate itself. So
# the URL they pass names a socket `_gate-fixture.sh` opens, which answers the gate's
# reachability probe and nothing else: a fixture that needed a database to say
# anything about a script would leave a machine without one unable to check the
# script either.
#
# THE NAMES THE RUN MAKES ARE ASSERTED THROUGH THE HELPER LOG, and what they
# have to carry is the database the URL named — `ignored`, in every case here.
# A run whose names stopped depending on that would still create and drop
# consistently, and would still collide with another run of the same pid on a
# server they share, which is the whole of what naming them this way is for.
#
# THE SPELLINGS OF A UNIX SOCKET ARE DRIVEN SEPARATELY, because only the empty
# authority leaves an empty host in the URL: the others put the path where a
# host name goes, or in a parameter, and would be probed as if they named a
# machine — a could-not-run against a server the caller has. A parameter naming
# a machine is driven too, so the escape cannot widen into skipping the probe
# whenever the URL carries one.
#
# The clean line's figure is asserted against a fixture whose suites this file
# writes, so the line cannot report a scope the run did not have. Its subject is
# asserted too, on the path these cases take: a verdict that named the image
# this script would have started would be naming a server the run never
# touched. The container path's subject is exercised by `ci.sh` on every run.
#
# Run:  .chug/tasks/check-postgres.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-postgres.sh"
R="$WORK/repo"

. "$HERE/_gate-fixture.sh"

fixture() { # a throwaway repo with a test/postgres directory
	fresh_repo "$R"
	mkdir -p "$R/test/postgres"
	database_helper_double "$R"
}

blocking_suite() { # <path>
	cat >"$1" <<'TS'
import { test } from "node:test";
test("a fixture case that waits to be interrupted", async () => {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
});
TS
}

suite_moves() { # <worker> — that worker's per-suite clones and drops, in order
	# Two other lines name a database: a clone names its template as well and
	# the run's cleanup drops every name at once, so the field count is what
	# tells a move about one suite from a move about the run.
	awk -v worker="$1" '
		($1 == "clone" && NF == 3) || ($1 == "drop" && NF == 2) {
			if (match($2, "_w" worker "_s[0-9]+$"))
				printf "%s%s ", $1, substr($2, RSTART)
		}
		END { print "" }
	' "$CHUG_PG_HELPER_LOG"
}

# --- A suite that is not there is a could-not-run ----------------------------

fresh_repo "$R"
git -C "$R" add -A 2>/dev/null || true
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "no test/postgres directory is a could-not-run" 2 "$RC" "the glob matched nothing"

# --- No server and no way to start one is a could-not-run --------------------
#
# The gate is run with a PATH holding node and the shell's own tools and no
# docker, and with CHUG_PG_URL emptied rather than inherited: an operator who
# had set it would otherwise send this case down the branch it exists to avoid,
# and the gate's proof that its third exit is reachable would hold only on a
# machine that had never set the variable the gate documents.

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" "PATH=$BIN" HOME="$HOME" CHUG_PG_URL=
check "no docker and no URL is a could-not-run" 2 "$RC" "no docker"

# --- A server that does not answer is a could-not-run ------------------------
#
# The wait is set to nothing, so the case proves the verdict rather than the
# patience.

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=postgres://fixture@$SILENT/ignored" CHUG_PG_READY_SECS=0
check "a URL nothing answers is a could-not-run" 2 "$RC" "nothing answered at $SILENT"

# --- A URL naming no host to reach is run against, not failed ----------------
#
# The wait is set to nothing throughout, so a spelling that regressed into
# being probed reports the verdict here rather than holding the suite for the
# gate's patience.

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" CHUG_PG_URL=postgres:///ignored CHUG_PG_READY_SECS=0
check "a URL with no host to probe is still run against" 0 "$RC" "1 suite(s) clean"

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" CHUG_PG_URL=postgres://%2Fvar%2Frun%2Fpostgresql/ignored CHUG_PG_READY_SECS=0
check "a socket spelled in the authority is still run against" 0 "$RC" "1 suite(s) clean"

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=postgres://fixture@$SILENT/ignored?host=/var/run/postgresql" CHUG_PG_READY_SECS=0
check "a socket named by the host parameter is still run against" 0 "$RC" "1 suite(s) clean"

# --- A host parameter naming a machine is probed, not escaped ----------------
#
# The authority answers and the parameter does not, so the verdict says which
# of the two the probe took.

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS?host=127.0.0.1&port=1" CHUG_PG_READY_SECS=0
check "a host parameter naming a machine is probed" 2 "$RC" "nothing answered at 127.0.0.1:1"

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=postgres://fixture@$SILENT/ignored?host=" CHUG_PG_READY_SECS=0
check "an empty host parameter names nothing and the authority stands" 2 "$RC" "nothing answered at $SILENT"

# --- A red suite is a finding ------------------------------------------------

fixture
failing_suite "$R/test/postgres/red.test.ts"
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$HELPER_LOG"
check "a red worker is a finding" 1 "$RC" "a worker went red against the server CHUG_PG_URL names"
OUT="$HELPER_LOG"
check "a red worker still removes every database" 0 0 "drop ignored_"

# --- Preparation failure is could-not-run and still cleans up ---------------

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$HELPER_LOG" CHUG_PG_HELPER_FAIL=clone
check "a suite database that cannot be cloned is a could-not-run" 2 "$RC" "could not clone a database for"
OUT="$HELPER_LOG"
check "a partial preparation removes its clone name and template" 0 0 "drop ignored_"

# --- An interrupted run terminates its worker and cleans up -----------------

fixture
blocking_suite "$R/test/postgres/blocked.test.ts"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && exec env CHUG_PG_URL="$ANSWERS" "$SUT") >"$OUT" 2>&1 &
GATE_PID=$!
waited=0
until grep -q "clone" "$CHUG_PG_HELPER_LOG"; do
	if [ "$waited" -ge 10 ]; then break; fi
	sleep 1
	waited=$((waited + 1))
done
kill -TERM "$GATE_PID"
wait "$GATE_PID"
RC=$?
set -e
check "an interrupted run is a could-not-run" 2 "$RC" "interrupted before the workers completed"
OUT="$CHUG_PG_HELPER_LOG"
check "an interrupted run removes its databases" 0 0 "drop ignored_"

# --- A green run is clean, and says what it consumed --------------------------

fixture
passing_suite "$R/test/postgres/one.test.ts"
passing_suite "$R/test/postgres/two.test.ts"
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$HELPER_LOG"
check "a green suite is clean" 0 "$RC" "clean against the server CHUG_PG_URL names"
check "the clean line counts the suites it ran" 0 "$RC" "2 suite(s) clean"
check "the active worker count is reported" 0 "$RC" "with 2 worker(s)"
OUT="$HELPER_LOG"
check "a green run prepares the schema once" 0 0 "prepare ignored_"
check "a green run removes its databases" 0 0 "drop ignored_"
check "every database it made is named inside the one it connected to" 0 0 "_t"

# --- Each suite runs against a database of its own ---------------------------
#
# Three suites over two workers, so one worker is dealt two of them: what the
# helper log has to show is that the second was cloned a database of its own
# rather than given the first one's, and that the first was dropped before it.

fixture
passing_suite "$R/test/postgres/one.test.ts"
passing_suite "$R/test/postgres/three.test.ts"
passing_suite "$R/test/postgres/two.test.ts"
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$HELPER_LOG" CHUG_PG_WORKERS=2
check "a run dealing suites over workers is clean" 0 "$RC" "3 suite(s) clean"
check "the clean line reports the workers that ran them" 0 "$RC" "with 2 worker(s)"
MOVES="$WORK/.moves"
{ suite_moves 1; suite_moves 2; } >"$MOVES"
OUT="$MOVES"
check "a worker clones a database per suite and drops it when the suite ends" 0 0 \
	"clone_w1_s1 drop_w1_s1 clone_w1_s2 drop_w1_s2"
check "the other worker does the same for the suite it was dealt" 0 0 "clone_w2_s1 drop_w2_s1"

done_ "check-postgres.test.sh"
