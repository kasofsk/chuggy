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
# MOST CASES NAME ONE STAGE. A full run costs a small multiple of a single
# stage, and a case about the purity rule learns nothing from also formatting
# the fixture. Two cases run every stage on purpose: one to show a clean tree
# is clean, and one to show that a finding in an early stage does not stop a
# later one from reporting its own. Every case scaffolds its own git checkout
# and drives the real toolchain over it, which is why this is the slowest thing
# `.chug/tasks/ci.sh` runs before the model; how much slower is what
# `time sh .chug/tasks/check-ts.test.sh` says on the host that asks. So a new
# case should share a run where it can, which is why the roster assertions
# share one rather than scaffolding a tree apiece.
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

# A fixture tree: the layers the `mkdir` below names, the real configuration,
# the real toolchain, and one pure domain module with a passing test. Every
# case starts here and adds exactly the defect it is about.
scaffold() {
	rm -rf "$R"
	mkdir -p "$R/src/domain" "$R/src/spine" "$R/src/effects" "$R/src/interp" \
		"$R/src/adapters" "$R/src/tools"
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
	# The spine is the pure core's second directory, so a fixture without one is
	# not this gate's subject: the purity stage requires every directory the rule
	# names to exist and to hold a file. This module also exercises the one
	# direction the graph rule permits — the spine reaching the domain.
	cat >"$R/src/spine/step.ts" <<'TS'
import { twice } from "../domain/pure.ts";

export function quadruple(n: number): number {
  return twice(twice(n));
}
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

# 3. The roster is enumerated, so every NAME on it gets its own assertion —
#    otherwise deleting one entry leaves the suite green, which is how `Intl`
#    and `AbortSignal` were absent from it in the first place. One run, one
#    reference each, one needle each. A name added to the roster without a line
#    here is a name nothing defends.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export const zone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
export const deadline = (): unknown => AbortSignal.timeout(1);
export const canceller = (): unknown => new AbortController();
export const bus = (): unknown => new BroadcastChannel("x");
export const pipe = (): unknown => new MessageChannel();
export const port = (): unknown => MessagePort;
export const watcher = (): unknown => PerformanceObserver;
export const timings = (): unknown => Performance;
export const agent = (): unknown => Navigator;
export const cipher = (): unknown => Crypto;
export const bytecode = (): unknown => WebAssembly.Module;
export const stamped = (): unknown => new File(["b"], "n").lastModified;
export const ticked = (): unknown => new Event("tick").timeStamp;
export const custom = (): unknown => new CustomEvent("c").timeStamp;
export const posted = (): unknown => new MessageEvent("m").timeStamp;
export const mark = (): unknown => PerformanceMark;
export const measure = (): unknown => PerformanceMeasure;
TS
run purity
check "Intl is rostered (a wall clock and a host time zone)" 1 "$RC" 'may not reach `Intl`'
check "AbortSignal is rostered (a timer by another name)" 1 "$RC" 'may not reach `AbortSignal`'
check "AbortController is rostered" 1 "$RC" 'may not reach `AbortController`'
check "BroadcastChannel is rostered" 1 "$RC" 'may not reach `BroadcastChannel`'
check "MessageChannel is rostered" 1 "$RC" 'may not reach `MessageChannel`'
check "MessagePort is rostered" 1 "$RC" 'may not reach `MessagePort`'
check "PerformanceObserver is rostered" 1 "$RC" 'may not reach `PerformanceObserver`'
check "Performance is rostered" 1 "$RC" 'may not reach `Performance`'
check "Navigator is rostered" 1 "$RC" 'may not reach `Navigator`'
check "Crypto is rostered" 1 "$RC" 'may not reach `Crypto`'
check "WebAssembly is rostered" 1 "$RC" 'may not reach `WebAssembly`'
# `File` stamps lastModified from the wall clock; `Blob`, the other half of the
# pair, has no such property and stays off the roster. The pair is why the
# roster turns on what instances return rather than on what a constructor is
# for, so both directions are asserted — the decline is checked in case 4.
check "File is rostered (lastModified is the wall clock)" 1 "$RC" 'may not reach `File`'
check "Event is rostered (timeStamp is a monotonic clock)" 1 "$RC" 'may not reach `Event`'
check "CustomEvent is rostered" 1 "$RC" 'may not reach `CustomEvent`'
check "MessageEvent is rostered" 1 "$RC" 'may not reach `MessageEvent`'
check "PerformanceMark is rostered" 1 "$RC" 'may not reach `PerformanceMark`'
check "PerformanceMeasure is rostered" 1 "$RC" 'may not reach `PerformanceMeasure`'

# 4. The other direction, and the only case in this suite that asserts a name is
#    DECLINED. `Blob` was declined by the same reasoning that wrongly declined
#    `File`, so the decline needs a pin of its own: if a later sweep rosters
#    `Blob` for symmetry, this turns red and the sweep has to say why on the
#    evidence rather than on the family resemblance.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export const inert = (): unknown => new Blob(["b"]).size;
TS
run purity
check "Blob stays declined, having no clock to read" 0 "$RC" "purity clean"

# 5. The module-graph half: a direct import of a node builtin.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export { readFileSync } from "node:fs";
TS
run purity
check "node:fs in src/domain is a finding" 1 "$RC" "domain-is-pure"

# 6. The breach three hops down. Nothing in `pure.ts` looks impure; it imports
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

# 7. A/B on the file extension, and the reason this case exists: a byte-identical
#    clock was a finding in `pure.ts` and clean in `pure.mts`, because both lint
#    configs globbed `*.ts`. The A half is case 2; this is the B half, and it
#    fails if either glob narrows back. (`tsc` still SAW the `.mts` file
#    whenever something imported it — an import pulls a file into the program
#    whatever `include` says — so what was missing was the lint, which is the
#    whole of the ambient half.)
scaffold
cat >"$R/src/domain/clock.mts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
run purity
check "a clock in a .mts domain file is a finding too" 1 "$RC" 'may not reach `Date`'

# 8. The floor beneath both globs. A file under `src/domain/` that no purity
#    configuration matches must be a FINDING and not a silence — which is the
#    property that makes the next extension loud without anyone remembering to
#    widen a glob for it. Handed a directory, eslint would never have seen this
#    file at all.
scaffold
printf 'not a source file\n' >"$R/src/domain/notes.txt"
run purity
check "a file no purity config matches is a finding" 1 "$RC" \
	"File ignored because no matching configuration was supplied"

# 9. The matching floor under the types stage: `src/` holds TypeScript and
#    nothing else. A `.js` file there would be outside the program
#    `tsconfig.json` describes, so `strict` would not apply to it while every
#    module around it could still import it — lint coverage would not fix that,
#    which is why it may not be there at all rather than be covered.
#
#    This floor and case 7's are not interchangeable: eslint always has a
#    configuration for `.js`, so no "ignored" warning fires for one and
#    `--max-warnings=0` has nothing to escalate. JavaScript is caught here or
#    not at all.
scaffold
printf 'export const untyped = 1;\n' >"$R/src/domain/sneak.js"
run types
check "JavaScript under src/ is a finding" 1 "$RC" "src/domain/sneak.js"

# 10. The same floor, reached through a symlink. This case exists because the
#     `-L` that fixes the purity stage's file list was applied here too for
#     consistency, and consistency is not a claim until something asserts it:
#     dropping `-L` from the stray check reddened nothing at all until this
#     case was written.
scaffold
mkdir -p "$R/vendor"
printf 'export const untyped = 1;\n' >"$R/vendor/untyped.js"
ln -s ../../vendor/untyped.js "$R/src/domain/linked.js"
run types
check "JavaScript reached through a symlink is a finding" 1 "$RC" \
	"src/domain/linked.js"

# 11. A symlinked domain module. `find -type f` does not match a symlink, so
#     building the purity stage's file list without `-L` dropped this file
#     silently — and this is the stage the package scripts advertise for every
#     save, so silence here is the expensive kind.
scaffold
mkdir -p "$R/vendor"
cat >"$R/vendor/clock.ts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
ln -s ../../vendor/clock.ts "$R/src/domain/clock.ts"
run purity
check "a symlinked domain module is read, not skipped" 1 "$RC" 'may not reach `Date`'

# 12. And a symlink resolving to nothing. Under `-L` it stops being a file and
#     would drop out of the list exactly as the unresolved case above did, so
#     it is looked for by name. A finding rather than could-not-run: nothing
#     about the toolchain failed, a file in the tree points at nothing.
scaffold
ln -s ../../vendor/missing.ts "$R/src/domain/dangling.ts"
run purity
check "a dangling symlink in src/domain is loud, not silent" 1 "$RC" \
	"resolve to nothing"

# 13. The compensating control for the graph half's `.test.ts` exemption: domain
#     tests are exempt from the module-graph `from` set, so the ambient roster
#     has to cover them. This case is the one that asserts the property by
#     name; narrowing the purity glob to exclude `.test.ts` also reddens every
#     other case that expects a clean tree, because case 7's file-list floor
#     then reports each fixture's own `pure.test.ts` as unmatched. That is
#     defence in depth rather than a second copy of this check. Written as a
#     mechanism rather than a count on purpose: the count was already wrong in
#     the commit that introduced it, which had added another clean-tree fixture
#     of its own a few lines up.
scaffold
cat >>"$R/src/domain/pure.test.ts" <<'TS'

export function stampedAt(): number {
  return Date.now();
}
TS
run purity
check "the ambient roster covers domain tests" 1 "$RC" 'may not reach `Date`'

# 14. The positive control. The same call one directory across is legal, so the
#    rule is scoped to the directory it names rather than to the tree.
#
#    AND THIS FIXTURE IS THE WHOLE OF IT, said here because a shipped module
#    under `src/adapters/` once claimed the same role in its own header and
#    could not have it. Not because the rule never sees such a file: widening
#    `PURE_FILES` alone DID red the gate on it, through `stage_lint`, because
#    `eslint.config.js` spreads the purity array in and the whole-tree lint runs
#    it. The reason is that this case asserts the gate's VERDICT — a named exit
#    code on a fixture written into a scaffolded repo — on every run, where a
#    shipped file's cleanliness is an observation somebody has to make and
#    re-make. Only a control that runs is one.
scaffold
cat >"$R/src/adapters/clock.ts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
run purity
check "Date.now in src/adapters is clean" 0 "$RC" "purity clean"

# 15. Hiding the impure module behind a test name inside the directory does not
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

# 16. The rule about test imports, pinned where nothing else can fire: an inert
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

# 17. Types.
scaffold
cat >>"$R/src/domain/pure.ts" <<'TS'

export const wrong: number = "not a number";
TS
run types
check "a type error is a finding" 1 "$RC" "is not assignable to type"

# 18. Lint, on the rule that mechanizes the engineering bar rather than a
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

# 19. Format.
scaffold
printf 'export const spaced   =    1\n' >"$R/src/domain/ugly.ts"
run format
check "an unformatted file is a finding" 1 "$RC" "src/domain/ugly.ts"

# 20. A failing test is a finding, not an error.
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

# 21. No test files at all exits 2, not 0. A test runner handed a glob that
#     matches nothing exits clean with zero tests, which is the one way this
#     stage could pass while checking nothing.
scaffold
rm "$R/src/domain/pure.test.ts"
run test
check "no tests found exits 2, not 0" 2 "$RC" "matched nothing"

# 22. Every selected stage runs. Two defects in different stages, one run, both
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

# 23. No toolchain installed.
scaffold
rm "$R/node_modules"
run
check "a missing node_modules exits 2, not 0" 2 "$RC" "npm ci"

# 24. A stage whose tool could not run at all, as opposed to one that ran and
#     disagreed. eslint reserves exit 2 for a configuration it cannot load;
#     turning that arm into a finding would report a linter that never linted
#     as a linter that found something.
scaffold
printf 'export default [ this is not javascript\n' >"$R/eslint.config.js"
run lint
check "an unloadable lint config exits 2, not 1" 2 "$RC" "could not run"

# 25. depcruise printing no verdict. Its exit code is a violation count, so a
#     crash and a finding are the same number; the printed line is the only
#     thing that separates them, and this is the guard that reads it.
scaffold
rm "$R/.dependency-cruiser.mjs"
run purity
check "depcruise with no verdict exits 2, not 1" 2 "$RC" "produced no verdict"

# 26. And the other direction: depcruise hands its violation COUNT to
#     `process.exit`, and a shell takes that status modulo 256 — so a run with
#     exactly that many violations exits 0. Measured, not theorised: the loop
#     below writes one leaking domain module per unit of the modulus, and the
#     run exits 0 while printing `256 errors`. A gate that trusted the code
#     would call the dirtiest graph this tree can produce clean, so the count
#     is read from the printed line and the code is only a corroborator.
scaffold
n=0
while [ "$n" -lt 256 ]; do
	printf 'export { readFileSync } from "node:fs";\n' >"$R/src/domain/leak$n.ts"
	n=$((n + 1))
done
run purity
check "256 violations wrap the exit code to 0 and are still a finding" 1 "$RC" \
	"256 errors"

# 27. A node that cannot run TypeScript. Simulated faithfully rather than
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

# 28. The types stage's own could-not-run: the project file is absent. tsc
#     answers a MALFORMED tsconfig with the same code it uses for a type
#     error, so that case is a finding by design and stated as such in the
#     gate; an absent one is genuinely could-not-run and is guarded before tsc
#     is invoked at all.
scaffold
rm "$R/tsconfig.json"
run types
check "a missing tsconfig.json exits 2, not 1" 2 "$RC" "tsconfig.json is missing"

# 29. An empty domain is not a pure one. If the ambient half is handed no
#     files it has checked nothing, and printing "purity clean" for that is the
#     same lie as a test glob that matched nothing.
scaffold
rm -r "$R/src/domain"
mkdir -p "$R/src/domain"
run purity
check "an empty src/domain exits 2, not 0" 2 "$RC" "checked nothing"

# 30. Outside a git checkout there is no tree to judge.
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

# 31. An unknown stage is a caller error, not a silent full run.
scaffold
run nosuchstage
check "an unknown stage exits 2" 2 "$RC" "unknown stage nosuchstage"

# --- The pure core is TWO directories ---------------------------------------
# `src/spine/` holds the decision-event vocabulary, the machine's own step and
# the golden-trace replayer. It was claimed pure in its own headers before any
# gate covered it, and both halves of the rule scoped to `src/domain/` — so a
# clock or a node builtin on the replay path passed every stage. These cases
# are what make the extension a rule rather than a claim; each was watched to
# fail with the extension reverted and the defect left in place.

# 32. The ambient half, on the spine. Narrowing the stage's directory list back
#     to the domain alone makes this case pass a tree that reads the clock on
#     the replay path — measured, with the clock below still in it.
scaffold
cat >>"$R/src/spine/step.ts" <<'TS'

export function stamp(): number {
  return Date.now();
}
TS
run purity
check "a clock in src/spine is a finding" 1 "$RC" 'may not reach `Date`'

# 33. The graph half, on the spine, and it names its own rule rather than
#     `domain-is-pure`: the two differ in what they permit, because the spine
#     may reach the domain and the domain may reach nothing.
scaffold
cat >>"$R/src/spine/step.ts" <<'TS'

export { readFileSync } from "node:fs";
TS
run purity
check "node:fs in src/spine is a finding" 1 "$RC" "spine-is-pure"

# 34. The positive control for the widened rule, and the reason `src/tools/`
#     exists at all: the emitter spawns quint and the gate driver reads the
#     corpus, so the same call one directory across must stay clean. A purity
#     rule only ever observed saying no has not been shown to be scoped to the
#     directories it names — and it now names two, so it needs its own control.
scaffold
cat >"$R/src/tools/emit.ts" <<'TS'
export function stamp(): number {
  return Date.now();
}
TS
run purity
check "Date.now in src/tools is clean" 0 "$RC" "purity clean"

# 35. A directory the rule names and the tree does not have. Could-not-run
#     rather than clean: a rule whose subject has left the tree did not pass,
#     and the stage would otherwise print clean over a roster it no longer
#     reads. Case 29's neighbour, for the other pure directory and for absence
#     rather than emptiness.
scaffold
rm -rf "$R/src/spine"
run purity
check "a missing pure directory exits 2, not 0" 2 "$RC" "named by the purity rule"

# 36. The interpretation layer's boundary, downward. An interp module reaching
#     an ADAPTER is a port declaration reaching its own implementation, and the
#     stub stops being substitutable. Not covered by any rule above: interp is
#     not in the pure core, and `effects-reach-only-domain` governs a different
#     directory.
scaffold
cat >"$R/src/adapters/store.ts" <<'TS'
export const rows: string[] = [];
TS
cat >"$R/src/interp/route.ts" <<'TS'
export { rows } from "../adapters/store.ts";
TS
run purity
check "an adapter reached from src/interp is a finding" 1 "$RC" \
	"interp-reaches-only-the-core"

# 37. The same boundary, sideways and three hops down, so the assertion is on
#     the chain's ORIGIN rather than its last hop — case 6's argument, for the
#     layer that had no rule at all until s6.
scaffold
cat >"$R/src/interp/deep.ts" <<'TS'
export { readFileSync } from "node:fs";
TS
cat >"$R/src/interp/middle.ts" <<'TS'
export { readFileSync } from "./deep.ts";
TS
cat >"$R/src/interp/route.ts" <<'TS'
export { readFileSync } from "./middle.ts";
TS
run purity
check "a transitive path out of src/interp names its origin" 1 "$RC" \
	"interp-reaches-only-the-core: src/interp/route.ts → fs"

# 38. The positive control for that rule, and the reason it needs one: the
#     three directories interp MAY reach are what the whole slice is built out
#     of, so a rule that only ever said no would be indistinguishable from a
#     rule whose `pathNot` was mistyped.
scaffold
cat >"$R/src/effects/effect.ts" <<'TS'
export type Effect = "Complete";
TS
cat >"$R/src/interp/route.ts" <<'TS'
import type { Effect } from "../effects/effect.ts";
import { quadruple } from "../spine/step.ts";
import { twice } from "../domain/pure.ts";

export function route(e: Effect, n: number): string {
  return `${e}${String(quadruple(twice(n)))}`;
}
TS
run purity
check "interp reaching effects, spine and domain is clean" 0 "$RC" "purity clean"

# 39. The ports' defining promise as a graph edge: an adapter that could reach
#     the single writer could commit a decision, which is a second writer. The
#     reach is three hops, because an adapter laundering it through a helper is
#     the version that would actually get written.
scaffold
cat >"$R/src/spine/actor.ts" <<'TS'
export function commit(n: number): number {
  return n;
}
TS
cat >"$R/src/adapters/helper.ts" <<'TS'
export { commit } from "../spine/actor.ts";
TS
cat >"$R/src/adapters/store.ts" <<'TS'
export { commit } from "./helper.ts";
TS
run purity
check "an adapter reaching the single writer is a finding" 1 "$RC" \
	"adapters-decide-nothing"

# 40. The other forbidden edge, and it is the one that would let a fabric stub
#     synthesize a completion nobody's run produced.
scaffold
cat >"$R/src/interp/events.ts" <<'TS'
export type ExternalEvent = { readonly tag: "TaskEnded" };
TS
cat >"$R/src/adapters/store.ts" <<'TS'
export type { ExternalEvent } from "../interp/events.ts";
TS
run purity
check "an adapter reaching the event vocabulary is a finding" 1 "$RC" \
	"adapters-decide-nothing"

# 41. The positive control for THAT rule, and it is the sharper of the two:
#     src/adapters/ is deliberately not reachability-bounded — an adapter is
#     where a node builtin belongs — so a rule spelled as a boundary rather
#     than as two named edges would fail here, and the failure would read as a
#     purity finding against the one directory that is allowed a medium.
scaffold
cat >"$R/src/adapters/store.ts" <<'TS'
import { readFileSync } from "node:fs";
import { quadruple } from "../spine/step.ts";

export function sizeOf(path: string): number {
  return quadruple(readFileSync(path, "utf8").length);
}
TS
run purity
check "an adapter reaching a node builtin is clean" 0 "$RC" "purity clean"

# --- The module-loader bans, OUTSIDE the pure core, through the PURITY STAGE
# (S3-5, S3-3, S3-4). Until now the stage handed eslint only the pure core, so
# the config's SECOND block — `files: src/** minus the pure core` — matched
# nothing this stage ran: a computed `import()` in an adapter passed
# `check-ts.sh purity` and reddened only `check-ts.sh lint`, the stage named for
# the rule enforcing half of it. Each case drives ONE ban through `run purity`,
# so together they prove the stage now applies the second block AND that the
# block closes each route. Every route below was measured live into the single
# writer. Before the fix, reverting `stage_purity` to hand only `$PURE_DIRS`
# turns every one of these green — the whole point of them.

# 42. A computed dynamic `import()` in an adapter. Non-literal on purpose: the
#     graph cannot resolve `import(spec)`, so depcruise is silent and this is
#     the eslint ban alone — the exact shape that passed `purity` and failed
#     `lint`.
scaffold
cat >"$R/src/adapters/loader.ts" <<'TS'
export async function load(spec: string): Promise<unknown> {
  return import(spec);
}
TS
run purity
check "a computed import() in an adapter is a purity finding" 1 "$RC" \
	"may not use a dynamic import"

# 43. An import of a module loader.
scaffold
cat >"$R/src/adapters/loader.ts" <<'TS'
import { createRequire } from "node:module";
export const req = createRequire(import.meta.url);
TS
run purity
check "importing a module loader in an adapter is a purity finding" 1 "$RC" \
	"not a module loader"

# 44. `getBuiltinModule` by member access.
scaffold
cat >"$R/src/adapters/loader.ts" <<'TS'
export const m = process.getBuiltinModule("node:module");
TS
run purity
check "getBuiltinModule by member is a purity finding" 1 "$RC" \
	"fetches a builtin by name"

# 45. The SAME getter reached reflectively (S3-3). `no-restricted-properties` is
#     blind to it — the name is a string ARGUMENT, not a member — so it is a
#     `no-restricted-syntax` selector, and this is the case that proves the
#     readable reflective spelling is closed.
scaffold
cat >"$R/src/adapters/loader.ts" <<'TS'
export const m = Reflect.get(process, "getBuiltinModule");
TS
run purity
check "reflective getBuiltinModule is a purity finding" 1 "$RC" 'Reflect.get('

# 46. Plain `eval` outside the pure core (S3-4). `no-eval` lived only in the
#     pure block; `eval("import(...)")` reaches a module loader from anywhere.
scaffold
cat >"$R/src/adapters/loader.ts" <<'TS'
export function run(src: string): unknown {
  return eval(src);
}
TS
run purity
check "plain eval in an adapter is a purity finding" 1 "$RC" "can be harmful"

# 47. The positive control for the loader block: an adapter that fetches NO
#     module and calls no eval is clean, so the five bans above are scoped to
#     the route rather than to the directory. An adapter reaching a MEDIUM
#     (node:fs) rather than a module loader must stay green.
scaffold
cat >"$R/src/adapters/loader.ts" <<'TS'
import { readFileSync } from "node:fs";
export function size(p: string): number {
  return readFileSync(p, "utf8").length;
}
TS
run purity
check "an adapter using a medium but no module loader is clean" 0 "$RC" "purity clean"

# --- The graph-half rules, each PROVED by a probe that reds it (S3-11). The
# mutation lens narrowed each of these to match nothing and check-ts.sh plus
# both suites stayed green: they WORK — the positive controls above red each
# with its own name — but nothing watched them work. Each case asserts the
# rule's OWN NAME, so narrowing the rule drops the name from the output and the
# case dies, which is the lens's exact test. `run purity` because these are the
# depcruise half of the purity stage.

# 48. no-shipped-test-fixtures. A shipped module re-exporting a test file is the
#     case `domain-not-through-its-tests` cannot make tree-wide; it is cited as
#     load-bearing prose elsewhere, so an unproved version was the sharp one.
scaffold
cat >"$R/src/interp/harness.test.ts" <<'TS'
export const fixture = 1;
TS
cat >"$R/src/interp/probe.ts" <<'TS'
export { fixture } from "./harness.test.ts";
TS
run purity
check "a shipped module importing a test file reds no-shipped-test-fixtures" 1 "$RC" \
	"no-shipped-test-fixtures"

# 49. spine-not-through-its-tests. (no-shipped-test-fixtures reds this too; the
#     needle is this rule's name, so narrowing THIS rule still kills the case.)
scaffold
cat >"$R/src/spine/randomized.test.ts" <<'TS'
export const fixture = 2;
TS
cat >"$R/src/spine/probe.ts" <<'TS'
export { fixture } from "./randomized.test.ts";
TS
run purity
check "spine source importing a spine test reds spine-not-through-its-tests" 1 "$RC" \
	"spine-not-through-its-tests"

# 50. effects-reach-only-domain.
scaffold
cat >"$R/src/spine/cmd.ts" <<'TS'
export const label = "x";
TS
cat >"$R/src/effects/probe.ts" <<'TS'
export { label } from "../spine/cmd.ts";
TS
run purity
check "an effect reaching the spine reds effects-reach-only-domain" 1 "$RC" \
	"effects-reach-only-domain"

# 51. no-circular. A two-module type cycle inside interp — type-only, since the
#     graph counts type imports (tsPreCompilationDeps).
scaffold
cat >"$R/src/interp/ring-a.ts" <<'TS'
import type { B } from "./ring-b.ts";
export type A = { readonly b: B | null };
export const a: A = { b: null };
TS
cat >"$R/src/interp/ring-b.ts" <<'TS'
import type { A } from "./ring-a.ts";
export type B = { readonly a: A | null };
export const b: B = { a: null };
TS
run purity
check "a cycle inside interp reds no-circular" 1 "$RC" "no-circular"

# --- The test roster is ENUMERATED, not globbed (S3-8) ----------------------

# 52. A `.test.mts` under src/ is RUN. The runner's glob was `*.test.ts`, so a
#     byte-identical failing assertion in a `.mts` ran NEVER while every gate
#     stayed green — the purity stage even lints it by name. The roster is
#     found now, so the extension the tree admits everywhere else runs here.
#     Reverting stage_test to the `*.test.ts` glob turns this green.
scaffold
cat >"$R/src/domain/silent.test.mts" <<'TS'
import assert from "node:assert/strict";
import { test } from "node:test";

test("an mts test runs", () => {
  assert.equal(1, 2);
});
TS
run test
check "a failing .test.mts is run and is a finding" 1 "$RC" "check-ts: FINDING — test"

done_ "check-ts.test.sh"
