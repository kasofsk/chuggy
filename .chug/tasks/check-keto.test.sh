#!/bin/sh
# Shell test for check-keto.sh.
#
# WHAT IT HAS TO PROVE IS THAT ALL THREE EXITS ARE REACHABLE, because this gate
# needs two servers and "could not run" is the likely answer on a machine that
# has neither — and it is the answer most easily mistaken for a pass. So the
# cases drive a missing suite, a machine with neither docker nor a keto, a read
# URL with no write URL beside it, an authority that never answers, an
# authority that answers ready while carrying some other model, a database that
# cannot be prepared, and a red suite; each is required to answer with its own
# code.
#
# THE CASES SUPPLY THEIR OWN SERVERS AND THEIR FIXTURE SUITES IGNORE BOTH. What
# is under test is the gate's sequencing and its verdict, not the adapter — the
# adapter is tested against a real Keto by the gate itself. So the authority
# here is a few lines of node answering the two paths the wait asks for, and
# the database URL names a socket that accepts and says nothing.
#
# THE KETO ON PATH IS A DOUBLE AS WELL: a script that states a version, records
# what it was started with and then is that same authority on the port it was
# told. Its cases hold the process to what the container is held to — this
# tree's model, ports of its own, a wait that needs every namespace — and to
# what only a process owes: loopback, an environment of its own, ports it can
# bind and no outgoing connection is given, a failure that says what is known
# of it, and being gone when the run ends, however the run ends.
#
# THE MODEL CASE IS THE ONE THAT MATTERS MOST. A server carrying the wrong
# namespaces answers every check `false`, so a gate that waited on readiness
# alone would run a whole suite of refusals and report them as findings about
# the adapter. The cases drive an authority that is ready and lacks one of the
# namespaces, and require a could-not-run.
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
# that is ready and carries some other model. Told a port something else holds,
# or told with `refused=<port>` that it could not have another, it stays up and
# silent and says why only as it is stopped, which is what Keto does.
AUTHORITY="$WORK/authority.cjs"
cat >"$AUTHORITY" <<'JS'
const fs = require("node:fs");
const http = require("node:http");
const [portFile, port, ...namespaces] = process.argv.slice(2);
const known = new Set(namespaces);
const refuse = (at) => `unable to listen on "127.0.0.1:${at}": address already in use`;
const told = namespaces.find((name) => name.startsWith("refused="));
let refusal = told ? refuse(told.slice("refused=".length)) : "";
process.on("SIGTERM", () => {
  if (refusal) console.error(refusal);
  process.exit(refusal ? 1 : 0);
});
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
server.on("error", () => {
  refusal = refuse(port);
  setInterval(() => undefined, 1000);
});
server.listen(Number(port), "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
});
JS

# The port a fixture started in the background wrote to that file, as $KETO_PORT.
port_written() { # <what the fixture is>
	waited=0
	until [ -s "$KETO_PORT_FILE" ]; do
		if [ "$waited" -ge 10 ]; then
			echo "check-keto.test.sh: LINTER ERROR — the fixture $1 never opened"
			exit 2
		fi
		sleep 1
		waited=$((waited + 1))
	done
	KETO_PORT="$(cat "$KETO_PORT_FILE")"
}

keto_double() { # <namespace>...
	rm -f "$KETO_PORT_FILE"
	node "$AUTHORITY" "$KETO_PORT_FILE" 0 "$@" &
	KETO_DOUBLE=$!
	port_written authority
	KETO_ANSWERS="http://127.0.0.1:$KETO_PORT/"
}

keto_double_stop() {
	[ -n "${KETO_DOUBLE:-}" ] || return 0
	kill "$KETO_DOUBLE" 2>/dev/null || true
	wait "$KETO_DOUBLE" 2>/dev/null || true
	KETO_DOUBLE=""
}

