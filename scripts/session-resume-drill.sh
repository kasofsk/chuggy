#!/bin/sh
# The resume proof, credentialed: a real agent, a real store, a real database,
# and a pod that is killed between two turns.
#
# WHAT IT PROVES, and it is the one thing slice 1 exists for: a session is the
# truth and its pod is a cache. The first attempt is told a word and is then
# SIGKILLed; the second attempt is a different pod with a different bearer, and
# it answers the word from the store alone. `test/postgres/sessionResume.test.ts`
# pins the durable half of the same loop and cannot pin this half, because a
# gate may assume neither a model credential nor the public internet — which is
# exactly why this is a named script and never a gate.
#
# WHAT IS REAL HERE. PostgreSQL in a container of this script's own, migrated by
# the tree's own migration; `src/roots/workerPlane.ts` serving the session
# routes over the plane role; `src/roots/provisionAgentSession.ts` opening the
# session and giving it its turns; `images/worker/entrypoint.mjs` in Session
# mode, which is the pod's whole code path. Nothing is stubbed.
#
# THE AGENT CREDENTIAL IS THE OPERATOR'S OWN LOGIN, reached the way a developer
# reaches it: `CLAUDE_CONFIG_DIR` names the config directory already logged in.
# The pod's credential mount is exercised and is empty, so what this drill does
# not cover is a mounted token's value. Nothing here reads or writes the
# credential file.
#
# THE AGENT SDK IS NOT A DEPENDENCY OF THIS TREE — the image installs it — so
# where it is not already resolvable this fetches the version the image pins into
# a scratch directory and links that one name in beside the pod. Cleanup removes
# the link it made and the directory only if it made that too, because a
# developer who keeps their own install there must not have it deleted; the tree
# is left as it was found either way.
#
# Env:
#   CHUG_DRILL_PG_PORT     host port for this drill's own server
#   CHUG_DRILL_PLANE_PORT  host port for the worker plane it starts
#   CHUG_PG_IMAGE          the PostgreSQL image that server is started from
#   CHUG_SESSION_MODEL     the model each turn runs against
#   CHUG_DRILL_KEEP        keep the container and the scratch tree afterwards
#
# Usage: scripts/session-resume-drill.sh
# Exits 0 only when every assertion below holds, and prints each one.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "session-resume-drill: not a git checkout, so there is no tree to drive" >&2
	exit 2
fi
cd "$root" || exit 2

container="chuggy-session-resume-drill"
image="${CHUG_PG_IMAGE:-postgres:18-alpine}"
pg_port="${CHUG_DRILL_PG_PORT:-55492}"
plane_port="${CHUG_DRILL_PLANE_PORT:-3491}"
password="chuggy-drill"
database="chuggy_drill"
model="${CHUG_SESSION_MODEL:-claude-haiku-4-5-20251001}"
nonce="kestrel"
# How long the drill waits on a server, a route or a turn before giving up.
ready_secs=60
turn_secs=240

scratch=""
plane_pid=""
pod_pid=""
linked=""
made_modules=""

drill_clean() {
	[ -z "$pod_pid" ] || kill -9 "$pod_pid" 2>/dev/null || true
	[ -z "$plane_pid" ] || kill "$plane_pid" 2>/dev/null || true
	[ -z "$linked" ] || rm -f "$linked"
	[ -z "$made_modules" ] || rmdir "$made_modules" 2>/dev/null || true
	if [ -n "${CHUG_DRILL_KEEP:-}" ]; then
		echo "session-resume-drill: kept $container and $scratch"
		return
	fi
	docker rm -f "$container" >/dev/null 2>&1 || true
	[ -z "$scratch" ] || rm -rf "$scratch"
}
trap drill_clean EXIT INT TERM

say() { echo "session-resume-drill: $*"; }

fail() {
	echo "session-resume-drill: FAILED — $*" >&2
	exit 1
}

