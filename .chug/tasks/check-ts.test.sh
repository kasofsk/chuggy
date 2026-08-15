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
# MOST CASES NAME ONE STAGE. A full five-stage run costs about two seconds; a
# single stage costs between a tenth and a third of that, and a case about the
# purity rule learns nothing from also formatting the fixture. Two cases run
# every stage on purpose: one to show a clean tree is clean, and one to show
# that a finding in an early stage does not stop a later one from reporting its
# own. The suite is ~12.5s in total (measured 2026-08-15, twenty-seven fixture
# trees); it is the slowest thing `.chug/tasks/ci.sh` runs before the model, so
# a new case should earn its second.
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

# 4. The breach three hops down. Nothing in `pure.ts` looks impure; it imports
#    a neighbour that imports a neighbour.
#
#    THE ASSERTION IS ON THE CHAIN'S ORIGIN, and the earlier version of this
#    case — which asserted the chain's far END — was vacuous. Every hop of an
#    all-domain chain has a domain file as its SOURCE, so the non-transitive
#    form of the rule reports `deep.ts → fs` on its own and the case passed
#    with `reachable` deleted. What transitivity actually adds is the ability
#    to name `pure.ts` — the module a reader would call innocent — as reaching
#    `fs`, and to see through the `.test.ts` files the `from` set excludes.
#    Asserting the origin is what makes the deletion visible.
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
check "a transitive path out of src/domain names its origin" 1 "$RC" \
	"domain-is-pure: src/domain/pure.ts → fs"

# 5. A/B on the file extension, and the reason this case exists: a byte-identical
#    clock was a finding in `pure.ts` and clean in `pure.mts`, because both lint
#    configs globbed `*.ts` and tsc's include did too. The A half is case 2; this
#    is the B half, and it fails if either glob narrows back.
scaffold
cat >"$R/src/domain/clock.mts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
run purity
check "a clock in a .mts domain file is a finding too" 1 "$RC" 'may not reach `Date`'

# 6. The floor beneath both globs. A file under `src/domain/` that no purity
#    configuration matches must be a FINDING and not a silence — which is the
#    property that makes the next extension loud without anyone remembering to
#    widen a glob for it. Handed a directory, eslint would never have seen this
#    file at all.
scaffold
printf 'not a source file\n' >"$R/src/domain/notes.txt"
run purity
check "a file no purity config matches is a finding" 1 "$RC" \
	"File ignored because no matching configuration was supplied"

# 7. The compensating control for the graph half's `.test.ts` exemption: domain
#    tests are exempt from the module-graph `from` set, so the ambient roster
#    has to cover them. Narrowing the purity glob to exclude `.test.ts` turns
#    this red and nothing else.
scaffold
cat >>"$R/src/domain/pure.test.ts" <<'TS'

export function stampedAt(): number {
  return Date.now();
}
TS
run purity
check "the ambient roster covers domain tests" 1 "$RC" 'may not reach `Date`'

# 8. The positive control. The same call one directory across is legal, so the
#    rule is scoped to the directory it names rather than to the tree.
scaffold
cat >"$R/src/adapters/clock.ts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
run purity
check "Date.now in src/adapters is clean" 0 "$RC" "purity clean"

# 9. Hiding the impure module behind a test name inside the directory does not
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

# 10. The rule about test imports, pinned where nothing else can fire: an inert
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

# 11. Types.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export const wrong: number = "not a number";
TS
run types
check "a type error is a finding" 1 "$RC" "is not assignable to type"

# 12. Lint, on the rule that mechanizes the engineering bar rather than a
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

# 13. Format.
scaffold
printf 'export const spaced   =    1\n' >"$R/src/domain/ugly.ts"
run format
check "an unformatted file is a finding" 1 "$RC" "src/domain/ugly.ts"

# 14. A failing test is a finding, not an error.
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

# 15. No test files at all exits 2, not 0. A test runner handed a glob that
#     matches nothing exits clean with zero tests, which is the one way this
#     stage could pass while checking nothing.
scaffold
rm "$R/src/domain/pure.test.ts"
run test
check "no tests found exits 2, not 0" 2 "$RC" "matched nothing"

