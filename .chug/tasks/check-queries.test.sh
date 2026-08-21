#!/bin/sh
# Shell test for check-queries.sh.
#
# WHAT IT HAS TO PROVE IS THAT ALL THREE EXITS ARE REACHABLE and that the
# shared acquisition speaks in this gate's voice: the server logic lives in
# `_postgres.sh` and is parameterized on a message prefix, so the no-docker
# case asserts the prefix on the error line and on the padded continuation
# under it — the seam the extraction could tear.
#
# THE ESLINT UNDER TEST IS A FAKE AND THE POOL MODULE A STUB, for the reason
# check-postgres.test.sh's fixtures ignore their server: what is under test is
# the gate's sequencing and its verdict, not SafeQL — a fixture that needed a
# database and a checker to say anything about the script would leave a
# machine without them unable to check the script either. The fake eslint
# prints the variable it was handed, which is how the wiring claim — the
# migrated URL reaches eslint under the dedicated variable — is pinned without
# a server.
#
# The clean line's subject is asserted on the caller-URL path these cases
# take; the container path's subject is exercised by `ci.sh` on every run.
#
# Run:  .chug/tasks/check-queries.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-queries.sh"
R="$WORK/repo"

. "$HERE/_socket.sh"

# The stub migrates without a server; the gate's own inline runner imports it
# from the fixture the way the real gate imports the real pool.
stub_pool() {
	mkdir -p "$R/src/adapters/postgres"
	cat > "$R/src/adapters/postgres/pool.ts" <<'TS'
export function postgresPool(url) {
  return { url, end: () => Promise.resolve() };
}
export function postgresMigrate(pool) {
  void pool;
  return Promise.resolve([]);
}
TS
}

stub_pool_failing() {
	mkdir -p "$R/src/adapters/postgres"
	cat > "$R/src/adapters/postgres/pool.ts" <<'TS'
export function postgresPool(url) {
  return { url, end: () => Promise.resolve() };
}
export function postgresMigrate() {
  return Promise.reject(new Error("fixture migration failure"));
}
TS
}

fake_eslint() { # <rc> [diagnostic line]
	mkdir -p "$R/node_modules/.bin"
	{
		printf '%s\n' '#!/bin/sh'
		printf '%s\n' 'echo "eslint saw CHUG_SAFEQL_DATABASE_URL=${CHUG_SAFEQL_DATABASE_URL:-unset}"'
		[ -z "${2:-}" ] || printf '%s\n' "echo '$2'"
		printf 'exit %s\n' "$1"
	} > "$R/node_modules/.bin/eslint"
	chmod +x "$R/node_modules/.bin/eslint"
}

fixture() { # a throwaway repo with a stubbed pool and a clean fake eslint
	fresh_repo "$R"
	stub_pool
	fake_eslint 0
}

run_gate() { # <dir> [env=value...]
	OUT="$WORK/.out"
	set +e
	(cd "$1" && shift && env "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

# --- No eslint to run is a could-not-run --------------------------------------

fresh_repo "$R"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "no local eslint is a could-not-run" 2 "$RC" "no local eslint"

# --- No server and no way to start one is a could-not-run, in this gate's voice
#
# CHUG_PG_URL is emptied rather than inherited, as check-postgres.test.sh
# empties it and for its reason. The two assertions pin the prefix the shared
# acquisition was handed: once on the error line, once on the padded
# continuation under it.

fixture
git -C "$R" add -A
run_gate "$R" "PATH=$BIN" HOME="$HOME" CHUG_PG_URL=
check "no docker and no URL is a could-not-run" 2 "$RC" "check-queries: LINTER ERROR — no docker"
check "the continuation line speaks the same prefix" 2 "$RC" "check-queries:                Set CHUG_PG_URL"

# --- A server that does not answer is a could-not-run ------------------------

fixture
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=postgres://fixture@$SILENT/ignored" CHUG_PG_READY_SECS=0
check "a URL nothing answers is a could-not-run" 2 "$RC" "nothing answered at $SILENT"

# --- A migration that fails leaves no schema to ask --------------------------

fixture
stub_pool_failing
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "a failed migration is a could-not-run" 2 "$RC" "did not migrate"

# --- eslint's own could-not-run stays one ------------------------------------

fixture
fake_eslint 2 "the config did not load"
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "an eslint that could not run is a could-not-run" 2 "$RC" "eslint itself could not run"

# --- A disagreeing query is a finding, and the diagnostic passes through -----

fixture
fake_eslint 1 'column "nope" does not exist'
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "a disagreeing query is a finding" 1 "$RC" "FAILED — a query or a row type disagrees"
check "the diagnostic passes through" 1 "$RC" 'column "nope" does not exist'

# --- A clean run names its subject and hands eslint the migrated URL ---------

fixture
git -C "$R" add -A
run_gate "$R" "CHUG_PG_URL=$ANSWERS"
check "a clean run names its subject" 0 "$RC" "agrees with the server CHUG_PG_URL names"
check "eslint was handed the migrated URL under the dedicated variable" 0 "$RC" "eslint saw CHUG_SAFEQL_DATABASE_URL=$ANSWERS"

done_ "check-queries.test.sh"
