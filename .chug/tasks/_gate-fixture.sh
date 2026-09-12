# What a suite driving a server-acquiring gate needs of the world: a PATH with
# no docker on it, a socket that answers like a server, and the fixtures those
# cases write into a throwaway checkout.
#
# THE SERVERS ARE NEVER REAL HERE. What is under test in such a suite is the
# gate's sequencing and its verdict; the adapters are tested against real
# servers by the gates themselves. A fixture that needed a database to say
# anything about a script would leave a machine without one unable to check the
# script either.
#
# Contract for a sourcing suite (source after `_suite.sh`, whose $WORK this
# uses and whose EXIT trap this replaces to also kill the socket):
#   provides  $BIN      a directory holding node and the shell's own tools and
#                       no docker, for a case that runs the gate with PATH=$BIN
#             $ANSWERS  a postgres:// URL naming a socket that accepts and
#                       says nothing — enough for the reachability probe, and
#                       not a database
#             $SILENT   a loopback address nothing listens on
#             run_gate  run $SUT in a directory under named variables, into
#                       $OUT and $RC
#             passing_suite / failing_suite   a fixture suite at a path
#             database_helper_double          a stand-in for
#                       `postgres-databases.ts` in a fixture checkout, logging
#                       every call to $CHUG_PG_HELPER_LOG
#   expects   $SUT      the gate under test, for run_gate
#   exits     2 through the sourcing suite when the socket never opens

NODE_DIR="$(dirname "$(command -v node)")"
BIN="$WORK/bin"
mkdir -p "$BIN"
ln -sf "$NODE_DIR/node" "$BIN/node"
for tool in git find grep sort dirname mktemp sed; do
	if command -v "$tool" >/dev/null 2>&1; then
		ln -sf "$(command -v "$tool")" "$BIN/$tool"
	fi
done

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
		echo "${0##*/}: LINTER ERROR — the fixture socket never opened"
		exit 2
	fi
	sleep 1
	waited=$((waited + 1))
done
ANSWERS="postgres://fixture@127.0.0.1:$(cat "$PORT_FILE")/ignored"

# An address on the loopback that nothing is listening on, which is the shape
# of a URL naming a server that is not running.
SILENT="127.0.0.1:1"

run_gate() { # <dir> [env=value...]
	OUT="$WORK/.out"
	set +e
	(cd "$1" && shift && env "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

passing_suite() { # <path>
	cat >"$1" <<'TS'
import { test } from "node:test";
test("a fixture case that needs no server", () => undefined);
TS
}

failing_suite() { # <path>
	cat >"$1" <<'TS'
import assert from "node:assert/strict";
import { test } from "node:test";
test("a fixture case that fails on purpose", () => assert.fail("as designed"));
TS
}

# A stand-in for the database helper a gate shells out to, which records what
# it was asked and can be made to refuse one command. It is what lets a case
# assert the names a run made and the ones it removed without a server.
database_helper_double() { # <fixture repo>
	mkdir -p "$1/.chug/tasks"
	export CHUG_PG_HELPER_LOG="$WORK/.helper"
	: >"$CHUG_PG_HELPER_LOG"
	cat >"$1/.chug/tasks/postgres-databases.ts" <<'TS'
import { appendFileSync } from "node:fs";
const [command, , ...databases] = process.argv.slice(2);
appendFileSync(process.env.CHUG_PG_HELPER_LOG, `${command} ${databases.join(" ")}\n`);
if (process.env.CHUG_PG_HELPER_FAIL === command) process.exitCode = 1;
TS
}