# One end of a loopback connection, on a port the kernel gave it as it gives any
# client one: `open`, or `closed` by this end first, which leaves the port held
# for a while with nothing connected to it. Nothing listens on it either way.
# `stopped` is the other end's port: a listener that closed a connection it had
# accepted and then stopped, which holds its port the same way, but as a
# listener's port is held, so that the next listener may have it.
PORT_END="$WORK/port-end.cjs"
cat >"$PORT_END" <<'JS'
const fs = require("node:fs");
const net = require("node:net");
const [portFile, state] = process.argv.slice(2);
const held = (port) => fs.writeFileSync(portFile, String(port));
const server = net.createServer((accepted) => {
  accepted.resume();
  if (state !== "stopped") return;
  const { port } = server.address();
  accepted.on("close", () => server.close(() => held(port)));
  accepted.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1", () => {
    const port = client.localPort;
    if (state === "open") held(port);
    if (state === "closed") {
      client.on("close", () => held(port));
      client.end();
    }
  });
  client.resume();
});
JS

port_end() { # <open|closed|stopped>
	rm -f "$KETO_PORT_FILE"
	node "$PORT_END" "$KETO_PORT_FILE" "$1" &
	PORT_END_HELD=$!
	port_written connection
}

port_end_stop() {
	kill "$PORT_END_HELD" 2>/dev/null || true
	wait "$PORT_END_HELD" 2>/dev/null || true
}

# A loopback port nothing holds.
free_port() {
	node -e '
const server = require("node:net").createServer();
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
  server.close();
});
'
}

# The lowest port the kernel hands an outgoing connection on this box, and its
# default where the box does not say.
LOWEST_OUTGOING="$(sed -n 's/^\([0-9][0-9]*\).*/\1/p' /proc/sys/net/ipv4/ip_local_port_range 2>/dev/null || true)"
LOWEST_OUTGOING="${LOWEST_OUTGOING:-32768}"

port_place() { # <port, or nothing>
	if [ -z "$1" ]; then
		echo "not named"
	elif [ "$1" -ge "$LOWEST_OUTGOING" ]; then
		echo "one an outgoing connection is given"
	elif [ "$1" -eq 4466 ] || [ "$1" -eq 4467 ]; then
		echo "a conventional one"
	else
		echo "its own"
	fi
}

fixture() { # a throwaway repo with a test/keto directory and a model
	fresh_repo "$R"
	mkdir -p "$R/test/keto" "$R/.chug/tasks/keto"
	printf 'dsn: memory\n' >"$R/.chug/tasks/keto/keto.yml"
	printf 'class Project {}\n' >"$R/.chug/tasks/keto/namespaces.ts"
	database_helper_double "$R"
}

# A docker whose containers are one label in a file: enough to answer the three
# questions the acquire asks it, to record what it was told to start, and to
# refuse the start when CHUG_DOCKER_FAIL says so.
docker_double() { # <label the container is running under, or empty for none>
	DOCKER_BIN="$WORK/dockerbin"
	DOCKER_LOG="$WORK/.docker"
	DOCKER_LABEL="$WORK/.docker-label"
	mkdir -p "$DOCKER_BIN"
	: >"$DOCKER_LOG"
	printf '%s' "$1" >"$DOCKER_LABEL"
	cat >"$DOCKER_BIN/docker" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >>"$CHUG_DOCKER_LOG"
label="$(cat "$CHUG_DOCKER_LABEL")"
case "$1" in
inspect)
	case "$3" in
	*State.Running*)
		if [ -n "$label" ]; then echo true; else echo false; fi
		;;
	*Config.Labels*)
		if [ -z "$label" ]; then exit 1; fi
		echo "$label"
		;;
	*) echo "$CHUG_DOCKER_IMAGE" ;;
	esac
	;;
run)
	if [ "${CHUG_DOCKER_FAIL-}" = run ]; then exit 1; fi
	for arg in "$@"; do
		case "$arg" in
		chuggy.keto.model=*) printf '%s' "${arg#chuggy.keto.model=}" >"$CHUG_DOCKER_LABEL" ;;
		esac
	done
	;;
rm) : >"$CHUG_DOCKER_LABEL" ;;
esac
exit 0
SH
	chmod +x "$DOCKER_BIN/docker"
}

