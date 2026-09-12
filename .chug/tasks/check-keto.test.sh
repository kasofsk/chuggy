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
	KETO_PORT="$(cat "$KETO_PORT_FILE")"
	KETO_ANSWERS="http://127.0.0.1:$KETO_PORT/"
}

keto_double_stop() {
	[ -n "${KETO_DOUBLE:-}" ] || return 0
	kill "$KETO_DOUBLE" 2>/dev/null || true
	wait "$KETO_DOUBLE" 2>/dev/null || true
	KETO_DOUBLE=""
}

fixture() { # a throwaway repo with a test/keto directory and a model
	fresh_repo "$R"
	mkdir -p "$R/test/keto" "$R/.chug/tasks/keto"
	printf 'dsn: memory\n' >"$R/.chug/tasks/keto/keto.yml"
	printf 'class Project {}\n' >"$R/.chug/tasks/keto/namespaces.ts"
	database_helper_double "$R"
}

# A docker whose containers are one label in a file: enough to answer the three
# questions the acquire asks it, and to record what it was told to start.
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
run_gate_over_docker() {
	run_gate "$R" "PATH=$DOCKER_BIN:$PATH" "CHUG_DOCKER_LOG=$DOCKER_LOG" \
		"CHUG_DOCKER_LABEL=$DOCKER_LABEL" CHUG_DOCKER_IMAGE=oryd/keto:fixture \
		"CHUG_KETO_READ_PORT=$KETO_PORT" "CHUG_KETO_WRITE_PORT=$KETO_PORT" \
		CHUG_KETO_READ_URL= CHUG_KETO_WRITE_URL= \
		"CHUG_PG_URL=$ANSWERS" "CHUG_PG_HELPER_LOG=$CHUG_PG_HELPER_LOG"
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
keto_double Project Tenant
docker_double "the digest of some earlier model"
run_gate_over_docker
keto_double_stop
check "a container started from another model is not reused" 0 "$RC" "carries another model"
OUT="$DOCKER_LOG"
check "the container carrying it is removed" 0 0 "rm -f chuggy-check-keto"
check "the model a container starts from is a label on it" 0 0 "--label chuggy.keto.model="

# --- A container started from this model is reused ---------------------------
#
# The digest is read off what the run above started rather than restated here,
# so the case cannot agree with a second copy of the algorithm.

STARTED_FROM="$(sed -n 's/.*--label chuggy\.keto\.model=\([0-9a-f]*\).*/\1/p' "$DOCKER_LOG" | head -1)"
[ -n "$STARTED_FROM" ] || { echo "check-keto.test.sh: LINTER ERROR — nothing was started with a model label"; exit 2; }
keto_double Project Tenant
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
check "a container that never answers is a could-not-run" 2 "$RC" "did not answer ready with both namespaces"

# --- No model to start a container from is a could-not-run -------------------

fixture
passing_suite "$R/test/keto/one.test.ts"
rm -rf "$R/.chug/tasks/keto"
git -C "$R" add -A
keto_double Project Tenant
docker_double ""
run_gate_over_docker
keto_double_stop
check "no model to start an authority from is a could-not-run" 2 "$RC" "no model to start an authority from"

done_ "check-keto.test.sh"
