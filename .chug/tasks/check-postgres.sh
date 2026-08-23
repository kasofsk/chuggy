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
# THE SERVER IS ACQUIRED BY `.chug/tasks/_postgres.sh`, which this gate
# sources. The gate migrates one template database, clones one isolated
# database per active worker, and removes every clone and the template before
# returning. Ordinary suites therefore exercise the current schema without
# replaying migrations; `migration.test.ts` remains responsible for the chain
# and historical upgrade paths.
#
# WORKERS RUN CONCURRENTLY AND EACH WORKER RUNS ITS SUITES SERIALLY. Database
# isolation keeps recovery epochs, locks and rows local to one worker. The
# worker count is bounded and defaults conservatively; changing it affects
# throughput and server connection pressure, not test semantics.
#
# NO DOCKER IS A COULD-NOT-RUN, NOT A PASS. Failure to acquire the server or
# prepare the cloned databases also means the suite did not execute and exits
# two. Once workers start, any red worker is a finding and exits one.
#
# Env: CHUG_PG_URL, CHUG_PG_IMAGE, CHUG_PG_PORT, CHUG_PG_READY_SECS — read by
# `.chug/tasks/_postgres.sh`; CHUG_PG_WORKERS — worker count from 1 through 16.
# The role in CHUG_PG_URL must be able to create and drop sibling databases.
#
# Usage: .chug/tasks/check-postgres.sh
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

here="$(cd "$(dirname "$0")" && pwd)"
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-postgres: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

unset FORCE_COLOR
export NO_COLOR=1

suites="$(find test/postgres -maxdepth 1 -name '*.test.ts' 2>/dev/null | sort || true)"
if [ -z "$suites" ]; then
	echo "check-postgres: LINTER ERROR — no test/postgres suite; the glob matched nothing"
	exit 2
fi
suite_count="$(printf '%s\n' "$suites" | grep -c '' || true)"
workers="${CHUG_PG_WORKERS:-4}"
case "$workers" in
	''|*[!0-9]*|0)
		echo "check-postgres: LINTER ERROR — CHUG_PG_WORKERS must be from 1 through 16"
		exit 2
		;;
esac
if [ "$workers" -gt 16 ]; then
	echo "check-postgres: LINTER ERROR — CHUG_PG_WORKERS must be from 1 through 16"
	exit 2
fi
if [ "$workers" -gt "$suite_count" ]; then workers="$suite_count"; fi

. "$here/_postgres.sh"
postgres_acquire "check-postgres"

run_id="$(printf '%s' "$$" | tr -cd '0-9')"
template="chuggy_template_${run_id}"
database_helper="$root/.chug/tasks/postgres-databases.ts"
work="${TMPDIR:-/tmp}/chuggy-postgres-${run_id}"
mkdir -p "$work"
pids=""
databases=""
cleaned=0

cleanup() {
	cleanup_rc=0
	if [ -n "$pids" ]; then
		for pid in $pids; do kill "$pid" 2>/dev/null || true; done
		for pid in $pids; do wait "$pid" 2>/dev/null || true; done
	fi
	if [ "$cleaned" -eq 0 ] && [ -n "$databases" ]; then
		# shellcheck disable=SC2086 # database names are generated words.
		node --experimental-strip-types "$database_helper" drop "$base_url" $databases || cleanup_rc=1
		cleaned=1
	fi
	rm -rf "$work"
	postgres_drop_scratch
	return "$cleanup_rc"
}
interrupted() {
	trap - EXIT INT TERM HUP
	cleanup || true
	echo "check-postgres: LINTER ERROR — interrupted before the workers completed"
	exit 2
}
trap interrupted INT TERM HUP
trap 'cleanup || true' EXIT

databases="$template"
if ! node --experimental-strip-types "$database_helper" prepare "$base_url" "$template"; then
	echo "check-postgres: LINTER ERROR — could not prepare the template database"
	exit 2
fi

worker=1
while [ "$worker" -le "$workers" ]; do
	: >"$work/$worker.suites"
	worker=$((worker + 1))
done
worker=1
printf '%s\n' "$suites" | while IFS= read -r suite; do
	printf '%s\n' "$suite" >>"$work/$worker.suites"
	worker=$((worker + 1))
	if [ "$worker" -gt "$workers" ]; then worker=1; fi
done

worker=1
while [ "$worker" -le "$workers" ]; do
	database="chuggy_worker_${run_id}_${worker}"
	databases="$database $databases"
	if ! node --experimental-strip-types "$database_helper" clone "$base_url" "$database" "$template"; then
		echo "check-postgres: LINTER ERROR — could not clone worker database $worker"
		exit 2
	fi
	worker_url="$(node -e 'const u=new URL(process.argv[1]);u.pathname=`/${process.argv[2]}`;process.stdout.write(u.toString())' "$base_url" "$database")"
	(
		set -f
		IFS='
'
		# shellcheck disable=SC2046 # each line is one suite path.
		set -- $(sed -n 'p' "$work/$worker.suites")
		unset IFS
		set +f
		CHUG_PG_URL="$worker_url" node --test --test-concurrency=1 --test-reporter=dot "$@"
	) &
	pids="$pids $!"
	worker=$((worker + 1))
done

rc=0
for pid in $pids; do
	if ! wait "$pid"; then rc=1; fi
done
pids=""
if ! cleanup; then
	echo "check-postgres: LINTER ERROR — could not remove the cloned databases"
	exit 2
fi
trap - EXIT INT TERM HUP

if [ "$rc" -ne 0 ]; then
	echo "check-postgres: FAILED — a worker went red against $subject"
	exit 1
fi
echo "check-postgres: $suite_count suite(s) clean against $subject with $workers worker(s)"
