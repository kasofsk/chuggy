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
# A RULE WITH `reachable: true` NEEDS A TREE ONLY REACHABILITY CATCHES, or the
# flag can be deleted with this suite still green and the dimension the config
# calls its whole reason goes unverified.
#
# A CASE NAMES ITS RULE WITH THE COLON THE REPORTER PRINTS AFTER IT. The bare
# name is a substring, and a rule renamed around it — `domain-is-pure-OLD`, a
# stale copy left beside a live one — would satisfy the match and read as the
# rule working.
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
check "the domain may not import a platform module" 1 "$RC" "domain-is-pure:"

# Every file here is individually innocent, so only reachability sees it.
fixture
mkdir -p "$R/src/domain/util"
printf '%s\n' 'import { join } from "node:path"' 'export const paths = (a: string) => join(a, "b")' > "$R/src/domain/util/paths.ts"
printf '%s\n' 'import { paths } from "./util/paths.ts"' 'export const decide = () => paths("x")' > "$R/src/domain/a.ts"
seal
check "the domain may not REACH a platform module transitively" 1 "$RC" "domain-is-pure:"

fixture
mkdir -p "$R/src/interpreter"
printf '%s\n' 'export const port = 1' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../interpreter/port.ts"' 'export const x = port' > "$R/src/domain/a.ts"
seal
check "the domain may not reach outward" 1 "$RC" "domain-is-pure:"

# --- contract-reaches-only-zod -----------------------------------------------

# The allowed direction first: the contract imports its parser and the server's
# layers import the contract. A red here would mean the rule over-fires on the
# two edges the module exists to have.
fixture
mkdir -p "$R/src/contract" "$R/src/interpreter"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { z } from "zod"' 'export const wire = z.literal(1)' > "$R/src/contract/wire.ts"
printf '%s\n' 'import { wire } from "../contract/wire.ts"' 'export const port = wire' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../src/interpreter/port.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = port ? x : x' > "$R/test/a.test.ts"
seal
check "the contract may import its parser and be imported" 0 "$RC" "graph clean"

fixture
mkdir -p "$R/src/contract"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { join } from "node:path"' 'export const wire = join("a", "b")' > "$R/src/contract/wire.ts"
printf '%s\n' 'import { wire } from "../src/contract/wire.ts"' 'import { x } from "../src/domain/a.ts"' 'export const y = wire + String(x)' > "$R/test/a.test.ts"
seal
check "the contract may not import a platform module" 1 "$RC" "contract-reaches-only-zod:"

# A relay is a module outside src/contract/ like any other, so this rule catches
# it at the first edge and needs no reachability to. The case is here because
# the relay is the shape a reader expects to be missed, and it is one of the
# reds deleting the rule leaves.
fixture
mkdir -p "$R/src/contract" "$R/src/interpreter" "$R/src/shared"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const port = 1' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../interpreter/port.ts"' 'export const relay = port' > "$R/src/shared/relay.ts"
printf '%s\n' 'import { relay } from "../shared/relay.ts"' 'export const wire = relay' > "$R/src/contract/wire.ts"
printf '%s\n' 'import { wire } from "../src/contract/wire.ts"' 'import { x } from "../src/domain/a.ts"' 'export const y = wire + x' > "$R/test/a.test.ts"
seal
check "a relay out of the contract is caught like any other module" 1 "$RC" "contract-reaches-only-zod:"

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
check "the actor may not import a platform module" 1 "$RC" "actor-sees-domain-only:"

# The one edge leaving the actor is the domain import the layer exists to take,
# so nothing but a path through the graph reaches node:path. Without
# `reachable: true` on the rule, domain-is-pure fires here alone and this is the
# only case that notices.
fixture
mkdir -p "$R/src/actor"
printf '%s\n' 'import { join } from "node:path"' 'export const x = join("a", "b")' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../domain/a.ts"' 'export const y = x' > "$R/src/actor/b.ts"
printf '%s\n' 'import { y } from "../src/actor/b.ts"' 'export const z = y' > "$R/test/a.test.ts"
seal
check "the actor may not REACH a platform module transitively" 1 "$RC" "actor-sees-domain-only:"

# --- The layer boundaries ----------------------------------------------------

