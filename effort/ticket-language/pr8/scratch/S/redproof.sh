#!/bin/sh
# Applies one mutation, prepares a fresh database from the mutated chain and runs
# the cases it should make red. Arguments: label, python mutation file, pattern.
set -e
cd /home/geoff/claude/chuggy-wt/released-schema
export TMPDIR=/tmp FORCE_COLOR=0 NO_COLOR=1
label="$1"; mutation="$2"; pattern="$3"
db="rp_$(echo "$label" | tr -cd 'a-z0-9_')"
cp src/adapters/postgres/schema/migrations/013-released-ticket.ts /tmp/claude-1000/013.keep
cp src/adapters/postgres/schema/migrations/index.ts /tmp/claude-1000/index.keep
python3 "$mutation"
node --experimental-strip-types .chug/tasks/postgres-databases.ts prepare \
  postgres://postgres:chuggy-check@127.0.0.1:55436/postgres "$db" >/dev/null 2>&1 || true
CHUG_PG_URL="postgres://postgres:chuggy-check@127.0.0.1:55436/$db" \
  timeout 540 node --experimental-strip-types --test --test-name-pattern="$pattern" \
  test/postgres/migration.test.ts >/tmp/claude-1000/rp.out 2>&1 || true
cp /tmp/claude-1000/013.keep src/adapters/postgres/schema/migrations/013-released-ticket.ts
cp /tmp/claude-1000/index.keep src/adapters/postgres/schema/migrations/index.ts
fail=$(grep -c '^✖' /tmp/claude-1000/rp.out || true)
pass=$(sed -n 's/^ℹ pass \([0-9]*\)$/\1/p' /tmp/claude-1000/rp.out)
if [ "$fail" -gt 0 ]; then echo "RED    $label (pass=$pass)"; else echo "SURVIVED $label (pass=$pass)"; fi