# One statement as the role a deployment would run it as, answered unadorned.
psql_as() { # <role> <statement>
	docker exec -e PGPASSWORD="$password" "$container" \
		psql -qtAX -U postgres -d "$database" \
		-c "SET ROLE $1" -c "$2"
}

# --- the server -------------------------------------------------------------

command -v docker >/dev/null 2>&1 || fail "no docker, so no server can be had"
docker rm -f "$container" >/dev/null 2>&1 || true
docker run -d --name "$container" -e POSTGRES_PASSWORD="$password" \
	-p "127.0.0.1:$pg_port:5432" "$image" >/dev/null ||
	fail "could not start $image as $container"
waited=0
until docker exec "$container" pg_isready -q 2>/dev/null; do
	waited=$((waited + 1))
	[ "$waited" -lt "$ready_secs" ] || fail "$container never answered"
	sleep 1
done
say "started $container on port $pg_port"

base="postgres://postgres:$password@127.0.0.1:$pg_port/postgres"
node --experimental-strip-types .chug/tasks/postgres-databases.ts \
	prepare "$base" "$database" >/dev/null ||
	fail "the migration this tree carries did not apply"
applied="$(psql_as postgres "SELECT max(version) FROM schema_migration")"
say "migrated $database, through version $applied"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/chuggy-drill-XXXXXX")"
mkdir -p "$scratch/artifacts" "$scratch/workspace"
: >"$scratch/credential"

# --- the agent runtime, where this tree does not already carry it ------------

sdk="@anthropic-ai/claude-agent-sdk"
sdk_version="$(sed -n 's/^ARG AGENT_SDK_VERSION=//p' images/worker/Dockerfile)"
[ -n "$sdk_version" ] || fail "images/worker/Dockerfile pins no agent SDK version"
if ! node -e "require.resolve('$sdk/package.json')" >/dev/null 2>&1; then
	say "fetching $sdk@$sdk_version, which this tree does not depend on"
	npm install --silent --no-audit --no-fund --prefix "$scratch/sdk" \
		"$sdk@$sdk_version" >/dev/null 2>&1 ||
		fail "could not fetch $sdk@$sdk_version"
	modules="$root/images/worker/node_modules"
	[ -d "$modules" ] || made_modules="$modules"
	mkdir -p "$modules"
	scoped="$modules/@anthropic-ai"
	if [ -e "$scoped" ] || [ -L "$scoped" ]; then
		fail "$scoped is already there; the drill will not stand on or remove it"
	fi
	ln -s "$scratch/sdk/node_modules/@anthropic-ai" "$scoped"
	linked="$scoped"
fi

# --- the worker plane -------------------------------------------------------

plane_url="postgres://postgres:$password@127.0.0.1:$pg_port/$database?options=-c%20role%3Dchuggy_worker_plane"
CHUG_WORKER_PLANE_DATABASE_URL="$plane_url" \
	CHUG_WORKER_PLANE_ARTIFACT_ROOT="$scratch/artifacts" \
	CHUG_WORKER_PLANE_PORT="$plane_port" \
	node --experimental-strip-types src/roots/workerPlane.ts \
	>"$scratch/plane.log" 2>&1 &
plane_pid=$!
plane="http://127.0.0.1:$plane_port"
waited=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$plane/health/ready")" = "200" ]; do
	waited=$((waited + 1))
	[ "$waited" -lt "$ready_secs" ] || {
		cat "$scratch/plane.log" >&2
		fail "the worker plane never became ready"
	}
	sleep 1
done
say "the worker plane is ready on $plane, as the role it deploys under"

# --- the session and its first turn -----------------------------------------