# The suites are downstream of every part of src/. From the domain the broader
# purity rule catches it first, so this case proves only what it says; the rule
# of its own name gets a case in the slice that lands a second source layer.
fixture
printf '%s\n' 'export const helper = 1' > "$R/test/helper.ts"
printf '%s\n' 'import { helper } from "../../test/helper.ts"' 'export const x = helper' > "$R/src/domain/a.ts"
seal
check "a source reaching a suite is a finding" 1 "$RC" "domain-is-pure:"

# The whole allowed direction in one tree: an adapter answers a port the
# interpreter declared, the interpreter reads the actor, the actor reads the
# domain, and the composition root imports the adapter. A red here would mean a
# rule below over-fires on the shape the split exists to permit.
fixture
mkdir -p "$R/src/actor" "$R/src/interpreter" "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../domain/a.ts"' 'export const decided = x' > "$R/src/actor/b.ts"
printf '%s\n' 'import { decided } from "../actor/b.ts"' 'export const port = decided' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../interpreter/port.ts"' 'export const stub = port' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { stub } from "./adapters/stub.ts"' 'export const wired = stub' > "$R/src/compose.ts"
printf '%s\n' 'import { stub } from "../src/adapters/stub.ts"' 'export const z = stub' > "$R/test/a.test.ts"
seal
check "the layers below the composition root import inward and stay clean" 0 "$RC" "graph clean"
# The count is what says the root was cruised rather than skipped. It is the
# only module here nothing imports, and it is clean because a module with
# dependencies is not an orphan however little depends on it.
check "the composition root is cruised, not absent" 0 "$RC" "across 6 module(s)"

# --- interpreter-constructs-no-adapter ---------------------------------------

fixture
mkdir -p "$R/src/interpreter" "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const stub = 1' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { stub } from "../adapters/stub.ts"' 'export const port = stub' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../src/interpreter/port.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = port + x' > "$R/test/a.test.ts"
seal
check "the interpreter may not import an adapter" 1 "$RC" "interpreter-constructs-no-adapter:"

# The relay belongs to neither directory, so no edge leaves src/interpreter/ for
# src/adapters/ and only reachability sees it. Without `reachable: true` on the
# rule this tree is clean and no other case notices.
fixture
mkdir -p "$R/src/interpreter" "$R/src/adapters" "$R/src/shared"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const stub = 1' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { stub } from "../adapters/stub.ts"' 'export const relay = stub' > "$R/src/shared/relay.ts"
printf '%s\n' 'import { relay } from "../shared/relay.ts"' 'export const port = relay' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../src/interpreter/port.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = port + x' > "$R/test/a.test.ts"
seal
check "the interpreter may not REACH an adapter through a relay" 1 "$RC" "interpreter-constructs-no-adapter:"

# --- no-adapter-sees-another -------------------------------------------------

fixture
mkdir -p "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const two = 2' > "$R/src/adapters/two.ts"
printf '%s\n' 'import { two } from "./two.ts"' 'export const one = two' > "$R/src/adapters/one.ts"
printf '%s\n' 'import { one } from "../src/adapters/one.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = one + x' > "$R/test/a.test.ts"
seal
check "one adapter may not import another" 1 "$RC" "no-adapter-sees-another:"

# The shared helper between two stubs is the shape the rule is really about, and
# every edge in it is individually innocent.
fixture
mkdir -p "$R/src/adapters" "$R/src/shared"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const two = 2' > "$R/src/adapters/two.ts"
printf '%s\n' 'import { two } from "../adapters/two.ts"' 'export const relay = two' > "$R/src/shared/relay.ts"
printf '%s\n' 'import { relay } from "../shared/relay.ts"' 'export const one = relay' > "$R/src/adapters/one.ts"
printf '%s\n' 'import { one } from "../src/adapters/one.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = one + x' > "$R/test/a.test.ts"
seal
check "one adapter may not REACH another through a shared helper" 1 "$RC" "no-adapter-sees-another:"

