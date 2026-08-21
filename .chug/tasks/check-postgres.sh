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
# sources: the container, the per-run scratch database and the probe live
# there, stated once for every gate that needs a server. Cases share the run's
# database deliberately — the subject is a partitioned store, so cases holding
# different partitions in one database exercise the isolation the port claims.
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
# THE CASES RUN ONE AT A TIME. They share a database and some of them establish
# a global recovery epoch, which is by design a fact about the whole database;
# running them concurrently would let one case fence another's lease and report
# it as the adapter's fault. One case also waits on `pg_locks`, which is
# cluster-wide rather than database-scoped — so two runs of this gate against
# the same reused container would observe each other's queued transactions.
# Within a run the serial order excludes that; across concurrent runs it does
# not, and nothing here tries to.
#
# Env: CHUG_PG_URL, CHUG_PG_IMAGE, CHUG_PG_PORT, CHUG_PG_READY_SECS — read by
# `.chug/tasks/_postgres.sh`, which states each knob.
#
# Usage:
#   .chug/tasks/check-postgres.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

# Resolved before any cd, while $0 still points at this script.
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

. "$here/_postgres.sh"
postgres_acquire "check-postgres"
trap postgres_drop_scratch EXIT

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
