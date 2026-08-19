#!/bin/sh
# Shell test for check-random.sh.
#
# WHAT IT HAS TO PROVE IS THAT THE GATE BITES, and the defect it bites on
# cannot live in an input file: the walk's subject is the deciders themselves.
# So the biting case is a scratch copy of the tree with the duplicate-completion
# decider broken to re-emit its completion — the mutant the accumulator exists
# for, invisible to every single-state invariant — run at a pinned seed whose
# budgeted walk draws that duplicate. The gate must go red, name the seed, and
# write the shrunk counterexample as a corpus.
#
# AND THAT THE COUNTEREXAMPLE IS A CORPUS. The same scratch copy replays the
# written directory through check-conformance.sh and must come back clean —
# broken deciders reproduce their own trace — and after the mutant is restored
# the same replay must go red at the recorded divergence. That pair is what
# "the replayer can consume it" means, proved with the real gates.
#
# The clean line's figures are asserted against a sweep whose size this suite
# sets, so the line cannot count something other than what the run consumed.
#
# Run:  .chug/tasks/check-random.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-random.sh"
CONFORMANCE="$HERE/check-conformance.sh"
ROOT="$(cd "$HERE/../.." && pwd)"
trap 'rm -rf "$WORK"' EXIT

R="$WORK/repo"

# The seed is pinned to a budgeted run that draws a duplicate completion;
# test/random/shrink.test.ts pins the same one and says how to re-find it.
SEED=0x7

run_gate() { # <dir> [env=value...]
	OUT="$WORK/.out"
	set +e
	(cd "$1" && shift && env "$@" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

# A copy of the real tree, committed so the mutant can be reverted: the walk's
# subject is src/, so an invented fixture tree would test nothing this gate
# actually walks.
fixture_tree() {
	fresh_repo "$R"
	cp "$ROOT/package.json" "$R/package.json"
	mkdir -p "$R/model"
	cp "$ROOT/model/domain.qnt" "$R/model/domain.qnt"
	cp -R "$ROOT/src" "$R/src"
	cp -R "$ROOT/test" "$R/test"
	# The replay path reaches the generated codec, and the codec reaches zod.
	# A fixture that cannot resolve it fails every suite for a reason that has
	# nothing to do with the case under test.
	ln -s "$ROOT/node_modules" "$R/node_modules"
	git -C "$R" add -A
	git -C "$R" -c commit.gpgsign=false commit -qm fixture
}

# --- Could not run -----------------------------------------------------------

OUT="$WORK/.out"
set +e
(cd "$WORK" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

fresh_repo "$WORK/bare"
OUT="$WORK/.out"
set +e
(cd "$WORK/bare" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a tree with no walk suite exits 2, not 0" 2 "$RC" "the glob matched nothing"

# --- The clean verdict, with its account of the run --------------------------

OUT="$WORK/.out"
set +e
(cd "$ROOT" && CHUG_WALK_SAMPLES=2 "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a clean walk exits 0" 0 "$RC" "walked clean"
check "the clean line counts the runs and steps the sweep consumed" 0 "$RC" \
	"3 instance(s), 6 run(s), 240 step(s) walked clean"

# --- The gate bites: a phantom completion in a scratch copy ------------------
#
# Completion emits no effect any more — entering Done IS the completion — so a
# decider that claims one claims a transition. This mutant makes `task-done`
# record a move to Done while leaving the state alone, which is the shape the
# accumulator exists to catch: the ledger on the ticket never moves, so nothing
# but the running count can tell.

fixture_tree
node -e '
const fs = require("fs")
const path = process.argv[1]
const source = fs.readFileSync(path, "utf8")
const broken = source.replace(
  `rec: { label: "task-done", transitions: [], effects: [] },`,
  `rec: { label: "task-done", transitions: [{ ticket: id, from: ticketAt(core, id).phase, to: "Done" }], effects: [] },`,
)
if (broken === source) throw new Error("the mutant found nothing to break")
fs.writeFileSync(path, broken)
' "$R/src/domain/deciders.ts"

run_gate "$R" \
	CHUG_WALK_SEED="$SEED" \
	CHUG_WALK_INSTANCE=mc_chuggy_budgeted \
	CHUG_WALK_DIR="$R/found"
check "a phantom completion is a finding" 1 "$RC" "completion(s) counted"
check "the finding names the seed that reproduces it" 1 "$RC" "$SEED"
check "the finding points at the written counterexample" 1 "$RC" "walk-mc_chuggy_budgeted-$SEED"

# --- The counterexample is a corpus the replayer consumes --------------------

OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_GOLDEN_DIR="$R/found" "$CONFORMANCE") >"$OUT" 2>&1
RC=$?
set -e
check "the broken tree replays its own counterexample clean" 0 "$RC" "replayed clean"

# --- Restored, the fixture pins the divergence -------------------------------

git -C "$R" checkout -- src/domain/deciders.ts
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_GOLDEN_DIR="$R/found" "$CONFORMANCE") >"$OUT" 2>&1
RC=$?
set -e
check "the restored tree replays the counterexample red at the divergence" 1 "$RC" \
	"the step record diverged"

done_ "check-random.test.sh"
