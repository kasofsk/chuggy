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
# A CALLER-SUPPLIED SERVER IS MIGRATED IN PLACE. CHUG_PG_URL skips the
# container exactly as it does for check-postgres, and the database it names
# is brought to the declared schema before eslint asks it anything.
#
# Env: CHUG_PG_URL, CHUG_PG_IMAGE, CHUG_PG_PORT, CHUG_PG_READY_SECS — read by
# `.chug/tasks/_postgres.sh`, which states each knob.
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

. "$here/_postgres.sh"
postgres_acquire "check-queries"
trap postgres_drop_scratch EXIT

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
' "$base_url"; then
	echo "check-queries: LINTER ERROR — the database did not migrate, so there is no schema to ask"
	exit 2
fi

set +e
CHUG_SAFEQL_DATABASE_URL="$base_url" ./node_modules/.bin/eslint src/adapters/postgres
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
