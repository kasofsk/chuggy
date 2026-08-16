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

run_in() { # <dir>
	OUT="$WORK/.out"
	set +e
	(cd "$1" && "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

# A fixture carrying this repo's real configs. An invented config would pass
# while this tree's rules were broken.
fixture() { # [--no-modules]
	rm -rf "$R"
	mkdir -p "$R/src/domain" "$R/test/domain"
	for f in tsconfig.json eslint.config.js .prettierrc.json .prettierignore; do
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

# Every fixture needs one clean source and one passing suite, so a case testing
# one stage is not silently also failing another.
clean_source() {
	printf '%s\n' 'export const answer = 42;' > "$R/src/domain/a.ts"
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

fixture
clean_source
seal
check "a clean tree passes every stage" 0 "$RC" "0 stage(s) failed"
# The tally is asserted rather than trusted: it is what says the run measured
# something.
check "the clean line counts the stages it ran" 0 "$RC" "0 stage(s) failed, 4 run"

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

# The floating-promise exemption is narrow: node:test's own functions and
# nothing else. The clean fixture's suite calls `test` without awaiting it, so
# "a clean tree passes every stage" pins that the exemption exists and the case
# above pins its width.

# --- The stages that are not the linter's ------------------------------------

fixture
clean_source
printf '%s\n' 'export const  spaced   =    1;' > "$R/src/domain/ugly.ts"
printf '%s\n' 'export const wrong: number = "a string";' > "$R/src/domain/mistyped.ts"
{
	printf '%s\n' 'import { test } from "node:test";'
	printf '%s\n' 'import assert from "node:assert/strict";'
	printf '%s\n' ''
	printf '%s\n' 'test("this one is meant to fail", () => {'
	printf '%s\n' '  assert.equal(1, 2);'
	printf '%s\n' '});'
} > "$R/test/domain/failing.test.ts"
seal

check "house rule 6: unformatted source is a finding" 1 "$RC" "Code style issues found"
check "a type error is a finding" 1 "$RC" "not assignable"
check "a failing unit test is a finding" 1 "$RC" "this one is meant to fail"
check "each stage reports independently of the others" 1 "$RC" "3 stage(s) failed"

done_ "check-source.test.sh"
