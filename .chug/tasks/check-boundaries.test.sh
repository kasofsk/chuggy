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
# interpreter declared, the interpreter reads the domain, and the composition
# root imports the adapter. A red here would mean a
# rule below over-fires on the shape the split exists to permit.
fixture
mkdir -p "$R/src/interpreter" "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../domain/a.ts"' 'export const port = x' > "$R/src/interpreter/port.ts"
printf '%s\n' 'import { port } from "../interpreter/port.ts"' 'export const stub = port' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { stub } from "./adapters/stub.ts"' 'export const wired = stub' > "$R/src/compose.ts"
printf '%s\n' 'import { stub } from "../src/adapters/stub.ts"' 'export const z = stub' > "$R/test/a.test.ts"
seal
check "the layers below the composition root import inward and stay clean" 0 "$RC" "graph clean"
# The count is what says the root was cruised rather than skipped. It is the
# only module here nothing imports, and it is clean because a module with
# dependencies is not an orphan however little depends on it.
check "the composition root is cruised, not absent" 0 "$RC" "across 5 module(s)"

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

# --- pool-plane-mints-no-credential ------------------------------------------

# Reachability is the whole of this one: the root names no admin adapter and the
# shape to catch is a composition helper that names it for both roots.
fixture
mkdir -p "$R/src/roots" "$R/src/adapters/hydra"
printf '%s\n' 'export const clients = 1' > "$R/src/adapters/hydra/oauthClients.ts"
printf '%s\n' 'import { clients } from "../adapters/hydra/oauthClients.ts"' 'export const wiring = clients' > "$R/src/roots/planeEnvironment.ts"
printf '%s\n' 'import { wiring } from "./planeEnvironment.ts"' 'export const plane = wiring' > "$R/src/roots/poolPlane.ts"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const z = x' > "$R/test/a.test.ts"
seal
check "the plane pools poll may not REACH the issuer's admin adapter" 1 "$RC" "pool-plane-mints-no-credential:"

# Another root reaching the same adapter is what registration is, so the rule
# must not be a ban on the adapter itself.
fixture
mkdir -p "$R/src/roots" "$R/src/adapters/hydra"
printf '%s\n' 'export const clients = 1' > "$R/src/adapters/hydra/oauthClients.ts"
printf '%s\n' 'import { clients } from "../adapters/hydra/oauthClients.ts"' 'export const registers = clients' > "$R/src/roots/registerWorkerPool.ts"
printf '%s\n' 'import { x } from "../domain/a.ts"' 'export const plane = x' > "$R/src/roots/poolPlane.ts"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const z = x' > "$R/test/a.test.ts"
seal
check "an owner's command may reach the issuer's admin adapter" 0 "$RC" "graph clean"

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
# per console: a fixture that put app/ directly under ui/ would name the console
# "app", and no rule stated over a console would be looking at the directory it
# is about.

# The public contract is the one module outside ui/ a console may reach, and it
# is why no console here carries a second copy of the wire. The fixture's
# contract imports nothing, because whether a console may reach the parser the
# real one imports is what chuggy-ui-decisions-render-nothing answers below.
fixture
mkdir -p "$R/ui/one/app" "$R/src/contract"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const wireVersion = 1' > "$R/src/contract/wire.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { wireVersion } from "../../../src/contract/wire.ts"' 'export const decide = () => wireVersion' > "$R/ui/one/app/decide.js"
seal
check "a console may reach the public contract" 0 "$RC" "graph clean"

# The exemption is the contract and nothing beside it: a console reaching the
# server's own layers is the finding the rule exists for.
fixture
mkdir -p "$R/ui/one/app" "$R/src/adapters"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'export const stub = 1' > "$R/src/adapters/stub.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { stub } from "../../../src/adapters/stub.js"' 'export const decide = () => stub' > "$R/ui/one/app/decide.js"
seal
check "a console may not reach an adapter" 1 "$RC" "console-reaches-no-source:"

# Every file is individually innocent: only a path through the graph reaches
# out of ui/, which is what the rule's `reachable` flag is for.
fixture
mkdir -p "$R/ui/one/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../../../src/domain/a.ts"' 'export const shared = x' > "$R/ui/one/app/shared.js"
printf '%s\n' 'import { shared } from "./shared.js"' 'export const decide = () => shared' > "$R/ui/one/app/decide.js"
seal
check "the console may not REACH the server's source" 1 "$RC" "console-reaches-no-source:"

# A package is what the rule above leaves alone: a console bundles what it
# reaches and serves the bundle, so a client dependency is its own business.
fixture
mkdir -p "$R/ui/one/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { z } from "zod"' 'export const decide = () => z' > "$R/ui/one/app/decide.js"
seal
check "a console may reach a package" 0 "$RC" "graph clean"

