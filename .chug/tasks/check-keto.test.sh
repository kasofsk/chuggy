#!/bin/sh
# Shell test for check-keto.sh.
#
# WHAT IT HAS TO PROVE IS THAT ALL THREE EXITS ARE REACHABLE, because this gate
# needs two servers and "could not run" is the likely answer on a machine that
# has neither — and it is the answer most easily mistaken for a pass. So the
# cases drive a missing suite, a missing docker, a read URL with no write URL
# beside it, an authority that never answers, an authority that answers ready
# while carrying some other model, a database that cannot be prepared, and a
# red suite; each is required to answer with its own code.
#
# THE CASES SUPPLY THEIR OWN SERVERS AND THEIR FIXTURE SUITES IGNORE BOTH. What
# is under test is the gate's sequencing and its verdict, not the adapter — the
# adapter is tested against a real Keto by the gate itself. So the authority
# here is a few lines of node answering the two paths the wait asks for, and
# the database URL names a socket that accepts and says nothing.
#
# THE MODEL CASE IS THE ONE THAT MATTERS MOST. A server carrying the wrong
# namespaces answers every check `false`, so a gate that waited on readiness
# alone would run a whole suite of refusals and report them as findings about
# the adapter. The case drives an authority that is ready and knows only one of
# the two namespaces, and requires a could-not-run.
#
# Run:  .chug/tasks/check-keto.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-keto.sh"
R="$WORK/repo"

. "$HERE/_gate-fixture.sh"

KETO_PORT_FILE="$WORK/.keto-port"
# An authority answering the two paths `_keto.sh` waits on, and nothing else.
# The namespaces it admits are its argument, so a case can produce a server
# that is ready and carries some other model.
keto_double() { # <namespace>...
	rm -f "$KETO_PORT_FILE"
	node -e '
const fs = require("node:fs");
const http = require("node:http");
const known = new Set(process.argv.slice(2));
const server = http.createServer((request, response) => {
  const at = new URL(request.url, "http://127.0.0.1");
  if (at.pathname === "/health/ready") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (at.pathname === "/relation-tuples") {
    const namespace = at.searchParams.get("namespace") ?? "";
    response.writeHead(known.has(namespace) ? 200 : 404, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(known.has(namespace) ? { relation_tuples: [] } : {}));
    return;
  }
  response.writeHead(404);
  response.end("{}");
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(process.argv[1], String(server.address().port));
});
' "$KETO_PORT_FILE" "$@" &
	KETO_DOUBLE=$!
	waited=0
	until [ -s "$KETO_PORT_FILE" ]; do
		if [ "$waited" -ge 10 ]; then
			echo "check-keto.test.sh: LINTER ERROR — the fixture authority never opened"
			exit 2
		fi
		sleep 1
		waited=$((waited + 1))
	done
	KETO_ANSWERS="http://127.0.0.1:$(cat "$KETO_PORT_FILE")/"
}

keto_double_stop() {
	[ -n "${KETO_DOUBLE:-}" ] || return 0
	kill "$KETO_DOUBLE" 2>/dev/null || true
	wait "$KETO_DOUBLE" 2>/dev/null || true
	KETO_DOUBLE=""
}

fixture() { # a throwaway repo with a test/keto directory
	fresh_repo "$R"
	mkdir -p "$R/test/keto"
	database_helper_double "$R"
}

# --- A suite that is not there is a could-not-run ----------------------------

fresh_repo "$R"
git -C "$R" add -A 2>/dev/null || true
run_gate "$R" "CHUG_KETO_READ_URL=http://127.0.0.1:1/" \
	"CHUG_KETO_WRITE_URL=http://127.0.0.1:1/" "CHUG_PG_URL=$ANSWERS"
check "no test/keto directory is a could-not-run" 2 "$RC" "the glob matched nothing"

# --- No authority and no way to start one is a could-not-run -----------------
#
# The gate is run with a PATH holding node and the shell's own tools and no
# docker, and with both URLs emptied rather than inherited: an operator who had
# set them would otherwise send this case down the branch it exists to avoid.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
run_gate "$R" "PATH=$BIN" HOME="$HOME" CHUG_KETO_READ_URL= CHUG_KETO_WRITE_URL=
check "no docker and no URL is a could-not-run" 2 "$RC" "no docker"

# --- A read URL with no write URL beside it is a could-not-run ---------------

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_KETO_READ_URL=http://127.0.0.1:1/" CHUG_KETO_WRITE_URL= \
	"CHUG_PG_URL=$ANSWERS"
check "a read URL alone is a could-not-run" 2 "$RC" "no CHUG_KETO_WRITE_URL beside it"

# --- An authority that does not answer is a could-not-run --------------------
#
# The wait is set to nothing, so the case proves the verdict rather than the
# patience.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_KETO_READ_URL=http://$SILENT/" "CHUG_KETO_WRITE_URL=http://$SILENT/" \
	"CHUG_PG_URL=$ANSWERS" CHUG_KETO_READY_SECS=0
check "an authority nothing answers is a could-not-run" 2 "$RC" "within 0s"

# --- An authority carrying some other model is a could-not-run ---------------

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_double Project
run_gate "$R" "CHUG_KETO_READ_URL=$KETO_ANSWERS" "CHUG_KETO_WRITE_URL=$KETO_ANSWERS" \
	"CHUG_PG_URL=$ANSWERS" CHUG_KETO_READY_SECS=0
keto_double_stop
check "an authority missing a namespace is a could-not-run" 2 "$RC" "namespaces.ts"

# --- A database that cannot be prepared is a could-not-run -------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_double Project Tenant
run_gate "$R" "CHUG_KETO_READ_URL=$KETO_ANSWERS" "CHUG_KETO_WRITE_URL=$KETO_ANSWERS" \
	"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG" \
	CHUG_PG_HELPER_FAIL=prepare
keto_double_stop
check "a database that cannot be prepared is a could-not-run" 2 "$RC" "could not prepare the database"
OUT="$CHUG_PG_HELPER_LOG"
check "a partial preparation still removes its database" 0 0 "drop chuggy_keto_"

# --- A red suite is a finding ------------------------------------------------

fixture
failing_suite "$R/test/keto/red.test.ts"
git -C "$R" add -A
keto_double Project Tenant
run_gate "$R" "CHUG_KETO_READ_URL=$KETO_ANSWERS" "CHUG_KETO_WRITE_URL=$KETO_ANSWERS" \
	"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG"
keto_double_stop
check "a red suite is a finding" 1 "$RC" "a suite went red against the server CHUG_KETO_READ_URL names"
OUT="$CHUG_PG_HELPER_LOG"
check "a red run still removes its database" 0 0 "drop chuggy_keto_"

# --- A green run is clean, and says what it consumed -------------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
passing_suite "$R/test/keto/two.test.ts"
git -C "$R" add -A
keto_double Project Tenant
run_gate "$R" "CHUG_KETO_READ_URL=$KETO_ANSWERS" "CHUG_KETO_WRITE_URL=$KETO_ANSWERS" \
	"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG"
keto_double_stop
check "a green run is clean" 0 "$RC" "2 suite(s) clean"
check "the clean line names both servers it used" 0 "$RC" \
	"against the server CHUG_KETO_READ_URL names and the server CHUG_PG_URL names"
OUT="$CHUG_PG_HELPER_LOG"
check "a green run prepares one database and drops it" 0 0 "prepare chuggy_keto_"
check "a green run removes its database" 0 0 "drop chuggy_keto_"

done_ "check-keto.test.sh"