# The gate against the doubled docker, with the authority double standing in
# for the container it believes it started.
run_gate_over_docker() { # [env=value...]
	run_gate "$R" "PATH=$DOCKER_BIN:$PATH" "CHUG_DOCKER_LOG=$DOCKER_LOG" \
		"CHUG_DOCKER_LABEL=$DOCKER_LABEL" CHUG_DOCKER_IMAGE=oryd/keto:fixture \
		"CHUG_KETO_READ_PORT=$KETO_PORT" "CHUG_KETO_WRITE_PORT=$KETO_PORT" \
		CHUG_KETO_READ_URL= CHUG_KETO_WRITE_URL= \
		"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG" "$@"
}

# A keto on a PATH that holds no docker, beside the tools the gate needs there.
# It is started with no PATH of its own, so everything it reaches is beside it:
# the authority above, which it becomes on the port it is told when it is given
# namespaces to admit, and a record of what it was started with. Given none, it
# says why and stops. With a file named `unbound` beside it, it is a Keto that
# could not bind its read port: only its write API is there.
keto_binary_double() { # [<namespace>...]
	KETO_BIN="$WORK/ketobin"
	KETO_STARTED="$KETO_BIN/started"
	rm -rf "$KETO_BIN"
	mkdir -p "$KETO_BIN"
	for tool in env rm sleep tail tr; do
		ln -sf "$(command -v "$tool")" "$KETO_BIN/$tool"
	done
	ln -sf "$NODE_DIR/node" "$KETO_BIN/node"
	ln -sf "$AUTHORITY" "$KETO_BIN/authority.cjs"
	: >"$KETO_STARTED"
	printf '%s\n' "$*" >"$KETO_BIN/namespaces"
	cat >"$KETO_BIN/keto" <<'SH'
#!/bin/sh
here="${0%/*}"
if [ "$1" = version ]; then
	printf 'Version:\t\t\tv0.0.0-fixture\n'
	exit 0
fi
{
	echo "pid $$"
	echo "arguments $*"
	echo "model ${NAMESPACES_LOCATION-}"
	echo "read ${SERVE_READ_HOST-}:${SERVE_READ_PORT-}"
	echo "write ${SERVE_WRITE_HOST-}:${SERVE_WRITE_PORT-}"
	echo "metrics ${SERVE_METRICS_HOST-}:${SERVE_METRICS_PORT-}"
	echo "language ${SERVE_OPL_HOST-}:${SERVE_OPL_PORT-}"
	echo "store ${DSN-the one the configuration names}"
} >>"$here/started"
read -r namespaces <"$here/namespaces"
if [ -z "$namespaces" ]; then
	echo "fixture keto: no model it can compile" >&2
	exit 1
fi
if [ -e "$here/unbound" ]; then
	exec "$here/node" "$here/authority.cjs" "$here/port" "$SERVE_WRITE_PORT" "refused=$SERVE_READ_PORT"
fi
# shellcheck disable=SC2086 # the namespaces are space-separated by construction
exec "$here/node" "$here/authority.cjs" "$here/port" "$SERVE_READ_PORT" $namespaces
SH
	chmod +x "$KETO_BIN/keto"
	KETO_PORT="$(free_port)"
}

# The node beside that keto, recording what the gate asked with it: the operands
# after each inline script, one question to a line. What the gate tests before
# a start and waits on after it is then read where it is asked, and not off the
# line the gate prints about it.
node_recording() {
	KETO_ASKED="$KETO_BIN/asked"
	: >"$KETO_ASKED"
	rm -f "$KETO_BIN/node"
	cat >"$KETO_BIN/node" <<SH
#!/bin/sh
if [ "\$1" = -e ]; then
	script="\$2"
	shift 2
	printf '%s\n' "\$*" >>"$KETO_ASKED"
	set -- -e "\$script" "\$@"
fi
exec "$NODE_DIR/node" "\$@"
SH
	chmod +x "$KETO_BIN/node"
}

# The gate with that keto on its PATH and no docker, on a port nothing holds
# unless the case has put something there.
run_gate_over_binary() { # [env=value...]
	run_gate "$R" "PATH=$KETO_BIN:$BIN" \
		"CHUG_KETO_READ_PORT=$KETO_PORT" "CHUG_KETO_WRITE_PORT=$KETO_PORT" \
		CHUG_KETO_READ_URL= CHUG_KETO_WRITE_URL= \
		"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG" "$@"
}

