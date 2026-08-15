#!/bin/sh
# Shell test for check-ts.sh.
#
# THE CASES RUN AGAINST FIXTURE TREES, NOT AGAINST THIS ONE. Asserting against
# the real `src/` would make the suite pass or fail for reasons that have
# nothing to do with the script — and worse, the interesting cases are the
# broken ones, which cannot be committed here. Each fixture is a throwaway git
# checkout carrying the real configuration files and a symlink to the real
# `node_modules`, so the verdicts come from the same prettier, tsc, eslint and
# depcruise that `just check` runs. A fixture with its own hand-written config
# would be testing a second toolchain nobody ships.
#
# MOST CASES NAME ONE STAGE. A full five-stage run costs about a second and a
# half; a single stage costs a fifth of that, and a case about the purity rule
# learns nothing from also formatting the fixture. Two cases run every stage on
# purpose: one to show a clean tree is clean, and one to show that a finding in
# an early stage does not stop a later one from reporting its own.
#
# THE POSITIVE CONTROL IS A CASE, NOT A COMMENT. `Date.now()` in
# `src/adapters/` must stay clean while the identical call in `src/domain/` is
# a finding. A purity rule only ever observed saying no has not been shown to
# be scoped to the directory it names.
#
# Run:  .chug/tasks/check-ts.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-ts.sh"
REPO="$(cd "$HERE/../.." && pwd)"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

# `_suite.sh`'s own `fresh_repo` removes the directory first, which would take
# the `src/` tree with it; this one initializes in place.
fresh_repo_at() { # <dir>
	git -C "$1" init -q -b main
	git -C "$1" config user.email t@example.com
	git -C "$1" config user.name t
}

# A fixture tree: the four layers, the real configuration, the real toolchain,
# and one pure domain module with a passing test. Every case starts here and
# adds exactly the defect it is about.
scaffold() {
	rm -rf "$R"
	mkdir -p "$R/src/domain" "$R/src/effects" "$R/src/interp" "$R/src/adapters"
	fresh_repo_at "$R"
	ln -s "$REPO/node_modules" "$R/node_modules"
	for config in package.json tsconfig.json eslint.config.js \
		eslint.purity.config.js .dependency-cruiser.mjs .prettierignore; do
		cp "$REPO/$config" "$R/$config"
	done
	cat >"$R/src/domain/pure.ts" <<'TS'
export function twice(n: number): number {
  return n * 2;
}
TS
	cat >"$R/src/domain/pure.test.ts" <<'TS'
import assert from "node:assert/strict";
import { test } from "node:test";

import { twice } from "./pure.ts";

test("twice doubles", () => {
  assert.equal(twice(2), 4);
});
TS
}

run_in() { # <dir> [<stage>...]
	_dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$_dir" && "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

run() { # [<stage>...]
	run_in "$R" "$@"
}

# 1. A clean tree passes every stage.
scaffold
run
check "a clean tree is clean" 0 "$RC" "check-ts: clean"

# 2. The ambient-capability half of the purity rule. Three capabilities in one
#    run, and each is asserted by the name it is forbidden under rather than by
#    the shared "may not reach" prefix. The generic needle passed while `Date`
#    was deleted from the restricted list, because `Date.now` is also a
#    restricted PROPERTY and the two mechanisms cover each other — defence in
#    depth is fine, a test that cannot tell them apart is not.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export function stamp(): number {
  return Date.now();
}

export function coin(): number {
  return Math.random();
}

export function home(): string | undefined {
  return process.env["HOME"];
}
TS
run purity
check "a clock in src/domain is a finding" 1 "$RC" 'may not reach `Date`'
check "randomness in src/domain is a finding" 1 "$RC" 'may not reach `Math.random`'
check "an ambient process in src/domain is a finding" 1 "$RC" 'may not reach `process`'

# 3. The module-graph half: a direct import of a node builtin.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export { readFileSync } from "node:fs";
TS
run purity
check "node:fs in src/domain is a finding" 1 "$RC" "domain-is-pure"

# 4. The headline claim: the breach three hops down is caught too. Nothing in
#    `pure.ts` looks impure; it imports a neighbour that imports a neighbour.
scaffold
cat >"$R/src/domain/deep.ts" <<'TS'
export { readFileSync } from "node:fs";
TS
cat >"$R/src/domain/middle.ts" <<'TS'
export { readFileSync } from "./deep.ts";
TS
cat >>"$R/src/domain/pure.ts" <<'TS'

