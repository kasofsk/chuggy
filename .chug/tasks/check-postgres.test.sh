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
# the URL they pass names a socket this file opens, which answers the gate's
# reachability probe and nothing else: a fixture that needed a database to say
# anything about a script would leave a machine without one unable to check the
# script either.
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

# A socket that accepts and says nothing, which is all the gate's reachability
# probe asks of a caller-supplied server, and is not a database.
PORT_FILE="$WORK/.port"
node -e '
const fs = require("node:fs");
const net = require("node:net");
const server = net.createServer((socket) => socket.destroy());
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(process.argv[1], String(server.address().port));
});
' "$PORT_FILE" &
SOCKET=$!
# The harness removes $WORK on exit; this adds the socket to what goes with it.
trap 'kill "$SOCKET" 2>/dev/null || true; rm -rf "$WORK"' EXIT

SOCKET_WAIT_SECS=10
waited=0
until [ -s "$PORT_FILE" ]; do
	if [ "$waited" -ge "$SOCKET_WAIT_SECS" ]; then
		echo "check-postgres.test.sh: LINTER ERROR — the fixture socket never opened"
		exit 2
	fi
	sleep 1
	waited=$((waited + 1))
done
ANSWERS="postgres://fixture@127.0.0.1:$(cat "$PORT_FILE")/ignored"

# An address on the loopback that nothing is listening on, which is the shape of
# a URL naming a server that is not running.
SILENT="127.0.0.1:1"

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
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "a red suite is a finding" 1 "$RC" "the suite went red against the server CHUG_PG_URL names"

# --- A green run is clean, and says what it consumed --------------------------

fixture
passing_suite "$R/test/postgres/one.test.ts"
passing_suite "$R/test/postgres/two.test.ts"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "a green suite is clean" 0 "$RC" "clean against the server CHUG_PG_URL names"
check "the clean line counts the suites it ran" 0 "$RC" "2 suite(s) clean"

done_ "check-postgres.test.sh"