# Whether the keto the last run started is still running, as a line in $OUT. One
# that is, is stopped here, so a failing case leaves nothing behind it.
keto_binary_left() {
	started_pid="$(sed -n 's/^pid //p' "$KETO_STARTED" | head -1)"
	[ -n "$started_pid" ] || { echo "check-keto.test.sh: LINTER ERROR — no keto was started"; exit 2; }
	OUT="$WORK/.left"
	if kill -0 "$started_pid" 2>/dev/null; then
		kill "$started_pid" 2>/dev/null || true
		echo "the keto outlived the run" >"$OUT"
	else
		echo "the keto was stopped" >"$OUT"
	fi
}

# --- A suite that is not there is a could-not-run ----------------------------

fresh_repo "$R"
git -C "$R" add -A 2>/dev/null || true
run_gate "$R" "CHUG_KETO_READ_URL=http://127.0.0.1:1/" \
	"CHUG_KETO_WRITE_URL=http://127.0.0.1:1/" "CHUG_PG_URL=$ANSWERS"
check "no test/keto directory is a could-not-run" 2 "$RC" "the glob matched nothing"

# --- No authority and no way to start one is a could-not-run -----------------
#
# The gate is run with a PATH holding node and the shell's own tools and
# neither docker nor a keto, and with both URLs emptied rather than inherited:
# an operator who had set them would otherwise send this case down the branch
# it exists to avoid.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
run_gate "$R" "PATH=$BIN" HOME="$HOME" CHUG_KETO_READ_URL= CHUG_KETO_WRITE_URL=
check "no docker, no keto and no URL is a could-not-run" 2 "$RC" "no docker and no keto on PATH"

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

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_double Project Tenant
run_gate "$R" "CHUG_KETO_READ_URL=$KETO_ANSWERS" "CHUG_KETO_WRITE_URL=$KETO_ANSWERS" \
	"CHUG_PG_URL=$ANSWERS" CHUG_KETO_READY_SECS=0
keto_double_stop
check "an authority missing the site's namespace is a could-not-run" 2 "$RC" "namespaces.ts"

# --- A database that cannot be prepared is a could-not-run -------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_double Project Tenant Site
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
keto_double Project Tenant Site
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
keto_double Project Tenant Site
run_gate "$R" "CHUG_KETO_READ_URL=$KETO_ANSWERS" "CHUG_KETO_WRITE_URL=$KETO_ANSWERS" \
	"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG"
keto_double_stop
check "a green run is clean" 0 "$RC" "2 suite(s) clean"
check "the clean line names both servers it used" 0 "$RC" \
	"against the server CHUG_KETO_READ_URL names and the server CHUG_PG_URL names"
OUT="$CHUG_PG_HELPER_LOG"
check "a green run prepares one database and drops it" 0 0 "prepare chuggy_keto_"
check "a green run removes its database" 0 0 "drop chuggy_keto_"

# --- A container started from another model is started again -----------------
#
# Keto compiles the model at start-up, so a container that outlived an edit to
# `keto/namespaces.ts` answers about the model it booted with. The label is
# what makes that visible, and these two cases are the two answers it decides:
# a container whose label is not this model's digest is replaced, and one whose
# label is is reused.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_double Project Tenant Site
docker_double "the digest of some earlier model"
run_gate_over_docker
keto_double_stop
check "a container started from another model is not reused" 0 "$RC" "carries another model"
OUT="$DOCKER_LOG"
check "the container carrying it is removed" 0 0 "rm -f chuggy-check-keto"
check "a container is published on the ports the knobs name" 0 0 "-p $KETO_PORT:4466 -p $KETO_PORT:4467"
check "the model a container starts from is a label on it" 0 0 "--label chuggy.keto.model="

# --- A container started from this model is reused ---------------------------
#
# The digest is read off what the run above started rather than restated here,
# so the case cannot agree with a second copy of the algorithm.

