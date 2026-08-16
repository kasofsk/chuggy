#!/bin/sh
# Shell test for check-boundaries.sh.
#
# EVERY RULE IN `.dependency-cruiser.cjs` GETS A TREE THAT VIOLATES IT. A rule
# that has never rejected anything is an unverified control, and the real tree
# passes, which is what a fixture carrying the violation is for. The config
# holds a rule per directory that exists and this suite holds a case per rule
# in it; a slice that lands a source layer lands both.
#
# The fixtures are whole miniature trees rather than single files, because a
# reachability rule cannot be violated by one module: the shape it catches is
# `domain -> helper -> node:fs`, where every file is individually innocent.
# Each copies the real config — a suite testing a config of its own invention
# would pass while this tree's rules were broken.
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

# node_modules is symlinked rather than installed: depcruise and its resolver
# must be the ones this tree pins, and an install per case would put this suite
# outside the sequencer per-suite cap.
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

# Could-not-run is not a pass, and each way it happens is reported as itself.
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

# A tree that breaks no rule is clean, which is what makes every case below a
# statement about the rule rather than about the fixture. The fixture holds a
# source and a suite and the cruise reads both, where the tracked-source glob
# lists only the first.
fixture
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
seal
check "a clean graph passes" 0 "$RC" "graph clean"
check "the clean line counts the modules cruised" 0 "$RC" "across 2 module(s)"

# --- domain-is-pure, the rule house rule 2 is stated in -----------------------

fixture
printf '%s\n' 'import { join } from "node:path"' 'export const x = join("a", "b")' > "$R/src/domain/a.ts"
seal
check "the domain may not import a platform module" 1 "$RC" "domain-is-pure"

# Every file here is individually innocent, so only reachability sees it.
fixture
mkdir -p "$R/src/domain/util"
printf '%s\n' 'import { join } from "node:path"' 'export const paths = (a: string) => join(a, "b")' > "$R/src/domain/util/paths.ts"
printf '%s\n' 'import { paths } from "./util/paths.ts"' 'export const decide = () => paths("x")' > "$R/src/domain/a.ts"
seal
check "the domain may not REACH a platform module transitively" 1 "$RC" "domain-is-pure"

fixture
mkdir -p "$R/src/interpreter"
printf '%s\n' 'export const port = 1' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../interpreter/port.ts"' 'export const x = port' > "$R/src/domain/a.ts"
seal
check "the domain may not reach outward" 1 "$RC" "domain-is-pure"

# --- actor-sees-domain-only --------------------------------------------------

# The actor importing the domain is the allowed direction, so the rule's clean
# side is proved before its bite: a red here would mean the rule over-fires on
# the one edge the layer exists to take.
fixture
mkdir -p "$R/src/actor"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../domain/a.ts"' 'export const y = x' > "$R/src/actor/b.ts"
printf '%s\n' 'import { y } from "../src/actor/b.ts"' 'export const z = y' > "$R/test/a.test.ts"
seal
check "the actor importing the domain is clean" 0 "$RC" "graph clean"
check "the clean actor graph counts every module cruised" 0 "$RC" "across 3 module(s)"

# The same tree with one platform import added: the domain edge stays innocent,
# so only the actor's own rule can catch it.
fixture
mkdir -p "$R/src/actor"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../domain/a.ts"' 'import { join } from "node:path"' 'export const y = join("a", String(x))' > "$R/src/actor/b.ts"
printf '%s\n' 'import { y } from "../src/actor/b.ts"' 'export const z = y' > "$R/test/a.test.ts"
seal
check "the actor may not reach past the domain" 1 "$RC" "actor-sees-domain-only"

# --- The layer boundaries ----------------------------------------------------

# The suites are downstream of every part of src/. From the domain the broader
# purity rule catches it first, so this case proves only what it says; the rule
# of its own name gets a case in the slice that lands a second source layer.
fixture
printf '%s\n' 'export const helper = 1' > "$R/test/helper.ts"
printf '%s\n' 'import { helper } from "../../test/helper.ts"' 'export const x = helper' > "$R/src/domain/a.ts"
seal
check "a source reaching a suite is a finding" 1 "$RC" "domain-is-pure"

# A cycle makes the layer a module belongs to unanswerable.
fixture
printf '%s\n' 'import { b } from "./b.ts"' 'export const a = b' > "$R/src/domain/a.ts"
printf '%s\n' 'import { a } from "./a.ts"' 'export const b = a' > "$R/src/domain/b.ts"
seal
check "a cycle is a finding" 1 "$RC" "no-circular-dependency"

# A module nothing reaches is dead or is a boundary nobody crossed.
fixture
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const orphaned = 1' > "$R/src/domain/orphan.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
seal
check "an orphan module is a finding" 1 "$RC" "no-orphan-module"

done_ "check-boundaries.test.sh"
