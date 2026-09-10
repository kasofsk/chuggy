#!/bin/sh
# Project access is tested against a real Ory Keto, never a fake.
#
# WHAT THIS GATE EXISTS FOR. `src/adapters/keto/` claims that a permit follows
# from a relation the way the model says, that a namespace the model does not
# declare is a fault rather than a refusal, that an object encoding keeps two
# partitions apart, and that an authority which cannot be reached leaves a
# question undecided instead of denying it. Every one of those is a claim about
# what the server does with the model beside it. A fake would answer them by
# agreeing with the adapter, which is the shape of an unverified control: it
# reports success and is then believed.
#
# IT NEEDS A DATABASE TOO, and that is the point of the suite it shares with
# `check-postgres.sh`. Whether a thread's owner is derived from a tuple the
# authority actually holds is a claim about the join, and neither half composed
# alone can be asked it.
#
# THE SERVERS ARE ACQUIRED BY `_keto.sh` AND `_postgres.sh`, which this gate
# sources. It migrates one database for the run and drops it before returning;
# the authority holds its tuples in memory and is left running, so every suite
# addresses objects nothing else does rather than trusting an empty server.
#
# NO SERVER IS A COULD-NOT-RUN, NOT A PASS. Failure to acquire either, or to
# migrate the database, means the suites did not execute and exits two. A suite
# that goes red is a finding and exits one.
#
# Env: CHUG_KETO_READ_URL, CHUG_KETO_WRITE_URL, CHUG_KETO_IMAGE,
# CHUG_KETO_READ_PORT, CHUG_KETO_WRITE_PORT, CHUG_KETO_READY_SECS — read by
# `.chug/tasks/_keto.sh`; CHUG_PG_URL and the rest — by `.chug/tasks/_postgres.sh`.
#
# Usage: .chug/tasks/check-keto.sh
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

here="$(cd "$(dirname "$0")" && pwd)"
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-keto: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

unset FORCE_COLOR
export NO_COLOR=1

suites="$(find test/keto -maxdepth 1 -name '*.test.ts' 2>/dev/null | sort || true)"
if [ -z "$suites" ]; then
	echo "check-keto: LINTER ERROR — no test/keto suite; the glob matched nothing"
	exit 2
fi
suite_count="$(printf '%s\n' "$suites" | grep -c '' || true)"

. "$here/_keto.sh"
keto_acquire "check-keto"

. "$here/_postgres.sh"
postgres_acquire "check-keto"

run_id="$(printf '%s' "$$" | tr -cd '0-9')"
database="chuggy_keto_${run_id}"
database_helper="$root/.chug/tasks/postgres-databases.ts"
made=0

cleanup() {
	if [ "$made" -eq 1 ]; then
		node --experimental-strip-types "$database_helper" drop "$base_url" "$database" || true
		made=0
	fi
	postgres_drop_scratch
}
interrupted() {
	trap - EXIT INT TERM HUP
	cleanup
	echo "check-keto: LINTER ERROR — interrupted before the suites completed"
	exit 2
}
trap interrupted INT TERM HUP
trap 'cleanup' EXIT

made=1
if ! node --experimental-strip-types "$database_helper" prepare "$base_url" "$database"; then
	echo "check-keto: LINTER ERROR — could not prepare the database"
	exit 2
fi
suite_url="$(node -e 'const u=new URL(process.argv[1]);u.pathname=`/${process.argv[2]}`;process.stdout.write(u.toString())' "$base_url" "$database")"

rc=0
set -f
IFS='
'
# shellcheck disable=SC2086 # the suite list is newline-separated by construction
set -- $suites
unset IFS
set +f

CHUG_PG_URL="$suite_url" \
	CHUG_KETO_READ_URL="$keto_read_url" \
	CHUG_KETO_WRITE_URL="$keto_write_url" \
	node --test --test-concurrency=1 --test-reporter=dot "$@" || rc=1

cleanup
trap - EXIT INT TERM HUP

if [ "$rc" -ne 0 ]; then
	echo "check-keto: FAILED — a suite went red against $keto_subject and $subject"
	exit 1
fi
echo "check-keto: $suite_count suite(s) clean against $keto_subject and $subject"