STARTED_FROM="$(sed -n 's/.*--label chuggy\.keto\.model=\([0-9a-f]*\).*/\1/p' "$DOCKER_LOG" | head -1)"
[ -n "$STARTED_FROM" ] || { echo "check-keto.test.sh: LINTER ERROR — nothing was started with a model label"; exit 2; }
keto_double Project Tenant Site
docker_double "$STARTED_FROM"
run_gate_over_docker
keto_double_stop
check "a container started from this model is reused" 0 "$RC" "reusing chuggy-check-keto"
OUT="$DOCKER_LOG"
refute "a reused container is not started again" 0 0 "--label chuggy.keto.model="

# --- A container that never answers is a could-not-run -----------------------
#
# The container branch has a wait of its own, and its failure is the one the
# gate's header is about: the suites would otherwise run against a server that
# never came up and their refusals would be reported as findings about the
# adapter. The double starts nothing, so the port the gate then waits on is a
# port nothing is listening on.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
docker_double ""
KETO_PORT=1
run_gate_over_docker
check "a container that never answers is a could-not-run" 2 "$RC" "did not answer ready with every namespace"

# --- A container that cannot be started is a could-not-run --------------------
#
# It is asked for with no port named, so what the double records is where a
# container goes by default: where the one every worktree on a box shares is
# already published. The start is refused so that nothing waits on that port,
# which on such a box answers.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
docker_double ""
run_gate_over_docker CHUG_KETO_READ_PORT= CHUG_KETO_WRITE_PORT= CHUG_DOCKER_FAIL=run
check "a container that cannot be started is a could-not-run" 2 "$RC" "as chuggy-check-keto"
OUT="$DOCKER_LOG"
check "a container's ports are the ones the shared one is published on" 0 0 \
	"-p 54466:4466 -p 54467:4467"

# --- No model to start a container from is a could-not-run -------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
rm -rf "$R/.chug/tasks/keto"
git -C "$R" add -A
keto_double Project Tenant Site
docker_double ""
run_gate_over_docker
keto_double_stop
check "no model to start an authority from is a could-not-run" 2 "$RC" "no model to start an authority from"

# --- With no docker, the keto on PATH is the server --------------------------
#
# The caller's environment names a store, because Keto reads its whole
# configuration from the environment as readily as from the file: a store
# named there would be the one the gate's server wrote its tuples to.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
ROOT="$(git -C "$R" rev-parse --show-toplevel)"
keto_binary_double Project Tenant Site
run_gate_over_binary DSN=postgres://somebody@127.0.0.1/theirs
check "with no docker the keto on PATH is the server" 0 "$RC" "started keto v0.0.0-fixture from PATH on ports $KETO_PORT and $KETO_PORT"
check "the clean line names the version the binary states" 0 "$RC" \
	"1 suite(s) clean against keto v0.0.0-fixture from PATH and the server CHUG_PG_URL names"
keto_binary_left
check "a keto started for a run is stopped when the run ends" 0 0 "the keto was stopped"
OUT="$KETO_STARTED"
check "the keto is started from this tree's configuration" 0 0 \
	"arguments serve --sqa-opt-out -c $ROOT/.chug/tasks/keto/keto.yml"
check "the keto is pointed at this tree's model" 0 0 \
	"model file://$ROOT/.chug/tasks/keto/namespaces.ts"
check "its read API is on loopback, at the port the knob names" 0 0 "read 127.0.0.1:$KETO_PORT"
check "its write API is on loopback, at the port the knob names" 0 0 "write 127.0.0.1:$KETO_PORT"
check "its metrics are on loopback, at a port nothing else was promised" 0 0 "metrics 127.0.0.1:0"
check "its language server is on loopback, at a port nothing else was promised" 0 0 "language 127.0.0.1:0"
check "nothing the caller's environment names reaches the keto" 0 0 \
	"store the one the configuration names"

# --- A keto started before a server that never answers is still stopped ------
#
# The database is asked for after the authority, so this is the exit that
# finds a process already running and nothing yet made.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project Tenant Site
run_gate_over_binary "CHUG_PG_URL=postgres://fixture@$SILENT/ignored" CHUG_PG_READY_SECS=0
check "a database nothing answers is a could-not-run behind a started keto" 2 "$RC" "nothing answered at $SILENT"
keto_binary_left
check "the keto started before it is stopped" 0 0 "the keto was stopped"

