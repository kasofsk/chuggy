#!/bin/sh
# Shell test for check-source.sh.
#
# THIS SUITE IS WHERE HOUSE RULES 2 THROUGH 6 ARE PROVED TO BITE. The rules
# themselves live in `eslint.config.js` and `.prettierrc.json`, and a
# configuration file cannot demonstrate anything about itself — a rule
# misspelled, scoped to a path that does not exist, or silently dropped by a
# preset reads exactly like a rule that is working. So each one gets a fixture
# carrying the violation it names, and the case fails if the gate does not.
#
# The cost of that is real: every case here runs a typechecker, a linter, a
# formatter and a test runner over a miniature tree, where the sibling suites
# run an awk pass. It is the slowest suite in `.chug/tasks/` and it earns that
# by being the only thing standing between "the rules are configured" and "the
# rules are enforced".
#
# THE VIOLATIONS SHARE ONE FIXTURE, deliberately. A file per rule would be
# clearer to read and would multiply the linter runs by the number of rules;
# the gate reports every finding it has, so one file carrying all of them lets
# each case assert its own rule name against one run.
#
# node_modules is symlinked rather than installed, on
# check-boundaries.test.sh's argument: the toolchain under test must be the one
# this tree pins, and an install per case would put this suite far outside the
# sequencer's per-suite cap.
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

# A fixture carrying this repo's real configs. Testing invented configs would
# pass while this tree's rules were broken, which is the failure this suite
# exists to prevent.
fixture() { # [--no-modules]
	rm -rf "$R"
	mkdir -p "$R/src/domain" "$R/test/domain"
	for f in tsconfig.json eslint.config.js .prettierrc.json .prettierignore; do
		cp "$ROOT/$f" "$R/$f"
	done
	# Written in the formatter's own output shape. A fixture manifest Prettier
	# would rewrite makes the format stage fail in every case, which turns each
	# one into a test of the fixture rather than of the rule it names.
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

# Every fixture needs one clean source and one passing suite, so a case that is
# testing one stage is not silently also failing another.
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

# A tree with sources but no suite would run three stages and report clean,
# which is the shape of a check that never ran.
fixture
printf '%s\n' 'export const answer = 42;' > "$R/src/domain/a.ts"
seal
check "sources with no suite exits 2, not 0" 2 "$RC" "the suite glob matched nothing"

fixture
clean_source
seal
check "a clean tree passes every stage" 0 "$RC" "0 stage(s) failed"

# --- House rule 2: the domain reaches no ambient capability ------------------

# One fixture, every violation, one linter run. Each case below asserts its own
# rule against it, so a rule silently dropped from the config fails its case
# and no other.
fixture
clean_source
{
	printf '%s\n' 'export const stamped = Date.now();'
	printf '%s\n' 'export const drawn = Math.random();'
	printf '%s\n' 'export const home = process.env.HOME;'
	printf '%s\n' 'export const later = setTimeout(() => undefined, 1);'
} > "$R/src/domain/impure.ts"
seal
check "house rule 2: the domain may not read a clock" 1 "$RC" "the domain takes time as an argument"
check "house rule 2: the domain may not draw randomness" 1 "$RC" "the domain takes its draws as arguments"
check "house rule 2: the domain may not read the environment" 1 "$RC" "the domain reads no environment"
check "house rule 2: the domain may not schedule" 1 "$RC" "the domain schedules nothing"

fixture
clean_source
{
	printf '%s\n' 'import { join } from "node:path";'
	printf '%s\n' 'export const p = join("a", "b");'
} > "$R/src/domain/imports.ts"
seal
check "house rule 2: the domain may not import a platform module" 1 "$RC" "imports no platform module"

# --- House rule 3: exhaustive switching --------------------------------------

fixture
clean_source
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
seal
check "house rule 3: a non-total switch is a finding" 1 "$RC" "Switch is not exhaustive"

# --- House rule 4: no floating promises --------------------------------------

fixture
clean_source
{
	printf '%s\n' 'export async function work(): Promise<void> {'
	printf '%s\n' '  return Promise.resolve();'
	printf '%s\n' '}'
	printf '%s\n' 'export function caller(): void {'
	printf '%s\n' '  work();'
	printf '%s\n' '}'
} > "$R/src/domain/floating.ts"
seal
check "house rule 4: a floating promise is a finding" 1 "$RC" "Promises must be awaited"

# The exemption is narrow: node:test's own functions and nothing else. If it
# ever widens to the whole suite tree, this case still passes and the one
# above stops meaning anything — so the clean fixture's suite, which calls
# `test` without awaiting it, is the case that pins the exemption's existence
# and the case above pins its width.

# --- House rule 5: the function length cap -----------------------------------

fixture
clean_source
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
check "house rule 5: a function over the cap is a finding" 1 "$RC" "Maximum allowed is 70"

# --- House rule 6: the formatter's output, never argued ----------------------

fixture
clean_source
printf '%s\n' 'export const  spaced   =    1;' > "$R/src/domain/ugly.ts"
seal
check "house rule 6: unformatted source is a finding" 1 "$RC" "Code style issues found"

# --- The two stages that are not house rules ---------------------------------

fixture
clean_source
printf '%s\n' 'export const wrong: number = "a string";' > "$R/src/domain/mistyped.ts"
seal
check "a type error is a finding" 1 "$RC" "not assignable"

fixture
clean_source
{
	printf '%s\n' 'import { test } from "node:test";'
	printf '%s\n' 'import assert from "node:assert/strict";'
	printf '%s\n' ''
	printf '%s\n' 'test("this one is meant to fail", () => {'
	printf '%s\n' '  assert.equal(1, 2);'
	printf '%s\n' '});'
} > "$R/test/domain/failing.test.ts"
seal
check "a failing unit test is a finding" 1 "$RC" "1 stage(s) failed"

done_ "check-source.test.sh"