# Two consoles are two artifacts, and a helper reachable from both is the
# client dependency neither has. Reachability again, and through a relay,
# because one console importing another by name is the shape a per-import rule
# would already catch.
fixture
mkdir -p "$R/ui/one/app" "$R/ui/two/app"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const shared = () => 1' > "$R/ui/one/app/shared.js"
printf '%s\n' 'import { shared } from "../../one/app/shared.js"' 'export const relay = shared' > "$R/ui/two/app/relay.js"
printf '%s\n' 'import { relay } from "./relay.js"' 'export const decide = () => relay()' > "$R/ui/two/app/decide.js"
seal
check "one console may not REACH another" 1 "$RC" "no-console-sees-another:"

# --- chuggy-ui's own boundaries ---------------------------------------------

# Node's own modules are not packages, and a console is what could plausibly
# reach for one: it has a toolchain, so `node:fs` resolves for it at build
# time and is gone by the time a browser has the bundle.
fixture
mkdir -p "$R/ui/one/src"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { readFileSync } from "node:fs"' 'export const read = readFileSync' > "$R/ui/one/src/decide.ts"
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

# The decision layer's own bound, through a relay for the same reason. This
# case is also what holds the rule to a construct that fires: written over
# every console with a `$1` backreference in a `reachable` rule's `to.path` it
# matches nothing, and the only symptom is this line going green.
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

# One directory names the conversation vendor. Stated per import rather than as
# reachability, so the fixture is the module that names it: a page of its own
# reading @assistant-ui is the second account of a conversation the rule is
# about, and a relay put between them is caught as the same shape.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser/conversation"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { ThreadPrimitive } from "@assistant-ui/react"' 'export const draw = () => ThreadPrimitive' > "$R/ui/chuggy-ui/app/browser/conversation/Conversation.ts"
printf '%s\n' 'import { MessagePrimitive } from "@assistant-ui/react"' 'export const turn = () => MessagePrimitive' > "$R/ui/chuggy-ui/app/browser/ThreadPage.ts"
seal
check "a page may not read the conversation vendor itself" 1 "$RC" "chuggy-ui-conversation-owns-assistant-ui:"

# The adoption the rule exists to leave open, and the reason it is not stated
# as reachability: a page mounts the surface and so REACHES the package through
# it, which a reachable rule would refuse.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser/conversation"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'import { ThreadPrimitive } from "@assistant-ui/react"' 'export const draw = () => ThreadPrimitive' > "$R/ui/chuggy-ui/app/browser/conversation/Conversation.ts"
printf '%s\n' 'import { draw } from "./conversation/Conversation.ts"' 'export const page = () => draw()' > "$R/ui/chuggy-ui/app/browser/ThreadPage.ts"
seal
check "a page may mount the surface that names the vendor" 0 "$RC" "graph clean"

# The surface draws what it is handed, and only reachability catches this tree
# under this rule: the relay is a primitive, which is a module the surface may
# import, so every edge the surface itself has is one the rule permits. The
# primitive's own rule answers for the second hop and this one answers for the
# surface, which is the point — the finding is reported where the module that
# should not have reached the port is.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser/conversation" "$R/ui/chuggy-ui/app/browser/ui"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const nowMs = () => Date.now()' > "$R/ui/chuggy-ui/app/browser/ports.ts"
printf '%s\n' 'import { nowMs } from "../ports.ts"' 'export const relay = nowMs' > "$R/ui/chuggy-ui/app/browser/ui/relay.ts"
printf '%s\n' 'import { relay } from "../ui/relay.ts"' 'export const draw = () => relay()' > "$R/ui/chuggy-ui/app/browser/conversation/Conversation.ts"
seal
check "the surface may not REACH a port" 1 "$RC" "chuggy-ui-conversation-reaches-only-primitives:"

# The direction that rule leaves open: the surface reaches a primitive and the
# decisions, which is everything it needs to draw an exchange.
fixture
mkdir -p "$R/ui/chuggy-ui/app/browser/conversation" "$R/ui/chuggy-ui/app/browser/ui" "$R/ui/chuggy-ui/app/core"
printf '%s\n' 'export const x = 1' > "$R/src/domain/a.ts"
printf '%s\n' 'import { x } from "../src/domain/a.ts"' 'export const y = x' > "$R/test/a.test.ts"
printf '%s\n' 'export const label = () => "Answered"' > "$R/ui/chuggy-ui/app/core/labels.ts"
printf '%s\n' 'import { label } from "../../core/labels.ts"' 'export const draw = () => label()' > "$R/ui/chuggy-ui/app/browser/ui/Pill.ts"
printf '%s\n' 'import { draw } from "../ui/Pill.ts"' 'export const turn = () => draw()' > "$R/ui/chuggy-ui/app/browser/conversation/Conversation.ts"
seal
check "the surface may reach a primitive and the decisions" 0 "$RC" "graph clean"

done_ "check-boundaries.test.sh"