# --- A keto that will not start is a could-not-run ---------------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double
run_gate_over_binary CHUG_KETO_READY_SECS=1
check "a keto that will not start is a could-not-run" 2 "$RC" \
	"keto v0.0.0-fixture from PATH did not answer ready with every namespace within 1s"
check "the message says what was tried before it" 2 "$RC" \
	"No CHUG_KETO_READ_URL and no docker, so $KETO_BIN/keto was started from $ROOT/.chug/tasks/keto."
check "the message says it exited, and with what" 2 "$RC" "It exited with status 1."
check "the message carries the last the keto said" 2 "$RC" "fixture keto: no model it can compile"

# --- A keto that starts without the model is a could-not-run -----------------
#
# The wait is long enough for the double to be listening, so what refuses the
# run is the namespace it does not carry and not a server that is not up yet.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project
run_gate_over_binary CHUG_KETO_READY_SECS=2
check "a keto missing a namespace is a could-not-run" 2 "$RC" \
	"did not answer ready with every namespace within 2s"
check "the message says it is running and which of its APIs answer" 2 "$RC" \
	"It is still running: its read API answers ready and its write API answers ready."
refute "a keto that said nothing is not reported for its silence" 2 "$RC" " said"
keto_binary_left
check "a keto that never answered is stopped" 0 0 "the keto was stopped"

# --- A keto that could not bind its read port is a could-not-run -------------
#
# A port taken between the test and the start is one no test refuses. Keto
# then stays up and serves its write API, and the reason is in its log only
# once it has been stopped.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project Tenant Site
: >"$KETO_BIN/unbound"
run_gate_over_binary "CHUG_KETO_WRITE_PORT=$(free_port)" CHUG_KETO_READY_SECS=2
check "a keto without its read API is a could-not-run that says which API answers" 2 "$RC" \
	"It is still running: its read API does not answer ready and its write API answers ready."
check "the message carries what the keto said only as it was stopped" 2 "$RC" \
	"unable to listen on \"127.0.0.1:$KETO_PORT\""
keto_binary_left
check "a keto without its read API is stopped" 0 0 "the keto was stopped"

# --- A keto started for a run has ports no outgoing connection is given ------
#
# No port is named, so the ports are the process's own, and each is read where
# it is used: what the keto was told, what the gate asked before the start and
# after it, and what it printed. The keto is one that stops without listening,
# so two checkouts running this suite at once meet on those ports only for the
# instant the gate's own test takes, and a run refused in that instant is run
# again.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double
node_recording
attempts=0
while :; do
	: >"$KETO_STARTED"
	: >"$KETO_ASKED"
	run_gate_over_binary CHUG_KETO_READ_PORT= CHUG_KETO_WRITE_PORT= CHUG_KETO_READY_SECS=0
	attempts=$((attempts + 1))
	if grep -q "pid " "$KETO_STARTED" || [ "$attempts" -ge 10 ]; then
		break
	fi
	sleep 1
done
PROCESS_PORTS="$(sed -n 's/.* on ports \([0-9]*\) and \([0-9]*\).*/\1 \2/p' "$OUT" | head -1)"
READ_PORT="${PROCESS_PORTS% *}"
WRITE_PORT="${PROCESS_PORTS#* }"
OUT="$WORK/.ports"
{
	echo "the read port is $(port_place "$READ_PORT"): $READ_PORT"
	echo "the write port is $(port_place "$WRITE_PORT"): $WRITE_PORT"
	echo "told $(sed -n 's/^read 127\.0\.0\.1://p' "$KETO_STARTED") and $(sed -n 's/^write 127\.0\.0\.1://p' "$KETO_STARTED")."
	echo "asked $(sort -u "$KETO_ASKED" | tr '\n' ';')"
} >"$OUT"
check "a keto's read port is one no outgoing connection is given" 2 "$RC" "the read port is its own"
check "a keto's write port is one no outgoing connection is given" 2 "$RC" "the write port is its own"
check "the keto is told the two ports the gate names" 2 "$RC" "told $READ_PORT and $WRITE_PORT."
check "the gate tests those two ports, waits on the read one and asks about no other" 2 "$RC" \
	"asked $READ_PORT;$WRITE_PORT;http://127.0.0.1:$READ_PORT/ Project Tenant Site;"