# 16. Every selected stage runs. Two defects in different stages, one run, both
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

# --- The could-not-run machinery --------------------------------------------
# "2 is not a pass" is this gate's headline promise, and until these cases
# existed nothing defended it: three separate deliberate breaks of the
# verdict-2 paths left the suite entirely green. Every branch that can answer
# 2 gets a case, because the branch that answers 2 is the one that runs on the
# day nobody is watching.

# 17. No toolchain installed.
scaffold
rm "$R/node_modules"
run
check "a missing node_modules exits 2, not 0" 2 "$RC" "npm ci"

# 18. A stage whose tool could not run at all, as opposed to one that ran and
#     disagreed. eslint reserves exit 2 for a configuration it cannot load;
#     turning that arm into a finding would report a linter that never linted
#     as a linter that found something.
scaffold
printf 'export default [ this is not javascript\n' >"$R/eslint.config.js"
run lint
check "an unloadable lint config exits 2, not 1" 2 "$RC" "could not run"

# 19. depcruise printing no verdict. Its exit code is a violation count, so a
#     crash and a finding are the same number; the printed line is the only
#     thing that separates them, and this is the guard that reads it.
scaffold
rm "$R/.dependency-cruiser.mjs"
run purity
check "depcruise with no verdict exits 2, not 1" 2 "$RC" "produced no verdict"

# 20. And the other direction: depcruise hands its violation COUNT to
#     `process.exit`, so a shell reads 256 violations as status 0. Measured,
#     not theorised — 256 domain files each importing `node:fs` exits 0 and
#     prints `256 errors`. A gate that trusted the code would call the dirtiest
#     graph this tree can produce clean, so the count is read from the printed
#     line and the code is only a corroborator.
scaffold
n=0
while [ "$n" -lt 256 ]; do
	printf 'export { readFileSync } from "node:fs";\n' >"$R/src/domain/leak$n.ts"
	n=$((n + 1))
done
run purity
check "256 violations wrap the exit code to 0 and are still a finding" 1 "$RC" \
	"256 errors"

# 21. A node that cannot run TypeScript. Simulated faithfully rather than
#     mocked: the shim is the real binary with type stripping switched off, so
#     both the probe and the test run behave exactly as they would on a host
#     below the version `package.json` requires. Without the probe this reads
#     as a test failure — a finding — which would blame the tree for the
#     toolchain.
scaffold
mkdir -p "$WORK/shim"
cat >"$WORK/shim/node" <<SHIM
#!/bin/sh
exec "$(command -v node)" --no-experimental-strip-types "\$@"
SHIM
chmod +x "$WORK/shim/node"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$WORK/shim:$PATH" "$SUT" test) >"$OUT" 2>&1
RC=$?
set -e
check "a node that cannot strip types exits 2, not 1" 2 "$RC" \
	"cannot run TypeScript directly"

# 22. The types stage's own could-not-run: the project file is absent. tsc
#     answers a MALFORMED tsconfig with the same code it uses for a type
#     error, so that case is a finding by design and stated as such in the
#     gate; an absent one is genuinely could-not-run and is guarded before tsc
#     is invoked at all.
scaffold
rm "$R/tsconfig.json"
run types
check "a missing tsconfig.json exits 2, not 1" 2 "$RC" "tsconfig.json is missing"

# 23. An empty domain is not a pure one. If the ambient half is handed no
#     files it has checked nothing, and printing "purity clean" for that is the
#     same lie as a test glob that matched nothing.
scaffold
rm -r "$R/src/domain"
mkdir -p "$R/src/domain"
run purity
check "an empty src/domain exits 2, not 0" 2 "$RC" "checked nothing"

# 24. Outside a git checkout there is no tree to judge.
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

# 25. An unknown stage is a caller error, not a silent full run.
scaffold
run nosuchstage
check "an unknown stage exits 2" 2 "$RC" "unknown stage nosuchstage"

done_ "check-ts.test.sh"
