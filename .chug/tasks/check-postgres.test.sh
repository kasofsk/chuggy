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
# have to carry is the database the URL named — `ignored`, in every case here —
# and a run id no other run holds. Two runs are made to hold the same pid
# through the gate's seam and pointed at one server, and their logs are required
# to share no name, created or dropped; a run whose names rested on the pid
# would still create and drop consistently, and only this pair tells it apart.
# Two runs of different pids are held to the same, so the pid cannot be read as
# what keeps them apart. The longest names the gate can make — the last place
# in the queue against a connected database long enough to be digested — are
# required to fit, and a pid long enough that they cannot is a could-not-run
# that makes nothing.
#
# THE QUEUE IS READ OFF WHAT THE FIXTURE SUITES RECORD. Each writes its own name
# as it runs, so one worker shows the order the queue is taken in; a suite
# that passes only once the others have run proves a worker free of it drains
# the rest, which a list dealt to the workers in advance would leave behind it;
# and a suite that claims a place itself leaves one no worker runs, which the
# clean line must not count as a pass.
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

recording_suite() { # <path> — a suite that writes its own name to the file FIXTURE_RECORD names
	cat >"$1" <<'TS'
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
test("a fixture case that says it ran", () => {
  appendFileSync(String(process.env["FIXTURE_RECORD"]), `${basename(import.meta.filename)}\n`);
});
TS
}

outlasting_suite() { # <path> — larger than a recording suite, passing once FIXTURE_OTHERS suites have said they ran
	cat >"$1" <<'TS'
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
test("a fixture case that waits for the rest of the queue", async () => {
  for (let waits = 0; waits < 600; waits += 1) {
    let said = "";
    try {
      said = readFileSync(String(process.env["FIXTURE_RECORD"]), "utf8");
    } catch {
      said = "";
    }
    if (said.split("\n").filter(Boolean).length >= Number(process.env["FIXTURE_OTHERS"])) return;
    await delay(50);
  }
  throw new Error("the rest of the queue never ran");
});
TS
}

claiming_suite() { # <path> — a suite that claims the last of three places in the queue, so no worker runs it
	cat >"$1" <<'TS'
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
test("a fixture case that takes the last place from the workers", () => {
  const scratch = String(process.env["TMPDIR"]);
  const runs = readdirSync(scratch).filter((name) => name.startsWith("chuggy-postgres-"));
  if (runs.length !== 1) throw new Error(`expected one run directory, found ${runs.length}`);
  writeFileSync(join(scratch, String(runs[0]), "claimed.3"), "");
});
TS
}

