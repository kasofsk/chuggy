#!/bin/sh
# Shell test for check-boundaries.sh.
#
# EVERY RULE IN `.dependency-cruiser.cjs` GETS A TREE THAT VIOLATES IT. That is
# the whole purpose of this suite and the reason it is slower than its
# siblings: a boundary rule that has never rejected anything is an unverified
# control, and this repo's standing position is that one of those is worse than
# none. Running the gate against the real tree proves nothing — the real tree
# passes, which is what a fixture carrying the violation is for.
#
# The config holds a rule per directory that exists, so this suite holds a case
# per rule in it. Both grow together: a slice that lands a source layer lands
# its boundary rule and the case that proves the rule bites, in the same
# commit.
#
# The fixtures are whole miniature trees rather than single files, because a
# reachability rule cannot be violated by one module: the shape it catches is
# `domain -> helper -> node:fs`, where every file is individually innocent.
#
# EACH FIXTURE COPIES THE REAL CONFIG rather than writing its own. A suite that
# tested a config of its own invention would pass while this tree's rules were
# broken, which is the failure it exists to prevent.
#
# Run:  .chug/tasks/check-boundaries.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-boundaries.sh"
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

# A fixture tree carrying this repo's real config and toolchain. node_modules
# is symlinked rather than installed: depcruise and its resolver must be the
# ones this tree pins, and an install per case would put this suite far outside
# the sequencer's per-suite cap.
fixture() {
	rm -rf "$R"
	mkdir -p "$R/src/domain" "$R/test"
	git -C "$ROOT" show HEAD:tsconfig.json > "$R/tsconfig.json" 2>/dev/null ||
		cp "$ROOT/tsconfig.json" "$R/tsconfig.json"
	cp "$ROOT/.dependency-cruiser.cjs" "$R/.dependency-cruiser.cjs"
	printf '%s\n' '{ "name": "fixture", "private": true, "type": "module" }' > "$R/package.json"
	ln -s "$ROOT/node_modules" "$R/node_modules"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
}

# Every fixture needs at least one tracked source or the gate exits 2 before it
# reaches a rule, and the case would pass for the wrong reason.
seal() {
	git -C "$R" add -A
	run_in "$R"
}

# --- The gate's own contract -------------------------------------------------

# 1. Could-not-run is not a pass, and each of the three ways it happens is
#    reported as itself.
run_in "$WORK"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

fixture
rm "$R/.dependency-cruiser.cjs"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
seal
check "no config exits 2, not 0" 2 "$RC" "there are no rules to apply"

fixture
seal
check "an empty src exits 2, not 0" 2 "$RC" "the graph would be empty"

# 2. A tree that breaks no rule is clean, which is what makes every case below
#    a statement about the rule rather than about the fixture.
fixture
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
seal
check "a clean graph passes" 0 "$RC" "graph clean"

# --- domain-is-pure, the rule house rule 2 is stated in -----------------------

# 3. The direct case: a domain module importing a platform module.
fixture
printf '%s\n' 'import { join } from "node:path"' 'export const x = join("a", "b")' > "$R/src/domain/a.ts"
seal
check "the domain may not import a platform module" 1 "$RC" "domain-is-pure"

# 4. THE CASE THAT MOTIVATES THE WHOLE RULE. Every file here is individually
#    innocent: the helper is not a decider, and the decider imports nothing
#    forbidden. Only reachability sees it, which is why this gate exists
#    alongside the linter rather than instead of it.
fixture
mkdir -p "$R/src/domain/util"
printf '%s\n' 'import { join } from "node:path"' 'export const paths = (a: string) => join(a, "b")' > "$R/src/domain/util/paths.ts"
printf '%s\n' 'import { paths } from "./util/paths.ts"' 'export const decide = () => paths("x")' > "$R/src/domain/a.ts"
seal
check "the domain may not REACH a platform module transitively" 1 "$RC" "domain-is-pure"

# 5. The same shape one layer out: the domain reaching the interpreter, which
#    is the direction the whole arrangement forbids.
fixture
mkdir -p "$R/src/interpreter"
printf '%s\n' 'export const port = 1' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../interpreter/port.ts"' 'export const x = port' > "$R/src/domain/a.ts"
seal
check "the domain may not reach outward" 1 "$RC" "domain-is-pure"

# --- The layer boundaries ----------------------------------------------------

# 6. The suites are downstream of every part of src/. From the domain the
#     broader purity rule catches it first, so this case proves only what it
#     says: a suite reached from a source is a finding. The rule of its own
#     name gets its own case in the slice that lands a second source layer,
#     because until then no directory exists that purity does not already
#     cover.
fixture
printf '%s\n' 'export const helper = 1' > "$R/test/helper.ts"
printf '%s\n' 'import { helper } from "../../test/helper.ts"' 'export const x = helper' > "$R/src/domain/a.ts"
seal
check "a source reaching a suite is a finding" 1 "$RC" "domain-is-pure"

# 7. A cycle makes the layer a module belongs to unanswerable.
fixture
printf '%s\n' 'import { b } from "./b.ts"' 'export const a = b' > "$R/src/domain/a.ts"
printf '%s\n' 'import { a } from "./a.ts"' 'export const b = a' > "$R/src/domain/b.ts"
seal
check "a cycle is a finding" 1 "$RC" "no-circular-dependency"

# 8. A module nothing reaches is dead or is a boundary nobody crossed.
fixture
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const orphaned = 1' > "$R/src/domain/orphan.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
seal
check "an orphan module is a finding" 1 "$RC" "no-orphan-module"

done_ "check-boundaries.test.sh"