# An adapter is a directory as often as it is a file, and the modules under one
# directory are one adapter. The exclusion the capture group builds has to cover
# the whole directory, or an adapter split across files is a violation of itself.
fixture
mkdir -p "$R/src/adapters/one"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const rows = 2' > "$R/src/adapters/one/rows.ts"
printf '%s\n' 'import { rows } from "./rows.ts"' 'export const store = rows' > "$R/src/adapters/one/store.ts"
printf '%s\n' 'import { store } from "../src/adapters/one/store.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = store + x' > "$R/test/a.test.ts"
seal
check "the modules of one adapter directory are one adapter" 0 "$RC" "graph clean"

# The exclusion is built from the directory name, so a sibling whose name begins
# with it is a different adapter and the rule still reaches it. Nothing else in
# this tree fires, so an exclusion that ran past the segment leaves it clean.
fixture
mkdir -p "$R/src/adapters/one"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const legacy = 2' > "$R/src/adapters/oneLegacy.ts"
printf '%s\n' 'import { legacy } from "../oneLegacy.ts"' 'export const store = legacy' > "$R/src/adapters/one/store.ts"
printf '%s\n' 'import { store } from "../src/adapters/one/store.ts"' 'import { x } from "../src/domain/a.ts"' 'export const z = store + x' > "$R/test/a.test.ts"
seal
check "an adapter directory may not import the adapter its name prefixes" 1 "$RC" "no-adapter-sees-another:"

# --- nothing-imports-a-process-root ------------------------------------------

fixture
mkdir -p "$R/src/roots"
printf '%s\n' 'export const wired = 1' > "$R/src/roots/service.ts"
printf '%s\n' 'import { wired } from "../src/roots/service.ts"' 'export const z = wired' > "$R/test/a.test.ts"
seal
check "importing a process root is a finding" 1 "$RC" "nothing-imports-a-process-root:"

# --- no-source-reaches-a-suite, under its own name ----------------------------

# From the domain the broader purity rule catches this first, which is why the
# case above it names domain-is-pure. The interpreter has no such rule, so this
# is the layer where the suite boundary answers for itself.
fixture
mkdir -p "$R/src/interpreter"
printf '%s\n' 'export const helper = 1' > "$R/test/helper.ts"
printf '%s\n' 'import { helper } from "../../test/helper.ts"' 'export const port = helper' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../src/interpreter/port.ts"' 'export const z = port' > "$R/test/a.test.ts"
seal
check "a source reaching a suite is a finding under its own rule" 1 "$RC" "no-source-reaches-a-suite:"

# A cycle makes the layer a module belongs to unanswerable.
fixture
printf '%s\n' 'import { b } from "./b.ts"' 'export const a = b' > "$R/src/domain/a.ts"
printf '%s\n' 'import { a } from "./a.ts"' 'export const b = a' > "$R/src/domain/b.ts"
seal
check "a cycle is a finding" 1 "$RC" "no-circular-dependency:"

# A module nothing reaches is dead or is a boundary nobody crossed.
fixture
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const orphaned = 1' > "$R/src/domain/orphan.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
seal
check "an orphan module is a finding" 1 "$RC" "no-orphan-module:"

# --- A console's own boundaries, and the one between consoles ----------------

# Every case below puts the console under a name, because the rules are written
# per console: a fixture that put app/ and dom/ directly under ui/ would name
# the console "app", and the pair rule would then be looking for a dom/ inside
# it and finding nothing to fire on.

# The allowed direction first: the document layer reads the decision layer, and
# a red here would mean the rule over-fires on the one edge the split exists to
# take. The src/ pair is what keeps the tracked-source precondition satisfied
# and neither file an orphan.
fixture
mkdir -p "$R/ui/console/app" "$R/ui/console/dom"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const decide = () => 1' > "$R/ui/console/app/decide.js"
printf '%s\n' 'import { decide } from "../app/decide.js"' 'export const draw = () => decide()' > "$R/ui/console/dom/draw.js"
seal
check "the console's document layer may read its decisions" 0 "$RC" "graph clean"

# The public contract is the one module outside ui/ a console may reach, and it
# is why the console the next slices build has no second copy of the wire. The
# fixture's contract imports nothing, because whether a console may reach the
# parser the real one imports is the separate question kasofsk/chuggy#315
# answers over the console that builds.
fixture
mkdir -p "$R/ui/console/app" "$R/src/contract"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const wireVersion = 1' > "$R/src/contract/wire.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { wireVersion } from "../../../src/contract/wire.ts"' 'export const decide = () => wireVersion' > "$R/ui/console/app/decide.js"
seal
check "a console may reach the public contract" 0 "$RC" "graph clean"