# --- A port something already listens on is a could-not-run ------------------
#
# What holds the port here carries the whole model, so a gate that started its
# keto regardless would wait, be answered, and report a clean run against a
# server it did not start.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project Tenant Site
keto_double Project Tenant Site
run_gate_over_binary
keto_double_stop
check "a port something already listens on is a could-not-run" 2 "$RC" \
	"something is already listening on port $KETO_PORT"
OUT="$KETO_STARTED"
refute "no keto is started on a port something holds" 0 0 "pid "

# --- A port one end of a connection is on is a could-not-run -----------------
#
# Nothing listens on such a port, so a test that asked whether something
# accepts there would read it as free, and the keto started on it could not
# bind it. One case holds the read port and the other the write port, each
# beside a port nothing holds. The wait is set to nothing so that a gate which
# did start one is told apart by its verdict and not by its patience.

for held in "open READ WRITE" "closed WRITE READ"; do
	# shellcheck disable=SC2086 # the three words are space-separated by construction
	set -- $held
	fixture
	passing_suite "$R/test/keto/one.test.ts"
	git -C "$R" add -A
	keto_binary_double Project Tenant Site
	port_end "$1"
	run_gate_over_binary "CHUG_KETO_${2}_PORT=$KETO_PORT" "CHUG_KETO_${3}_PORT=$(free_port)" \
		CHUG_KETO_READY_SECS=0
	port_end_stop
	check "a port a connection's own end is on, $1, is a could-not-run" 2 "$RC" \
		"port $KETO_PORT cannot be listened on (EADDRINUSE), and nothing listens there to stop."
	OUT="$KETO_STARTED"
	refute "no keto is started beside a port a connection's end is on, $1" 0 0 "pid "
done

# --- The port of a listener stopped a moment ago is one a keto can have ------
#
# A keto the run before stopped leaves its own ends of the connections it had
# accepted on its ports for a while, and Keto binds over them. A test that
# refused them would refuse every run that follows another closely.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project Tenant Site
port_end stopped
run_gate_over_binary
port_end_stop
check "a keto is started on the port of a listener stopped a moment ago" 0 "$RC" \
	"started keto v0.0.0-fixture from PATH on ports $KETO_PORT and $KETO_PORT"

# --- A listener on another address of the box does not hold the port ---------
#
# The keto binds one loopback address and no other, so that is all the test asks
# about: one that asked every address would refuse a port the keto can have.

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project Tenant Site
rm -f "$KETO_PORT_FILE"
node -e '
const fs = require("node:fs");
const [portFile, port] = process.argv.slice(1);
const server = require("node:net").createServer((socket) => socket.destroy());
server.listen(Number(port), "127.0.0.2", () => fs.writeFileSync(portFile, port));
' "$KETO_PORT_FILE" "$KETO_PORT" &
ELSEWHERE=$!
port_written "listener on another address"
run_gate_over_binary
kill "$ELSEWHERE" 2>/dev/null || true
wait "$ELSEWHERE" 2>/dev/null || true
check "a keto is started on a port something listens on at another address" 0 "$RC" \
	"started keto v0.0.0-fixture from PATH on ports $KETO_PORT and $KETO_PORT"

# --- Where docker is present the container is what is used -------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
git -C "$R" add -A
keto_binary_double Project Tenant Site
keto_double Project Tenant Site
docker_double ""
run_gate_over_docker "PATH=$DOCKER_BIN:$KETO_BIN:$PATH"
keto_double_stop
check "with docker and a keto on PATH the container is started" 0 "$RC" "started chuggy-check-keto"
OUT="$KETO_STARTED"
refute "and the keto on PATH is not" 0 0 "pid "

done_ "check-keto.test.sh"
