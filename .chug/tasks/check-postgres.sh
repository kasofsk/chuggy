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
# sources. The gate migrates one template database, clones it once per suite,
# and removes every clone and the template before returning. Ordinary suites
# therefore exercise the current schema without replaying migrations;
# `migration.test.ts` exercises fresh installation, ledger compatibility and
# migration atomicity, and `migrationSteps.test.ts` the later migrations, each
# from the version before it.
#
# WORKERS RUN CONCURRENTLY AND EACH WORKER RUNS ITS SUITES SERIALLY, each suite
# against a clone of its own that is dropped as the suite ends. A suite reading
# what spans the installation — a sweep, a bounded listing, a singleton row —
# would otherwise answer for whatever ran before it. The cases of a suite share
# its database, which is what exercises the partitioning the store claims. The
# worker count moves throughput, not verdicts.
#
# THE SUITES ARE ONE QUEUE, LARGEST FIRST. A worker takes the next suite as it
# finishes one, so the longest starts at once and the rest drain past it. Size
# stands in for length and is read from the tree on every run; the path breaks
# a tie. A worker claims a suite by creating its claim with the shell's own
# exclusive create, which exactly one worker can, and the clean line counts the
# suites that ran, so a suite no worker took is a could-not-run rather than a
# pass.
#
# EVERY NAME THIS RUN MAKES CARRIES ITS OWN RUN ID AND THE DATABASE IT
# CONNECTS TO. The run id is the pid and a part drawn at random for the run,
# from `_postgres.sh`: two runs on one server — in containers of their own, so
# holding the same pid, or on one host and one TMPDIR — never agree on a
# database, a template, a clone or a scratch directory, so neither's CREATE lands
# on the other's database and neither's DROP takes one away. The connected
# database is the name a caller has already given this run's server, and the pid
# makes what a killed run left behind attributable to it. Every database name is
# checked against the length PostgreSQL keeps whole before any is made, so one
# the server would truncate into another's is a could-not-run.
#
# NO DOCKER IS A COULD-NOT-RUN, NOT A PASS. Failure to acquire the server, to
# prepare the template or to clone a suite's database means the suite did not
# execute and exits two. A suite that goes red is a finding and exits one, and
# the workers run the rest of the queue first.
#
# Env: CHUG_PG_URL, CHUG_PG_IMAGE, CHUG_PG_PORT, CHUG_PG_READY_SECS — read by
# `.chug/tasks/_postgres.sh`, as is the seam CHUG_PG_RUN_PID, the suite's alone;
# CHUG_PG_WORKERS — worker count from 1 through 16; CHUG_TEST_TIMEOUT_MS — the
# cap on one test, read by `.chug/tasks/_test-timeout.sh`.
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

. "$here/_test-timeout.sh"
test_timeout_read "check-postgres"
. "$here/_postgres.sh"
postgres_acquire "check-postgres"

# The database this run connects to, as the first half of every name it makes.
# A name the server would truncate is one two runs could collide under, so a
# long one is carried in part and a digest of the whole distinguishes it.
run_scope="$(node -e '
const { createHash } = require("node:crypto");
let named = "";
try {
  const at = new URL(process.argv[1]);
  named = at.searchParams.get("dbname") ?? decodeURIComponent(at.pathname.replace(/^\//u, ""));
} catch {
  named = /(?:^|\s)dbname=(\S+)/u.exec(process.argv[1])?.[1] ?? "";
}
let name = named.toLowerCase().replace(/[^a-z0-9_]/gu, "_") || "postgres";
if (!/^[a-z]/u.test(name)) name = `d${name}`;
if (name.length > 32)
  name = `${name.slice(0, 23)}_${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
process.stdout.write(`${name}_${process.argv[2]}`);
' "$base_url" "$run_id")"
if [ -z "$run_scope" ]; then
	echo "check-postgres: LINTER ERROR — could not name this run's databases from the server it connects to"
	exit 2
fi
template="${run_scope}_t"
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

queue="$work/queue"
printf '%s\n' "$suites" | while IFS= read -r suite; do
	printf '%s %s\n' "$(wc -c <"$suite")" "$suite"
done | sort -k1,1nr -k2 | sed 's/^ *[0-9]* //' >"$queue"

# Every name the run can make, one for each place in the queue, taken before a
# worker starts: the cleanup drops what a killed run was part way through, and a
# name it never reached is a drop of a database that is not there. One that
# would not fit is never handed to it, because the server would drop the name
# it truncates to.
names="$template"
position=1
while [ "$position" -le "$suite_count" ]; do
	names="${run_scope}_s${position} $names"
	position=$((position + 1))
done
# shellcheck disable=SC2086 # database names are generated words.
postgres_name_check $names
databases="$names"

if ! node --experimental-strip-types "$database_helper" prepare "$base_url" "$template"; then
	echo "check-postgres: LINTER ERROR — could not prepare the template database"
	exit 2
fi

worker=1
while [ "$worker" -le "$workers" ]; do
	(
		position=0
		worker_rc=0
		while IFS= read -r suite; do
			position=$((position + 1))
			if ! (set -C && : >"$work/claimed.$position") 2>/dev/null; then continue; fi
			database="${run_scope}_s${position}"
			if ! node --experimental-strip-types "$database_helper" clone "$base_url" "$database" "$template"; then
				echo "check-postgres: LINTER ERROR — could not clone a database for $suite"
				exit 2
			fi
			suite_url="$(node -e 'const u=new URL(process.argv[1]);u.pathname=`/${process.argv[2]}`;process.stdout.write(u.toString())' "$base_url" "$database")"
			CHUG_PG_URL="$suite_url" node --test --test-concurrency=1 --test-reporter=dot \
				--test-timeout="$test_timeout_ms" --test-force-exit "$suite" || worker_rc=1
			: >"$work/ran.$position"
			# The run's own cleanup drops it again if this misses; what this
			# buys is one live database per worker rather than all of them.
			node --experimental-strip-types "$database_helper" drop "$base_url" "$database" || true
		done <"$queue"
		exit "$worker_rc"
	) &
	pids="$pids $!"
	worker=$((worker + 1))
done

rc=0
for pid in $pids; do
	worker_rc=0
	wait "$pid" || worker_rc=$?
	if [ "$worker_rc" -eq 2 ]; then
		rc=2
	elif [ "$worker_rc" -ne 0 ] && [ "$rc" -eq 0 ]; then
		rc=1
	fi
done
pids=""
ran="$(find "$work" -maxdepth 1 -name 'ran.*' | grep -c '' || true)"
if ! cleanup; then
	echo "check-postgres: LINTER ERROR — could not remove the cloned databases"
	exit 2
fi
trap - EXIT INT TERM HUP

if [ "$rc" -eq 2 ]; then
	exit 2
fi
if [ "$rc" -ne 0 ]; then
	echo "check-postgres: FAILED — a worker went red against $subject"
	exit 1
fi
if [ "$ran" -ne "$suite_count" ]; then
	echo "check-postgres: LINTER ERROR — $ran of $suite_count suite(s) ran; no worker took the rest"
	exit 2
fi
echo "check-postgres: $ran suite(s) clean against $subject with $workers worker(s)"
