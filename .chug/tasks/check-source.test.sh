#!/bin/sh
# Shell test for check-source.sh.
#
# THIS SUITE IS WHERE HOUSE RULES 2 THROUGH 6 ARE PROVED TO BITE. The rules
# live in `eslint.config.js` and `.prettierrc.json`, and a configuration cannot
# demonstrate anything about itself — a rule misspelled, scoped to a path that
# does not exist, or dropped by a preset reads exactly like a rule that works.
# So each gets a fixture carrying the violation it names.
#
# THE VIOLATIONS SHARE TWO FIXTURES. Every case here runs a typechecker, a
# linter, a formatter and a test runner over a miniature tree, and a fixture
# per rule multiplies that by the rule count — which put this suite over the
# sequencer cap once already.
#
# node_modules is symlinked rather than installed: the toolchain under test
# must be the one this tree pins, and an install per case costs the same cap.
#
# Run:  .chug/tasks/check-source.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-source.sh"
ROOT="$(cd "$HERE/../.." && pwd)"
trap 'rm -rf "$WORK"' EXIT

R="$WORK/repo"

run_in() { # <dir> [mode]
	OUT="$WORK/.out"
	dir="$1"
	shift
	set +e
	# Emptied so a machine exporting it does not point the fixture's lint at
	# the exporter's database.
	(cd "$dir" && CHUG_SAFEQL_DATABASE_URL= "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

# A fixture carrying this repo's real configs. An invented config would pass
# while this tree's rules were broken.
fixture() { # [--no-modules]
	rm -rf "$R"
	mkdir -p "$R/src/domain" "$R/src/contract" "$R/test/domain"
	for f in tsconfig.json tsconfig.contract.json eslint.config.js .prettierrc.json .prettierignore; do
		cp "$ROOT/$f" "$R/$f"
	done
	# Written in the formatter's own output shape, or the format stage fails in
	# every case and each becomes a test of the fixture.
	{
		printf '%s\n' '{'
		printf '%s\n' '  "name": "fixture",'
		printf '%s\n' '  "private": true,'
		printf '%s\n' '  "type": "module"'
		printf '%s\n' '}'
	} > "$R/package.json"
	[ "${1:-}" = "--no-modules" ] || ln -s "$ROOT/node_modules" "$R/node_modules"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
}

# Every fixture needs one clean source, one clean contract module and one
# passing suite, so a case testing one stage is not silently also failing
# another. The contract module is what gives the browser stage an input: `tsc`
# over a program with no files is a failure of its own.
clean_source() {
	printf '%s\n' 'export const answer = 42;' > "$R/src/domain/a.ts"
	printf '%s\n' 'export const wireVersion = 1;' > "$R/src/contract/wire.ts"
	{
		printf '%s\n' 'import { test } from "node:test";'
		printf '%s\n' 'import assert from "node:assert/strict";'
		printf '%s\n' 'import { answer } from "../../src/domain/a.ts";'
		printf '%s\n' ''
		printf '%s\n' 'test("the fixture holds", () => {'
		printf '%s\n' '  assert.equal(answer, 42);'
		printf '%s\n' '});'
	} > "$R/test/domain/a.test.ts"
}

# A suite that fails on purpose, so a case can ask whether the stage ran it at
# all. Written in the formatter's output shape, like every fixture file here.
failing_suite() { # <path> <test name>
	{
		printf '%s\n' 'import { test } from "node:test";'
		printf '%s\n' 'import assert from "node:assert/strict";'
		printf '%s\n' ''
		printf '%s\n' "test(\"$2\", () => {"
		printf '%s\n' '  assert.equal(1, 2);'
		printf '%s\n' '});'
	} > "$1"
}

seal() {
	git -C "$R" add -A
	run_in "$R"
}

# --- The gate's own contract -------------------------------------------------

run_in "$WORK"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

fixture
seal
check "no TypeScript exits 2, not 0" 2 "$RC" "the glob matched nothing"

fixture --no-modules
clean_source
seal
check "a missing toolchain exits 2, not 0" 2 "$RC" "Install with"

# A tree with sources but no suite would run the other stages and report clean.
fixture
printf '%s\n' 'export const answer = 42;' > "$R/src/domain/a.ts"
seal
check "sources with no suite exits 2, not 0" 2 "$RC" "the suite glob matched nothing"

# The clean tree also carries a tagged adapter query, and the run sets
# CHUG_SAFEQL_DATABASE_URL to an address nothing answers, bypassing run_in's
# emptying: the gate empties the variable for its lint stage itself, so an
# operator who exports it shell-wide cannot make check-source need a
# database — without that emptying, the checker would activate, fail to
# connect, and turn this clean run red.
fixture
clean_source
mkdir -p "$R/src/adapters/postgres"
{
	printf '%s\n' 'import { sql } from "@ts-safeql/sql-tag";'
	printf '%s\n' 'import type pg from "pg";'
	printf '%s\n' 'export async function tagged(client: pg.PoolClient): Promise<void> {'
	printf '%s\n' '  await client.query<{ one: number }>(sql`SELECT 1 AS one`);'
	printf '%s\n' '}'
} > "$R/src/adapters/postgres/tagged.ts"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_SAFEQL_DATABASE_URL="postgres://fixture@127.0.0.1:1/void" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a clean tree passes every stage" 0 "$RC" "0 stage(s) failed"
# The tally is asserted rather than trusted: it is what says the run measured
# something.
check "the clean line counts the stages it ran" 0 "$RC" "0 stage(s) failed, 5 run"
check "an exported checker database does not reach the lint stage" 0 "$RC" "0 stage(s) failed, 5 run"

run_in "$R" --static
check "static mode runs only the four static stages" 0 "$RC" "0 stage(s) failed, 4 run"
check "static mode does not discover unit suites" 0 "$RC" "typecheck: clean"

run_in "$R" --unit
check "unit mode runs only the unit stage" 0 "$RC" "0 stage(s) failed, 1 run"
check "unit mode reports the suite partition" 0 "$RC" "unit ran 1 suite(s)"

# A checkout nested inside the checkout. The parallel worktrees live under
# .claude/, each with a tsconfig of its own, so a linter that walks in lints
# every copy of the tree against a program of its own; eslint.config.js is
# where it is told not to. The nested tsconfig is what makes the copy a second
# program rather than a second file.
fixture
clean_source
mkdir -p "$R/.claude/worktrees/agent-x/src/domain"
cp "$ROOT/tsconfig.json" "$R/.claude/worktrees/agent-x/tsconfig.json"
{
	printf '%s\n' 'export async function work(): Promise<void> {'
	printf '%s\n' '  return Promise.resolve();'
	printf '%s\n' '}'
	printf '%s\n' 'export function caller(): void {'
	printf '%s\n' '  work();'
	printf '%s\n' '}'
} > "$R/.claude/worktrees/agent-x/src/domain/floating.ts"
seal
check "a checkout nested under .claude/ is not this tree's source" 0 "$RC" "0 stage(s) failed"

# --- What the unit stage runs ------------------------------------------------
#
# `check-conformance.sh`, `check-random.sh` and `check-postgres.sh` own their
# directories, and a suite of theirs failing here would mean this stage had
# discovered it anyway. So all three are made to fail and the gate is required
# to pass regardless. The postgres one also cannot run here at all — it needs a
# server — which is the second reason its directory is subtracted.

fixture
clean_source
mkdir -p "$R/test/conformance" "$R/test/random" "$R/test/postgres"
failing_suite "$R/test/conformance/replay.test.ts" "the corpus gate's own"
failing_suite "$R/test/random/walk.test.ts" "the walk gate's own"
failing_suite "$R/test/postgres/journal.test.ts" "the server gate's own"
seal

check "the owning gates' suites are not this stage's" 0 "$RC" "0 stage(s) failed"
# The split is asserted against a fixture whose suites this file wrote, so the
# line cannot report a scope the run did not have.
check "the clean line reports the split it ran" 0 "$RC" "unit ran 1 suite(s); 3 left to check-conformance, check-random and check-postgres"

# --- What the browser stage sees that the first typecheck does not ------------
#
# A platform import inside the contract typechecks against `tsconfig.json`,
# which gives every source the platform's own types. Only the second program
# refuses it, so this case is what says the browser stage ran at all.

fixture
clean_source
{
	printf '%s\n' 'import { randomUUID } from "node:crypto";'
	printf '%s\n' 'export const identity = (): string => randomUUID();'
} > "$R/src/contract/identity.ts"
seal
check "a platform import in the contract fails the browser stage" 1 "$RC" "1 stage(s) failed"
check "the first typecheck accepts what the browser stage refuses" 1 "$RC" "typecheck: clean"
check "the browser stage names the module it refused" 1 "$RC" "src/contract/identity.ts"

# --- The house rules ---------------------------------------------------------
#
# TWO FIXTURES, NOT ONE PER RULE. Every stage runs whatever the earlier ones
# did, so one tree carrying several violations reports all of them in a single
# pass and each case greps the output for its own rule name — a rule dropped
# from the config still fails its own case and no other.
#
# The split is by stage rather than by rule: the lint fixture must typecheck
# and must be formatted, or the case would pass on a finding it did not mean.

fixture
clean_source
{
	printf '%s\n' 'export const stamped = Date.now();'
	printf '%s\n' 'export const drawn = Math.random();'
	printf '%s\n' 'export const home = process.env.HOME;'
	printf '%s\n' 'export const later = setTimeout(() => undefined, 1);'
} > "$R/src/domain/ambient.ts"
{
	printf '%s\n' 'import { join } from "node:path";'
	printf '%s\n' 'export const p = join("a", "b");'
} > "$R/src/domain/imports.ts"
# The actor carries the same ambient ban under its own claim, so the same
# constructs must be findings one directory over and named for that layer.
mkdir -p "$R/src/actor"
{
	printf '%s\n' 'export const stamped = Date.now();'
	printf '%s\n' 'export const drawn = Math.random();'
} > "$R/src/actor/ambient.ts"
# And the interpreter, whose ports are its only capability: a scoped block that
# named a path nothing matches would read exactly like a working one.
mkdir -p "$R/src/interpreter"
{
	printf '%s\n' 'export const stamped = Date.now();'
	printf '%s\n' 'export const drawn = Math.random();'
} > "$R/src/interpreter/ambient.ts"
# And the contract, which neither of its own boundary halves can see here: a
# browser global names no module for the graph rule, and the browser stage
# accepts it because a browser is exactly what provides it.
{
	printf '%s\n' 'export const stamped = Date.now();'
	printf '%s\n' 'export const drawn = Math.random();'
	printf '%s\n' 'export const identity = crypto.randomUUID();'
} > "$R/src/contract/ambient.ts"
{
	printf '%s\n' 'type Kind = { k: "a" } | { k: "b" };'
	printf '%s\n' 'export function pick(v: Kind): string {'
	printf '%s\n' '  switch (v.k) {'
	printf '%s\n' '    case "a":'
	printf '%s\n' '      return "a";'
	printf '%s\n' '  }'
	printf '%s\n' '  return "?";'
	printf '%s\n' '}'
} > "$R/src/domain/partial.ts"
{
	printf '%s\n' 'export async function work(): Promise<void> {'
	printf '%s\n' '  return Promise.resolve();'
	printf '%s\n' '}'
	printf '%s\n' 'export function caller(): void {'
	printf '%s\n' '  work();'
	printf '%s\n' '}'
} > "$R/src/domain/floating.ts"
{
	printf '%s\n' 'export function long(): number {'
	printf '%s\n' '  let n = 0;'
	i=0
	while [ "$i" -lt 71 ]; do
		printf '%s\n' "  n += 1;"
		i=$((i + 1))
	done
	printf '%s\n' '  return n;'
	printf '%s\n' '}'
} > "$R/src/domain/long.ts"
# The adapter's query ratchet needs no server, and every one of its selectors
# is proved against the shape it forbids: an untagged template, a plain
# string, a foreign tag, a second values argument, a runtime-assembled
# argument, and a handle the checker's wrapper pattern does not name. The
# runtime argument is named `statement` on purpose, which pool.ts is exempted
# for and this file is not, so the case proves the exemption is scoped to that
# file rather than shared across the directory.
mkdir -p "$R/src/adapters/postgres"
{
	printf '%s\n' 'import { sql } from "@ts-safeql/sql-tag";'
	printf '%s\n' 'import type pg from "pg";'
	printf '%s\n' 'const other = String.raw;'
	printf '%s\n' 'export async function untagged('
	printf '%s\n' '  client: pg.PoolClient,'
	printf '%s\n' '  tx: pg.PoolClient,'
	printf '%s\n' '  statement: string,'
	printf '%s\n' '): Promise<void> {'
	printf '%s\n' '  await client.query(`SELECT 1`);'
	printf '%s\n' '  await client.query("SELECT 2");'
	printf '%s\n' '  await client.query(other`SELECT 3`);'
	printf '%s\n' '  await client.query<{ one: number }>(sql`SELECT ${1}::int AS one`, [2]);'
	printf '%s\n' '  await client.query(statement);'
	printf '%s\n' '  await tx.query(sql`SELECT 4`);'
	printf '%s\n' '}'
} > "$R/src/adapters/postgres/untagged.ts"
seal

check "house rule 2: the domain may not read a clock" 1 "$RC" "the domain takes time as an argument"
check "house rule 2: the domain may not draw randomness" 1 "$RC" "the domain takes its draws as arguments"
check "house rule 2: the domain may not read the environment" 1 "$RC" "the domain reads no environment"
check "house rule 2: the domain may not schedule" 1 "$RC" "the domain schedules nothing"
check "house rule 2: the domain may not import a platform module" 1 "$RC" "imports no platform module"
check "house rule 3: a non-total switch is a finding" 1 "$RC" "Switch is not exhaustive"
check "house rule 4: a floating promise is a finding" 1 "$RC" "Promises must be awaited"
check "house rule 5: a function over the cap is a finding" 1 "$RC" "Maximum allowed is 70"
check "the actor may not read a clock either" 1 "$RC" "the journaled actor takes time as an argument"
check "the actor may not draw randomness either" 1 "$RC" "the journaled actor takes its draws as arguments"
check "the interpreter may not read a clock either" 1 "$RC" "the interpreter takes time as an argument"
check "the interpreter may not draw randomness either" 1 "$RC" "the interpreter takes its draws as arguments"
check "the contract may not read a clock" 1 "$RC" "the public contract takes time"
check "the contract may not draw randomness" 1 "$RC" "the public contract takes its draws"
check "the contract may not draw an identifier" 1 "$RC" "the public contract takes identifiers"
check "an untagged query template is a finding" 1 "$RC" "an untagged template is invisible to check-queries"
check "a plain-string query is a finding" 1 "$RC" "a plain string is invisible to check-queries"
check "a query under another tag is a finding" 1 "$RC" "another tag is not checked"
check "separate values cannot replace a checked tag's values" 1 "$RC" "pg would replace the checked tag's values"
check "a runtime-assembled query is a finding" 1 "$RC" "assembled at runtime cannot be checked"
check "a query on an unnamed handle is a finding" 1 "$RC" "one on another handle is checked by nothing"

# The floating-promise exemption is narrow: node:test's own functions and
# nothing else. The clean fixture's suite calls `test` without awaiting it, so
# "a clean tree passes every stage" pins that the exemption exists and the case
# above pins its width.

# --- The stages that are not the linter's ------------------------------------

fixture
clean_source
printf '%s\n' 'export const  spaced   =    1;' > "$R/src/domain/ugly.ts"
printf '%s\n' 'export const wrong: number = "a string";' > "$R/src/domain/mistyped.ts"
failing_suite "$R/test/domain/failing.test.ts" "this one is meant to fail"
# test/golden carries the corpus's own coverage suite, which neither the corpus
# gate nor the walk gate discovers: a failure there surfaces in this stage or
# in none at all.
mkdir -p "$R/test/golden"
failing_suite "$R/test/golden/coverage.test.ts" "this golden one is meant to fail"
# The discovery is the whole tree, not test/: a suite beside its source runs
# here or nowhere.
mkdir -p "$R/src/actor"
failing_suite "$R/src/actor/stray.test.ts" "this stray one is meant to fail"
seal

check "house rule 6: unformatted source is a finding" 1 "$RC" "Code style issues found"
check "a type error is a finding" 1 "$RC" "not assignable"
check "a failing unit test is a finding" 1 "$RC" "this one is meant to fail"
check "a test/golden suite is this stage's own" 1 "$RC" "this golden one is meant to fail"
check "a suite outside test/ is this stage's own" 1 "$RC" "this stray one is meant to fail"
check "each stage reports independently of the others" 1 "$RC" "3 stage(s) failed"

done_ "check-source.test.sh"