session="session-drill-$(date +%s)"
provision() { # <action> [extra assignments as VAR=value ...]
	action="$1"
	shift
	env CHUG_PROVISION_SESSION_DATABASE_URL="postgres://postgres:$password@127.0.0.1:$pg_port/$database" \
		CHUG_PROVISION_SESSION_ACTION="$action" \
		CHUG_PROVISION_SESSION_TENANT=drill \
		CHUG_PROVISION_SESSION_PROJECT=drill \
		CHUG_PROVISION_SESSION_SESSION="$session" \
		CHUG_PROVISION_SESSION_KIND=Lead \
		CHUG_PROVISION_SESSION_ISSUER="https://auth.invalid" \
		CHUG_PROVISION_SESSION_SUBJECT=drill \
		CHUG_PROVISION_SESSION_CAPABILITIES=RepositoryRead \
		CHUG_PROVISION_SESSION_CREDENTIAL_SLOT=claude-code \
		"$@" node --experimental-strip-types src/roots/provisionAgentSession.ts
}

psql_as postgres "INSERT INTO recovery_epoch (epoch) VALUES ('epoch-drill')
  ON CONFLICT DO NOTHING" >/dev/null
psql_as postgres "INSERT INTO project (tenant,project,lifecycle)
  VALUES ('drill','drill','Active') ON CONFLICT DO NOTHING" >/dev/null
provision open || fail "the session could not be opened"

turn() { # <ordinal label> <text>
	provision enqueue \
		CHUG_PROVISION_SESSION_TURN="turn-$1-$session" \
		CHUG_PROVISION_SESSION_INPUT_KIND=UserMessage \
		CHUG_PROVISION_SESSION_INPUT="$2"
}
turn one "Remember the word $nonce. Reply with just: ok." ||
	fail "the first turn was not enqueued"

# --- one attempt, opened, placed and run as its pod --------------------------

bearer=""
attempt=""

open_attempt() { # <label>
	attempt="attempt-$1-$session"
	bearer="chgs_$(cat /proc/sys/kernel/random/uuid)$(cat /proc/sys/kernel/random/uuid)"
	digest="$(printf '%s' "$bearer" | sha256sum | cut -d' ' -f1)"
	opened="$(psql_as chuggy_scheduler "SELECT opened FROM open_session_attempt(
	  'drill','drill','$session',
	  (SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1),
	  '$attempt','bearer-$1-$session','$digest',600,0,16,16)")"
	[ "$opened" = "Opened" ] || fail "opening attempt $1 answered $opened"
	placed="$(psql_as chuggy_scheduler \
		"SELECT place_session_attempt('$attempt',1,'pod-$1')")"
	[ "$placed" = "t" ] || fail "placing attempt $1 answered $placed"
	printf '%s' "$bearer" >"$scratch/bearer"
}

pod_task() { # <label>
	cat <<JSON
{"tenant":"drill","project":"drill","session":"$session","kind":"Lead",
 "attempt":"$attempt","generation":1,"capabilities":["RepositoryRead"],
 "credentialSlot":"claude-code",
 "authority":{"tools":[],"credentials":["claude-code"],"network":true,
              "filesystem":"WriteWorkspace","mayCompleteTask":false},
 "workerPlane":{"url":"$plane","capabilityFile":"$scratch/bearer"},
 "bounds":{"mailboxPollMs":1000,"idleMs":120000,"resultDrainMs":3000,
           "loadTimeoutMs":120000,"turnsMax":20,"budgetUsd":1}}
JSON
}

run_pod() { # <label>
	env -u CHUG_WORKER_TASK \
		CHUG_SESSION_TASK="$(pod_task "$1")" \
		CHUG_WORKER_CREDENTIAL_FILES="{\"claude-code\":\"$scratch/credential\"}" \
		CHUG_WORKER_WORKSPACE="$scratch/workspace" \
		CLAUDE_CONFIG_DIR="$HOME/.claude" \
		CHUG_SESSION_MODEL="$model" \
		node images/worker/entrypoint.mjs >>"$scratch/pod-$1.log" 2>&1 &
	pod_pid=$!
}

await_turn() { # <ordinal>
	waited=0
	until [ "$(psql_as postgres "SELECT state FROM session_turn
	  WHERE session='$session' AND ordinal=$1")" = "Answered" ]; do
		waited=$((waited + 1))
		[ "$waited" -lt "$turn_secs" ] || {
			tail -20 "$scratch"/pod-*.log >&2
			fail "turn $1 was never answered"
		}
		sleep 1
	done
}

