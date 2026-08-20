#!/bin/sh
# The durable authority is tested against a real PostgreSQL, never a fake.
#
# WHAT THIS GATE EXISTS FOR. `src/adapters/postgres/` claims that competing
# owners serialize, that a fenced writer cannot commit, that a stale head is
# refused, that two projects do not block each other, and that the runtime role
# cannot rewrite history. Every one of those is a claim about what the server
# does. A fake would answer them by agreeing with the adapter, which is the
# shape of an unverified control: it reports success and is then believed.
#
# THE SERVER IS A CONTAINER THIS GATE OWNS. It is started under a name nothing
# else uses, on a port that is not the conventional one, so a developer's own
# PostgreSQL is never touched, never connected to and never dropped. A
# container already running under that name is reused rather than restarted,
# because a gate that pays a cold start on every run is a gate that gets
# bypassed.
#
# EACH RUN GETS ITS OWN DATABASE inside that container, dropped when the run
# ends. Cases share it deliberately — the subject is a partitioned store, so
# cases holding different partitions in one database exercise the isolation the
# port claims — but two runs of the gate share nothing, and a crashed run
# leaves no state the next one inherits.
#
# THE VERDICT NAMES WHAT THE RUN ACTUALLY USED. A line ending in the image this
# script would have started says nothing true when a caller supplied their own
# server, and says the wrong thing when a container started days ago on a
# different image is being reused. So the subject is read back from the
# container that answered, or names the variable that redirected the run.
#
# NO DOCKER IS A COULD-NOT-RUN, NOT A PASS. That is the whole reason the
# protocol has a third exit: a suite that did not execute has proved nothing,
# and saying so is the only honest verdict available.
#
# A SERVER THAT DOES NOT ANSWER IS THE SAME COULD-NOT-RUN. The container branch
# waits on `pg_isready` before it runs anything, and a caller's own server is
# probed for the same reason: a suite that could not connect did not execute
# either, and calling that a red suite is a finding about a run that never
# happened. The probe opens a socket to the host and port the URL names, so it
# is blind to a server that accepts and then refuses the credentials; and a URL
# naming no host to open one to — a local socket, or not a URL at all — is run
# against rather than failed, because finding no address is not evidence that
# nothing is there.
#
# THE CASES RUN ONE AT A TIME. They share a database and some of them establish
# a global recovery epoch, which is by design a fact about the whole database;
# running them concurrently would let one case fence another's lease and report
# it as the adapter's fault.
#
# Env:
#   CHUG_PG_URL        test against this server instead, skipping the
#                      container entirely
#   CHUG_PG_IMAGE      the image to start
#   CHUG_PG_PORT       the host port to publish it on
#   CHUG_PG_READY_SECS how long to wait for the server to answer
#
# Usage:
#   .chug/tasks/check-postgres.sh
#
# The container outlives the run so the next one is warm. To remove it:
#   docker rm -f chuggy-check-postgres
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-postgres: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

unset FORCE_COLOR
export NO_COLOR=1

image="${CHUG_PG_IMAGE:-postgres:18-alpine}"
port="${CHUG_PG_PORT:-55432}"
ready_secs="${CHUG_PG_READY_SECS:-30}"
container="chuggy-check-postgres"
password="chuggy-check"
# How long one connect attempt may hang before the wait asks again.
probe_attempt_ms=1000

if ! command -v node >/dev/null 2>&1; then
	echo "check-postgres: LINTER ERROR — no node, so nothing can run"
	exit 2
fi

suites="$(find test/postgres -maxdepth 1 -name '*.test.ts' 2>/dev/null | sort || true)"
if [ -z "$suites" ]; then
	echo "check-postgres: LINTER ERROR — no test/postgres suite; the glob matched nothing"
	exit 2
fi
suite_count="$(printf '%s\n' "$suites" | grep -c '' || true)"