# The exemption is the contract and nothing beside it: a console reaching the
# server's own layers is the finding the rule exists for.
fixture
mkdir -p "$R/ui/console/app" "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const stub = 1' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { stub } from "../../../src/adapters/stub.js"' 'export const decide = () => stub' > "$R/ui/console/app/decide.js"
seal
check "a console may not reach an adapter" 1 "$RC" "console-reaches-no-source:"

# Every file is individually innocent: only a path through the graph reaches
# out of ui/, which is what the rule's `reachable` flag is for.
fixture
mkdir -p "$R/ui/console/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../../../src/domain/a.ts"' 'export const shared = x' > "$R/ui/console/app/shared.js"
printf '%s\n' 'import { shared } from "./shared.js"' 'export const decide = () => shared' > "$R/ui/console/app/decide.js"
seal
check "the console may not REACH the server's source" 1 "$RC" "console-reaches-no-source:"

# The same shape one directory down: a relay belonging to neither is what a
# per-import rule would miss. This case is also what holds the pair rule to a
# construct that fires: written with a `$1` backreference in a `reachable`
# rule's `to.path` it matches nothing, and the only symptom is this line going
# green.
fixture
mkdir -p "$R/ui/console/app" "$R/ui/console/dom"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const write = () => 1' > "$R/ui/console/dom/write.js"
printf '%s\n' 'import { write } from "../dom/write.js"' 'export const relay = write' > "$R/ui/console/app/relay.js"
printf '%s\n' 'import { relay } from "./relay.js"' 'export const decide = () => relay()' > "$R/ui/console/app/decide.js"
seal
check "a console decision may not REACH the document layer" 1 "$RC" "console-decisions-touch-no-document:"

# The rule over every console stops at this tree's source, so it is the one
# that answers for a console nothing else here names. A package is what it
# leaves alone and the case below it is what proves the difference.
fixture
mkdir -p "$R/ui/built/app" "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const stub = 1' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { stub } from "../../../src/adapters/stub.ts"' 'export const decide = () => stub' > "$R/ui/built/app/decide.js"
seal
check "a console that builds may not reach an adapter either" 1 "$RC" "console-reaches-no-source:"

# A package is the client dependency the unbuilt console exists without, and
# the console that builds fetches its bundle rather than the package, so only
# the first is bound. The pair is what says the scope is the rule.
fixture
mkdir -p "$R/ui/console/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { z } from "zod"' 'export const decide = () => z' > "$R/ui/console/app/decide.js"
seal
check "the unbuilt console may not reach a package" 1 "$RC" "unbuilt-console-uses-no-package:"

fixture
mkdir -p "$R/ui/built/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { z } from "zod"' 'export const decide = () => z' > "$R/ui/built/app/decide.js"
seal
check "a console that builds may reach a package" 0 "$RC" "graph clean"

# The decision/document split is the unbuilt console's own, and a console
# layered some other way states its own. Both halves are needed: a rule written
# over every console binds a directory pair that means nothing there.
fixture
mkdir -p "$R/ui/built/app" "$R/ui/built/dom"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const write = () => 1' > "$R/ui/built/dom/write.js"
printf '%s\n' 'import { write } from "../dom/write.js"' 'export const decide = () => write()' > "$R/ui/built/app/decide.js"
seal
check "another console's decisions may touch its own document layer" 0 "$RC" "graph clean"

# Two consoles are two artifacts, and a helper reachable from both is the
# client dependency neither has. Reachability again, and through a relay,
# because one console importing another by name is the shape a per-import rule
# would already catch.
fixture
mkdir -p "$R/ui/console/app" "$R/ui/admin/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const shared = () => 1' > "$R/ui/console/app/shared.js"
printf '%s\n' 'import { shared } from "../../console/app/shared.js"' 'export const relay = shared' > "$R/ui/admin/app/relay.js"
printf '%s\n' 'import { relay } from "./relay.js"' 'export const decide = () => relay()' > "$R/ui/admin/app/decide.js"
seal
check "one console may not REACH another" 1 "$RC" "no-console-sees-another:"

# --- The console that builds, and its own two boundaries -------------------