store_digests() {
	psql_as postgres "SELECT stream||' '||batch||' '||digest FROM session_store_batch
	  WHERE session='$session' ORDER BY stream,batch"
}

open_attempt one
run_pod one
say "attempt one is running as pid $pod_pid; waiting for the first turn"
await_turn 1
first_attempt="$attempt"
reference_one="$(psql_as postgres \
	"SELECT coalesce(agent_reference,'') FROM agent_session WHERE session='$session'")"
store_one="$(store_digests)"
say "turn one answered under $first_attempt, runtime session $reference_one"

kill -9 "$pod_pid"
wait "$pod_pid" 2>/dev/null || true
pod_pid=""
ended="$(psql_as chuggy_scheduler "SELECT end_session_attempt('$first_attempt',1,'Vanished')")"
[ "$ended" = "t" ] || fail "ending the first attempt answered $ended"
say "the first pod was killed and its attempt ended Vanished"

# --- the second attempt, which knows only what the store holds ---------------

turn two "What word did I ask you to remember? Reply with just that word." ||
	fail "the second turn was not enqueued"
open_attempt two
run_pod two
say "attempt two is running as pid $pod_pid; waiting for the second turn"
await_turn 2
second_attempt="$attempt"
reference_two="$(psql_as postgres \
	"SELECT coalesce(agent_reference,'') FROM agent_session WHERE session='$session'")"
store_two="$(store_digests)"
answer="$(psql_as postgres \
	"SELECT result FROM session_turn WHERE session='$session' AND ordinal=2")"
kill -9 "$pod_pid" 2>/dev/null || true
pod_pid=""

# --- the assertions of PLAN.md section 1.9, each printed --------------------

held=0
check() { # <verdict> <what>
	if [ "$1" = "yes" ]; then
		echo "  HELD  $2"
	else
		echo "  BROKE $2"
		held=1
	fi
}

echo "session-resume-drill: the assertions"

attempts="$(psql_as postgres "SELECT attempt_number||' '||attempt||' '||state
  FROM session_attempt WHERE session='$session' ORDER BY attempt_number" | tr '\n' ';')"
expected="1 $first_attempt Lost;2 $second_attempt Running;"
[ "$attempts" = "$expected" ] && one=yes || one=no
check "$one" "a second attempt exists: $attempts"

[ -n "$reference_one" ] && [ "$reference_one" = "$reference_two" ] && two=yes || two=no
check "$two" "the runtime session is the same one: $reference_one"

grew=$(printf '%s\n' "$store_two" | grep -c . || true)
was=$(printf '%s\n' "$store_one" | grep -c . || true)
kept=yes
printf '%s\n' "$store_one" | while IFS= read -r batch; do
	[ -z "$batch" ] && continue
	printf '%s\n' "$store_two" | grep -qxF "$batch" || exit 1
done || kept=no
contiguous="$(printf '%s\n' "$store_two" | awk '{print $1}' | uniq -c |
	awk '{print $1}' | tr '\n' ' ')"
# Sorted by stream and then by batch AS A NUMBER: the default collation orders
# a batch as text, so a tenth batch sorts between the first and the second and a
# contiguous store reads as a gapped one.
numbering="$(printf '%s\n' "$store_two" | awk '{print $1" "$2}' | sort -u -k1,1 -k2,2n |
	awk '{if ($2 != ++seen[$1]) bad = 1} END {print bad ? "gapped" : "contiguous"}')"
[ "$grew" -gt "$was" ] && [ "$kept" = yes ] && [ "$numbering" = contiguous ] &&
	three=yes || three=no
check "$three" "the store grew and lost nothing: $was then $grew batches, $numbering, per stream $contiguous"

case "$answer" in
*"$nonce"*) four=yes ;;
*) four=no ;;
esac
check "$four" "the memory survived: turn two answered $answer"

[ "$held" -eq 0 ] || fail "an assertion above did not hold"
say "every assertion held; the session outlived the pod that learned the word"
