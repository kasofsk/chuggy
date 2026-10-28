#!/bin/sh
# Every sql-tagged adapter query is asked of a real, migrated schema.
#
# WHAT THIS GATE EXISTS FOR. Each call site in `src/adapters/postgres/`
# declares what its query returns, and nothing in the type system checks that
# claim — the server is the only authority on it. SafeQL, activated in
# `eslint.config.js` only when CHUG_SAFEQL_DATABASE_URL is set, asks
# PostgreSQL whether each sql-tagged query is valid and whether the declared
# row type is what the query returns. This gate is the one place in CI that
# sets the variable, against a database it has just migrated — so a plain
# `eslint .` under check-source never needs a server or the SQL parser this
# run does.
#
# A ROUTINE A QUERY NAMES MUST EXIST IN THE MIGRATED SCHEMA. Function names
# are written literally at call sites and checked here against the database
# the migrations just built, so a routine renamed in `schema.ts` and missed at
# a call site is a finding: the queries and the schema cannot drift apart
# silently.
#
# THE COMPILER IS PART OF THE VERDICT. SafeQL reads each call site's declared
# row type through the typescript it resolves, so a second copy resolving under
# the plugin answers for a compiler this tree is not written for — and answers
# confidently, reporting every type argument in the adapter as `{ }`. That is a
# wrong verdict rather than a missing one, so it is refused here as a
# could-not-run before any server is acquired.
#
# A CALLER-SUPPLIED SERVER GETS A DATABASE OF THE RUN'S OWN, AND THE ONE IT
# NAMES IS NEVER WRITTEN. CHUG_PG_URL skips the container exactly as it does for
# check-postgres. The gate creates a database beside the named one under a name
# carrying the run id from `_postgres.sh`, migrates it, asks it, and drops it
# when the run ends however it ends; a URL it cannot name that database in is a
# could-not-run. The named database is only connected to, to create and drop
# that one: a server shared between checkouts would otherwise keep whatever
# migration a branch recorded in it, and refuse the migrations of every checkout
# that numbers them differently.
#
# Env: CHUG_PG_URL, CHUG_PG_IMAGE, CHUG_PG_PORT, CHUG_PG_READY_SECS — read by
# `.chug/tasks/_postgres.sh`, which states each knob.
# The role in CHUG_PG_URL must be able to create and drop sibling databases.
#
# Usage:
#   .chug/tasks/check-queries.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

# Resolved before any cd, while $0 still points at this script.
here="$(cd "$(dirname "$0")" && pwd)"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-queries: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

unset FORCE_COLOR
export NO_COLOR=1

if [ ! -x ./node_modules/.bin/eslint ]; then
	echo "check-queries: LINTER ERROR — no local eslint. Install with \`npm ci\`."
	exit 2
fi

# Reported only when both resolve and disagree: a tree missing either is a
# tree check-source's typecheck fails on first, and guessing here would turn a
# clear failure into a confusing one.
mismatch="$(node --input-type=module -e '
import { createRequire } from "node:module";
const here = createRequire(process.cwd() + "/");
let root, plugin;
try {
  root = here.resolve("typescript");
  plugin = createRequire(
    here.resolve("@ts-safeql/eslint-plugin"),
  ).resolve("typescript");
} catch {
  process.exit(0);
}
if (root !== plugin) console.log(plugin);
' 2>/dev/null)"
if [ -n "$mismatch" ]; then
	echo "check-queries: LINTER ERROR — the plugin resolves its own typescript at"
	echo "check-queries:   $mismatch"
	echo "check-queries: so every row type it infers answers for that compiler and"
	echo "check-queries: not the root's. Reconcile the versions and \`npm ci\`."
	exit 2
fi

. "$here/_postgres.sh"
postgres_acquire "check-queries"
url="$base_url"
database=""
database_helper="$root/.chug/tasks/postgres-databases.ts"

cleanup() {
	if [ -n "$database" ]; then
		node --experimental-strip-types "$database_helper" drop "$base_url" "$database" || true
	fi
	postgres_drop_scratch
}
interrupted() {
	trap - INT TERM HUP
	echo "check-queries: LINTER ERROR — interrupted before a verdict"
	exit 2
}
trap cleanup EXIT
trap interrupted INT TERM HUP

if [ -z "$scratch" ]; then
	postgres_name_check "chuggy_queries_${run_id}"
	# Rewritten before anything is made, and silently: a URL the client accepts
	# and this parser does not would otherwise be echoed, password and all.
	if ! url="$(node -e '
let at;
try {
  at = new URL(process.argv[1]);
} catch {
  process.exit(1);
}
if (at.protocol === "socket:") at.searchParams.set("db", process.argv[2]);
else if (at.protocol === "postgres:" || at.protocol === "postgresql:")
  at.pathname = "/" + process.argv[2];
else process.exit(1);
process.stdout.write(at.toString());
' "$base_url" "chuggy_queries_${run_id}" 2>/dev/null)"; then
		echo "check-queries: LINTER ERROR — CHUG_PG_URL is not a URL this gate can name a database of the run's own in"
		exit 2
	fi
	# Named before it is made, so a run killed while making it still drops it.
	database="chuggy_queries_${run_id}"
	if ! node --experimental-strip-types "$database_helper" create "$base_url" "$database"; then
		echo "check-queries: LINTER ERROR — could not create a database for this run beside the one CHUG_PG_URL names"
		exit 2
	fi
fi

if ! node --input-type=module -e '
const { postgresPool, postgresMigrate } = await import(
  "./src/adapters/postgres/pool.ts"
);
const pool = postgresPool(process.argv[1]);
try {
  await postgresMigrate(pool);
} finally {
  await pool.end();
}
' "$url"; then
	echo "check-queries: LINTER ERROR — the database did not migrate, so there is no schema to ask"
	exit 2
fi

set +e
CHUG_SAFEQL_DATABASE_URL="$url" ./node_modules/.bin/eslint src/adapters/postgres
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
	echo "check-queries: src/adapters/postgres agrees with $subject"
	exit 0
fi
if [ "$rc" -eq 1 ]; then
	echo "check-queries: FAILED — a query or a row type disagrees with $subject"
	exit 1
fi
echo "check-queries: LINTER ERROR — eslint itself could not run"
exit 2