suite_lives() { # <workers> — each suite's clones and drops, and whether more were live at once than workers
	# Two other lines name a database: a clone names its template as well and
	# the run's cleanup drops every name at once, so the field count is what
	# tells a move about one suite from a move about the run.
	awk -v workers="$1" '
		($1 == "clone" && NF == 3) || ($1 == "drop" && NF == 2) {
			if (!match($2, "_s[0-9]+$")) next
			suite = substr($2, RSTART + 1)
			if ($1 == "clone") {
				cloned[suite]++
				live++
				if (live > most) most = live
			} else {
				if (!(suite in cloned)) early[suite] = 1
				dropped[suite]++
				live--
			}
		}
		END {
			for (suite in cloned)
				printf "%s cloned %d, dropped %d%s\n", suite, cloned[suite], dropped[suite] + 0, (suite in early) ? ", dropped before it was cloned" : ""
			for (suite in early)
				if (!(suite in cloned)) printf "%s dropped before it was cloned\n", suite
			if (most > workers) printf "%d live at once, more than %d worker(s)\n", most, workers
			else printf "never more live than %d worker(s)\n", workers
		}
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

# --- Each test is capped ----------------------------------------------------
#
# The blocking suite settles on its own, later than the cap: uncapped it would
# pass, so a red worker here is the cap and nothing else.

fixture
blocking_suite "$R/test/postgres/slow.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS" CHUG_TEST_TIMEOUT_MS=500
check "a test past the cap turns its worker red" 1 "$RC" "timed out after 500ms"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" CHUG_TEST_TIMEOUT_MS=0
check "a cap that is no cap is a could-not-run" 2 "$RC" "no test can be capped"

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
# Three suites over two workers, so one worker takes two of them: what the
# helper log has to show is that each was cloned a database of its own rather
# than given another's, dropped once it ended, and that a worker dropped one
# before it cloned the next.

fixture
passing_suite "$R/test/postgres/one.test.ts"
passing_suite "$R/test/postgres/three.test.ts"
passing_suite "$R/test/postgres/two.test.ts"
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$HELPER_LOG" CHUG_PG_WORKERS=2
check "a run sharing suites over workers is clean" 0 "$RC" "3 suite(s) clean"
check "the clean line reports the workers that ran them" 0 "$RC" "with 2 worker(s)"
LIVES="$WORK/.lives"
suite_lives 2 >"$LIVES"
OUT="$LIVES"
check "the first suite is cloned a database of its own and it is dropped" 0 0 "s1 cloned 1, dropped 1"
check "so is the second" 0 0 "s2 cloned 1, dropped 1"
check "and the third" 0 0 "s3 cloned 1, dropped 1"
refute "no suite's database is dropped before it is cloned" 0 0 "before it was cloned"
check "a worker drops one before it clones the next" 0 0 "never more live than 2 worker(s)"

# --- The queue runs the largest suite first ----------------------------------
#
# One worker takes the queue in its order. The largest suite sorts last by
# name, and the two others are the same size, so their names are the tie.

fixture
recording_suite "$R/test/postgres/a.test.ts"
recording_suite "$R/test/postgres/b.test.ts"
recording_suite "$R/test/postgres/z.test.ts"
printf '/* %0400d */\n' 0 >>"$R/test/postgres/z.test.ts"
git -C "$R" add -A
RECORD="$WORK/.record"
: >"$RECORD"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "FIXTURE_RECORD=$RECORD" CHUG_PG_WORKERS=1
check "a run of one worker is clean" 0 "$RC" "3 suite(s) clean"
OUT="$WORK/.order"
tr '\n' ' ' <"$RECORD" >"$OUT"
check "the largest suite runs first and a tie runs in name order" 0 0 "z.test.ts a.test.ts b.test.ts"

# --- A worker free of the largest suite drains the rest of the queue ---------
#
# The largest suite passes only once every other suite has run, and two workers
# share the queue, so the other worker has to take all of them.

fixture
outlasting_suite "$R/test/postgres/long.test.ts"
for suite in one two three four; do
	recording_suite "$R/test/postgres/$suite.test.ts"
done
git -C "$R" add -A
: >"$RECORD"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "FIXTURE_RECORD=$RECORD" FIXTURE_OTHERS=4 CHUG_PG_WORKERS=2
check "a worker free of the largest suite runs every other one" 0 "$RC" \
	"5 suite(s) clean against the server CHUG_PG_URL names with 2 worker(s)"

# --- A suite no worker took is a could-not-run -------------------------------
#
# The one worker runs the largest suite first, and that suite claims the last
# place itself, so the suite there never runs and the run is not clean.

fixture
claiming_suite "$R/test/postgres/z.test.ts"
printf '/* %0400d */\n' 0 >>"$R/test/postgres/z.test.ts"
passing_suite "$R/test/postgres/a.test.ts"
passing_suite "$R/test/postgres/b.test.ts"
git -C "$R" add -A
TAKEN="$WORK/.taken"
mkdir -p "$TAKEN"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "TMPDIR=$TAKEN" CHUG_PG_WORKERS=1
check "a suite no worker took is a could-not-run" 2 "$RC" "2 of 3 suite(s) ran; no worker took the rest"

# --- Two runs holding one pid on one server share no name -------------------

fixture
passing_suite "$R/test/postgres/one.test.ts"
passing_suite "$R/test/postgres/two.test.ts"
git -C "$R" add -A
FIRST_LOG="$WORK/.helper-first"
SECOND_LOG="$WORK/.helper-second"
: >"$FIRST_LOG"
: >"$SECOND_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$FIRST_LOG" CHUG_PG_RUN_PID=4242
check "the first of two runs holding one pid is clean" 0 "$RC" "2 suite(s) clean"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$SECOND_LOG" CHUG_PG_RUN_PID=4242
check "the second of two runs holding one pid is clean" 0 "$RC" "2 suite(s) clean"
OUT="$SECOND_LOG"
check "the pid the seam holds is the one the names carry" 0 0 "prepare ignored_4242_"
names_shared "$FIRST_LOG" "$SECOND_LOG"
check "two runs holding one pid make and drop no name in common" 0 0 "the runs share no name"

# --- Two runs of different pids share no name either -------------------------

: >"$FIRST_LOG"
: >"$SECOND_LOG"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$FIRST_LOG" CHUG_PG_RUN_PID=4242
check "a run of one pid is clean" 0 "$RC" "2 suite(s) clean"
run_gate "$R" "CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$SECOND_LOG" CHUG_PG_RUN_PID=4343
check "a run of another pid is clean" 0 "$RC" "2 suite(s) clean"
names_shared "$FIRST_LOG" "$SECOND_LOG"
check "two runs of different pids make and drop no name in common" 0 0 "the runs share no name"

# --- The longest names the gate makes are ones PostgreSQL keeps whole --------
#
# One suite more than the most workers there can be, so every worker takes one
# and the last place in the queue is past the last worker, against a connected
# database whose name has to be digested to fit.

LONG_DATABASE="a_connected_database_named_long_enough_that_the_gate_has_to_digest_it_whole"
LONG_URL="${ANSWERS%/ignored}/$LONG_DATABASE"
fixture
suite=1
while [ "$suite" -le 17 ]; do
	passing_suite "$R/test/postgres/s$suite.test.ts"
	suite=$((suite + 1))
done
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$LONG_URL" "CHUG_PG_HELPER_LOG=$HELPER_LOG" CHUG_PG_WORKERS=16
check "a run at the most workers is clean" 0 "$RC" "17 suite(s) clean against the server CHUG_PG_URL names with 16 worker(s)"
OUT="$HELPER_LOG"
check "the last place in the queue clones a database" 0 0 "_s17 "
names_unfit "$HELPER_LOG"
check "every name the run made was checked" 0 0 "18 name(s) checked"
refute "and none is longer than PostgreSQL keeps whole" 0 0 "truncated:"

fixture
passing_suite "$R/test/postgres/one.test.ts"
git -C "$R" add -A
HELPER_LOG="$WORK/.helper"
: >"$HELPER_LOG"
run_gate "$R" "CHUG_PG_URL=$LONG_URL" "CHUG_PG_HELPER_LOG=$HELPER_LOG" \
	CHUG_PG_RUN_PID=4242424242424242424242424242
check "a name that would be truncated is a could-not-run" 2 "$RC" "longer than PostgreSQL keeps a name whole"
OUT="$HELPER_LOG"
refute "and nothing is made or dropped under it" 0 0 "_t"

done_ "check-postgres.test.sh"