# Node's own modules are not packages, and the console that builds is the one
# that could plausibly reach for one: it has a toolchain, so `node:fs` resolves
# for it at build time and is gone by the time a browser has the bundle.
fixture
mkdir -p "$R/ui/built/src"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { readFileSync } from "node:fs"' 'export const read = readFileSync' > "$R/ui/built/src/decide.ts"
seal
check "a console that builds may not reach a platform module" 1 "$RC" "console-reaches-no-source:"

# The served source and the build's own configuration are two kinds of file in
# one directory, and only the first is fetched. The relay is the shape a
# per-import rule misses.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const built = 1' > "$R/ui/chuggy-ui/vite.config.ts"
printf '%s\n' 'import { built } from "../../vite.config.ts"' 'export const relay = built' > "$R/ui/chuggy-ui/app/browser/relay.ts"
printf '%s\n' 'import { relay } from "./relay.ts"' 'export const draw = () => relay' > "$R/ui/chuggy-ui/app/browser/draw.ts"
seal
check "the served source may not REACH the build's own configuration" 1 "$RC" "chuggy-ui-is-what-a-browser-fetches:"

# The decision layer's own bound, through a relay for the same reason.
fixture
mkdir -p "$R/ui/chuggy-ui/app/core" "$R/ui/chuggy-ui/app/browser"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const draw = () => 1' > "$R/ui/chuggy-ui/app/browser/draw.ts"
printf '%s\n' 'import { draw } from "../browser/draw.ts"' 'export const relay = draw' > "$R/ui/chuggy-ui/app/core/relay.ts"
printf '%s\n' 'import { relay } from "./relay.ts"' 'export const decide = () => relay()' > "$R/ui/chuggy-ui/app/core/decide.ts"
seal
check "a decision may not REACH the layer that draws it" 1 "$RC" "chuggy-ui-decisions-render-nothing:"

# The two directions the pair above exists to leave open: a decision reads the
# public contract and the parser it is written in, and what draws reads the
# decisions. A red here would mean the rule has closed the console.
fixture
mkdir -p "$R/ui/chuggy-ui/app/core" "$R/ui/chuggy-ui/app/browser" "$R/src/contract"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { z } from "zod"' 'export const wire = z.literal(1)' > "$R/src/contract/wire.ts"
printf '%s\n' 'import { wire } from "../../../../src/contract/wire.ts"' 'export const decide = () => wire' > "$R/ui/chuggy-ui/app/core/decide.ts"
printf '%s\n' 'import { decide } from "../core/decide.ts"' 'export const draw = () => decide()' > "$R/ui/chuggy-ui/app/browser/draw.ts"
seal
check "a decision may reach the contract, and what draws may reach it" 0 "$RC" "graph clean"

# A primitive draws and performs nothing, through a relay for the same reason:
# the helper between the primitive and the port is what a per-import check
# reads as innocent.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser/ui"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const nowMs = () => Date.now()' > "$R/ui/chuggy-ui/app/browser/ports.ts"
printf '%s\n' 'import { nowMs } from "../ports.ts"' 'export const relay = nowMs' > "$R/ui/chuggy-ui/app/browser/ui/relay.ts"
printf '%s\n' 'import { relay } from "./relay.ts"' 'export const draw = () => relay()' > "$R/ui/chuggy-ui/app/browser/ui/Pill.ts"
seal
check "a primitive may not REACH a port" 1 "$RC" "chuggy-ui-primitives-reach-no-effect:"

# The direction the rule exists to leave open: what draws a page reaches a
# primitive, and a primitive reaches the decision layer.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser/ui" "$R/ui/chuggy-ui/app/core"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const label = () => "Passed"' > "$R/ui/chuggy-ui/app/core/labels.ts"
printf '%s\n' 'import { label } from "../../core/labels.ts"' 'export const draw = () => label()' > "$R/ui/chuggy-ui/app/browser/ui/Pill.ts"
printf '%s\n' 'import { draw } from "./ui/Pill.ts"' 'export const page = () => draw()' > "$R/ui/chuggy-ui/app/browser/page.ts"
seal
check "a page may reach a primitive, and a primitive the decisions" 0 "$RC" "graph clean"

done_ "check-boundaries.test.sh"