export { readFileSync } from "./middle.ts";
TS
run purity
check "a transitive path out of src/domain is a finding" 1 "$RC" "src/domain/deep.ts"

# 5. The positive control. The same call one directory across is legal, so the
#    rule is scoped to the directory it names rather than to the tree.
scaffold
cat >"$R/src/adapters/clock.ts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
run purity
check "Date.now in src/adapters is clean" 0 "$RC" "purity clean"

# 6. Hiding the impure module behind a test name inside the directory does not
#    work either — and `domain-is-pure` is what stops it, not the rule about
#    test imports: whatever the test file reaches is reachable from the source
#    that imported it, so the node builtin is outside `src/domain/` however
#    many domain-looking files stand in front of it.
scaffold
cat >"$R/src/domain/sneaky.test.ts" <<'TS'
export { readFileSync } from "node:fs";
TS
cat >>"$R/src/domain/pure.ts" <<'TS'

export { readFileSync } from "./sneaky.test.ts";
TS
run purity
check "a test file is no shelter for an impure import" 1 "$RC" "domain-is-pure"

# 7. The rule about test imports, pinned where nothing else can fire: an inert
#    domain test, reaching nothing at all, imported by domain source. Only
#    `domain-not-through-its-tests` has anything to say here, so downgrading or
#    deleting it turns this case red and no other.
scaffold
cat >"$R/src/domain/inert.test.ts" <<'TS'
export const two = 2;
TS
cat >>"$R/src/domain/pure.ts" <<'TS'

export { two } from "./inert.test.ts";
TS
run purity
check "domain source may not import a domain test" 1 "$RC" "domain-not-through-its-tests"

# 8. Types.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export const wrong: number = "not a number";
TS
run types
check "a type error is a finding" 1 "$RC" "is not assignable to type"

# 9. Lint, on the rule that mechanizes the engineering bar rather than a
#    stylistic one: a union switched without every arm.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

type Verdict = { kind: "pass" } | { kind: "fail" };

export function label(v: Verdict): string {
  switch (v.kind) {
    case "pass":
      return "passed";
  }
  return "unknown";
}
TS
run lint
check "a non-exhaustive switch is a finding" 1 "$RC" "Switch is not exhaustive"

# 10. Format.
scaffold
printf 'export const spaced   =    1\n' >"$R/src/domain/ugly.ts"
run format
check "an unformatted file is a finding" 1 "$RC" "src/domain/ugly.ts"

# 11. A failing test is a finding, not an error.
scaffold
cat >"$R/src/domain/broken.test.ts" <<'TS'
import assert from "node:assert/strict";
import { test } from "node:test";

test("this one fails", () => {
  assert.equal(1, 2);
});
TS
run test
check "a failing test is a finding" 1 "$RC" "check-ts: FINDING — test"

# 12. No test files at all exits 2, not 0. A test runner handed a glob that
#     matches nothing exits clean with zero tests, which is the one way this
#     stage could pass while checking nothing.
scaffold
rm "$R/src/domain/pure.test.ts"
run test
check "no tests found exits 2, not 0" 2 "$RC" "matched nothing"

# 13. Every selected stage runs. Two defects in different stages, one run, both
#     reported — a gate that stopped at the first would hide the second.
scaffold
printf 'export const spaced   =    1\n' >"$R/src/domain/ugly.ts"
cat >>"$R/src/domain/pure.ts" <<'TS'

export function stamp(): number {
  return Date.now();
}
TS
run
check "an early finding does not stop a later stage" 1 "$RC" "check-ts: FINDING — purity"
grep -qF "check-ts: FINDING — format" "$OUT" || {
	echo "FAIL - the format finding was not reported alongside the purity one"
	fail=$((fail + 1))
}

# 14. No toolchain installed is could-not-run, never clean.
scaffold
rm "$R/node_modules"
run
check "a missing node_modules exits 2, not 0" 2 "$RC" "npm ci"

# 15. Outside a git checkout there is no tree to judge.
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

# 16. An unknown stage is a caller error, not a silent full run.
scaffold
run nosuchstage
check "an unknown stage exits 2" 2 "$RC" "unknown stage nosuchstage"

done_ "check-ts.test.sh"
