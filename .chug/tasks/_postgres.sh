# A PostgreSQL server for a gate to run against, acquired the same way for
# every gate that needs one.
#
# Contract for a sourcing gate (source as "$here/_postgres.sh" via a $here
# resolved from $0 before any cd, as `_suite.sh` prescribes for the suites —
# a relative $0 stops pointing here once the gate has cd'd; the sourcing gate
# sets its own shell options):
#   call      postgres_acquire <message prefix>
#   provides  $base_url   the URL a client should connect to
#             $subject    what the verdict line should name
#             $scratch    the per-run database, empty on a caller's server
#             $container  where a scratch database lives
#             postgres_drop_scratch   for the caller's EXIT trap
#   exits     2 through the caller's shell when no server can be had
#   claims    its working names — the knobs below, $pg_prefix, $waited,
#             $endpoint — in the sourcing gate's namespace
#
# THE SERVER IS A CONTAINER THE SOURCING GATES OWN. It is started under a name
# nothing else uses, on a port that is not the conventional one, so a
# developer's own PostgreSQL is never touched, never connected to and never
# dropped. A container already running under that name is reused rather than
# restarted, because a gate that pays a cold start on every run is a gate that
# gets bypassed.
#
# EACH RUN GETS ITS OWN DATABASE inside that container, dropped when the run
# ends via the trap the caller installs. Two runs share nothing, and a crashed
# run leaves no state the next one inherits.
#
# A CALLER-SUPPLIED SERVER IS USED WITHOUT A CONTAINER SCRATCH DATABASE.
# CHUG_PG_URL skips the container: the gates did not start that server, so they
# do not stop it. A sourcing gate may still create and remove databases when
# its own header says it does. The server is waited on first, because one that
# never answers is a run that never happened.
#
# A SERVER THAT DOES NOT ANSWER IS A COULD-NOT-RUN. The container branch waits
# on `pg_isready` before anything runs, and a caller's own server is probed for
# the same reason: a suite that could not connect did not execute, and calling
# that a red suite is a finding about a run that never happened. The probe
# opens a socket to the address the client will connect to, which is the `host`
# and `port` parameters where the URL carries them and the percent-decoded
# authority where it does not, so it is blind to a server that accepts and then
# refuses the credentials; and a URL naming no address to open one to — a local
# socket, however it is spelled, or not a URL at all — is run against rather
# than failed, because finding no address is not evidence that nothing is
# there.
#
# Env:
#   CHUG_PG_URL        run against this server instead, skipping the
#                      container entirely
#   CHUG_PG_IMAGE      the image to start
#   CHUG_PG_PORT       the host port to publish it on
#   CHUG_PG_READY_SECS how long to wait for the server to answer
#
# The container outlives the run so the next one is warm. To remove it:
#   docker rm -f chuggy-check-postgres

image="${CHUG_PG_IMAGE:-postgres:18-alpine}"
port="${CHUG_PG_PORT:-55432}"
ready_secs="${CHUG_PG_READY_SECS:-30}"
container="chuggy-check-postgres"
password="chuggy-check"
# How long one connect attempt may hang before the wait asks again.
probe_attempt_ms=1000

# Whether the URL names a server that answers, printing the host and port that
# were tried: a message may carry those, and not the rest of a URL, which is a
# password.
#
# The address is resolved the way the client resolves it: a `host` parameter
# with a value in it overrides the authority, and an authority that is not
# overridden is percent-decoded. Either may hold an absolute path, which is a
# unix socket rather than a machine, and is the second thing there is no
# address to open.
postgres_probe() { # <url> <milliseconds>
	node -e '
const net = require("node:net");
let at;
try {
  at = new URL(process.argv[1]);
} catch {
  process.exit(0);
}
let named = at.searchParams.get("host");
if (!named) {
  try {
    named = decodeURIComponent(at.hostname);
  } catch {
    named = at.hostname;
  }
}
const host = named.replace(/^\[|\]$/g, "");
if (host === "" || host.charAt(0) === "/") process.exit(0);
const port = Number(
  at.searchParams.get("port") || at.port || process.env.PGPORT || 5432,
);
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

postgres_acquire() { # <message prefix>
	pg_prefix="$1"

	if ! command -v node >/dev/null 2>&1; then
		echo "$pg_prefix: LINTER ERROR — no node, so nothing can run"
		exit 2
	fi

	if [ -n "${CHUG_PG_URL:-}" ]; then
		base_url="$CHUG_PG_URL"
		scratch=""
		subject="the server CHUG_PG_URL names"

		waited=0
		until endpoint="$(postgres_probe "$base_url" "$probe_attempt_ms")"; do
			if [ "$waited" -ge "$ready_secs" ]; then
				echo "$pg_prefix: LINTER ERROR — nothing answered at ${endpoint:-the address CHUG_PG_URL names} within ${ready_secs}s"
				echo "$pg_prefix:                Point CHUG_PG_URL at a server that is running, or unset it to use a container."
				exit 2
			fi
			sleep 1
			waited=$((waited + 1))
		done
	else
		if ! command -v docker >/dev/null 2>&1; then
			echo "$pg_prefix: LINTER ERROR — no docker, so no server can be started."
			echo "$pg_prefix:                Set CHUG_PG_URL to test against one you have."
			exit 2
		fi
		if ! docker info >/dev/null 2>&1; then
			echo "$pg_prefix: LINTER ERROR — docker is installed but not running."
			echo "$pg_prefix:                Set CHUG_PG_URL to test against a server you have."
			exit 2
		fi

		if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)" != "true" ]; then
			docker rm -f "$container" >/dev/null 2>&1 || true
			if ! docker run -d --name "$container" \
				-e POSTGRES_PASSWORD="$password" \
				-p "$port:5432" "$image" >/dev/null 2>&1; then
				echo "$pg_prefix: LINTER ERROR — could not start $image as $container"
				exit 2
			fi
			echo "$pg_prefix: started $container on port $port"
		else
			echo "$pg_prefix: reusing $container on port $port"
		fi
		# Read back from the container rather than from CHUG_PG_IMAGE, which
		# says what a fresh start would have used and not what a reused one is
		# running.
		subject="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || echo "$image")"

		waited=0
		until docker exec "$container" pg_isready -q -U postgres >/dev/null 2>&1; do
			if [ "$waited" -ge "$ready_secs" ]; then
				echo "$pg_prefix: LINTER ERROR — $container did not answer within ${ready_secs}s"
				exit 2
			fi
			sleep 1
			waited=$((waited + 1))
		done

		base_url="postgres://postgres:$password@127.0.0.1:$port/postgres"
		scratch="chuggy_check_$$"
		if ! docker exec "$container" psql -q -U postgres -c "CREATE DATABASE $scratch" >/dev/null 2>&1; then
			echo "$pg_prefix: LINTER ERROR — could not create the scratch database"
			exit 2
		fi
		base_url="postgres://postgres:$password@127.0.0.1:$port/$scratch"
	fi
}

postgres_drop_scratch() {
	[ -n "$scratch" ] || return 0
	docker exec "$container" psql -q -U postgres \
		-c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" >/dev/null 2>&1 || true
}