# Whether the URL names a server that answers, printing the host and port that
# were tried: a message may carry those, and not the rest of a URL, which is a
# password.
postgres_probe() { # <url> <milliseconds>
	node -e '
const net = require("node:net");
let at;
try {
  at = new URL(process.argv[1]);
} catch {
  process.exit(0);
}
const host = at.hostname.replace(/^\[|\]$/g, "");
if (host === "") process.exit(0);
const port = Number(at.port || process.env.PGPORT || 5432);
process.stdout.write(host + ":" + String(port));
process.exitCode = 1;
const socket = net.connect(port, host);
socket.setTimeout(Number(process.argv[2]));
socket.on("connect", () => {
  process.exitCode = 0;
  socket.destroy();
});
socket.on("timeout", () => socket.destroy());
socket.on("error", () => socket.destroy());
' "$1" "$2"
}

# A caller-supplied server is used as it stands: this gate did not start it, so
# it does not stop it, and it creates no database inside it. It is still waited
# on, because a server that never answers is a run that never happened.
if [ -n "${CHUG_PG_URL:-}" ]; then
	base_url="$CHUG_PG_URL"
	scratch=""
	subject="the server CHUG_PG_URL names"

	waited=0
	until endpoint="$(postgres_probe "$base_url" "$probe_attempt_ms")"; do
		if [ "$waited" -ge "$ready_secs" ]; then
			echo "check-postgres: LINTER ERROR — nothing answered at ${endpoint:-the address CHUG_PG_URL names} within ${ready_secs}s"
			echo "check-postgres:                Point CHUG_PG_URL at a server that is running, or unset it to use a container."
			exit 2
		fi
		sleep 1
		waited=$((waited + 1))
	done
else
	if ! command -v docker >/dev/null 2>&1; then
		echo "check-postgres: LINTER ERROR — no docker, so no server can be started."
		echo "check-postgres:                Set CHUG_PG_URL to test against one you have."
		exit 2
	fi
	if ! docker info >/dev/null 2>&1; then
		echo "check-postgres: LINTER ERROR — docker is installed but not running."
		echo "check-postgres:                Set CHUG_PG_URL to test against a server you have."
		exit 2
	fi

	if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)" != "true" ]; then
		docker rm -f "$container" >/dev/null 2>&1 || true
		if ! docker run -d --name "$container" \
			-e POSTGRES_PASSWORD="$password" \
			-p "$port:5432" "$image" >/dev/null 2>&1; then
			echo "check-postgres: LINTER ERROR — could not start $image as $container"
			exit 2
		fi
		echo "check-postgres: started $container on port $port"
	else
		echo "check-postgres: reusing $container on port $port"
	fi
	# Read back from the container rather than from CHUG_PG_IMAGE, which says
	# what a fresh start would have used and not what a reused one is running.
	subject="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || echo "$image")"

	waited=0
	until docker exec "$container" pg_isready -q -U postgres >/dev/null 2>&1; do
		if [ "$waited" -ge "$ready_secs" ]; then
			echo "check-postgres: LINTER ERROR — $container did not answer within ${ready_secs}s"
			exit 2
		fi
		sleep 1
		waited=$((waited + 1))
	done

	base_url="postgres://postgres:$password@127.0.0.1:$port/postgres"
	scratch="chuggy_check_$$"
	if ! docker exec "$container" psql -q -U postgres -c "CREATE DATABASE $scratch" >/dev/null 2>&1; then
		echo "check-postgres: LINTER ERROR — could not create the scratch database"
		exit 2
	fi
	base_url="postgres://postgres:$password@127.0.0.1:$port/$scratch"
fi

drop_scratch() {
	[ -n "$scratch" ] || return 0
	docker exec "$container" psql -q -U postgres \
		-c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" >/dev/null 2>&1 || true
}
trap drop_scratch EXIT

set -f
IFS='
'
# shellcheck disable=SC2086 # the suite list is newline-split on purpose
set -- $suites
unset IFS
set +f

set +e
CHUG_PG_URL="$base_url" node --test --test-concurrency=1 --test-reporter=dot "$@"
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
	echo "check-postgres: FAILED — the suite went red against $subject"
	exit 1
fi

echo "check-postgres: $suite_count suite(s) clean against $subject"
