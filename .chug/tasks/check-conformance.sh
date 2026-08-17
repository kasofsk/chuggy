#!/bin/sh
# Every step of every committed golden replays through this implementation's own
# deciders, reproducing the model's step record and post-state exactly, with the
# whole invariant bundle evaluated on every state either side of the step.
#
# `model/` is proved and it emits the corpus, so the corpus is the
# specification's own output and where a replay and a golden disagree the code
# is wrong. Reproduction is exact equality on the whole state rather than a spot
# check, because a spot check is how a dropped field survives.
#
# IT NEVER REGENERATES, AND NOT AS A PROMISE. Emitting a golden needs quint at
# the pinned release and the model beside it, and this gate locates neither,
# runs neither, and has no flag, mode or variable that would.
# `.chug/tasks/emit-goldens.sh` is what writes the corpus.
#
# WHAT IT DOES NOT PROVE, said here because a gate that overstates itself is
# worse than one that states its limits.
#
#   - NOTHING ABOUT THE ENABLEMENT PREDICATES. The replay routes on the action a
#     trace recorded, and the golden's existence IS the guarantee that the
#     action was enabled, so no guard is ever consulted and a guard that drifted
#     replays green on every step. `test/domain/enablement.test.ts` is their
#     evidence and is the whole of it.
#   - NOT EVERY ARM OF EVERY DECIDER. The corpus's coverage claim is per step
#     label and per exemption arm, and a decider has arms that carry a label
#     some other arm already fired. Those are `test/domain/deciders.test.ts`'s.
#   - NOT THE INVARIANTS AGAINST THE MACHINE. The states here are the model's
#     own OUTPUT. What stands behind `allInvariants` in this tree is the
#     unseeded randomized run `.chug/tasks/check-model.sh` makes over the
#     full-roster instances, plus the deterministic witness and refinement
#     suites, which assert it at every step of the particular traces they walk.
#     There is no `quint verify` here and no inductive proof, and the rows
#     emitted under `model/mc/mc_chuggy_directed.qnt` are longer than that run's
#     step bound. So a red bundle is a disagreement between this tree's
#     transcription and the specification, and the transcription is where to
#     look first; on a directed-emitter state it is also the first evaluation
#     the bundle has ever had there.
#
# EXITS, and where the line between them is. A finding is anything the replay
# reports, INCLUDING a crash inside it: failing to read the specification's own
# output is a defect in this tree, not an absence of verdict. Could-not-run is
# reserved for this gate's own preconditions — no node, no corpus, no manifest,
# no suite to run — because those are the states where nothing was asked.
#
# Env:
#   CHUG_GOLDEN_DIR   the corpus to replay, default test/golden. It is exported
#                     to the suites, so the gate and the run cannot read
#                     different directories.
#
# Usage:
#   .chug/tasks/check-conformance.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-conformance: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# The runner's output is re-printed with an indent, so its colour escapes are
# noise. `NO_COLOR` is the switch and a caller's `FORCE_COLOR` beats it.
unset FORCE_COLOR
export NO_COLOR=1

GOLDEN_DIR="${CHUG_GOLDEN_DIR:-test/golden}"

if ! command -v node >/dev/null 2>&1; then
	echo "check-conformance: LINTER ERROR — no node, so nothing can replay"
	exit 2
fi

if [ ! -d "$GOLDEN_DIR" ]; then
	echo "check-conformance: LINTER ERROR — no $GOLDEN_DIR; there is no corpus to replay"
	exit 2
fi

if [ ! -f "$GOLDEN_DIR/manifest.json" ]; then
	echo "check-conformance: LINTER ERROR — no $GOLDEN_DIR/manifest.json; the corpus says nothing about itself"
	exit 2
fi

# A glob that matched nothing must not be the way this gate passes.
goldens="$(find "$GOLDEN_DIR" -maxdepth 1 -name '*.itf.json' 2>/dev/null || true)"
if [ -z "$goldens" ]; then
	echo "check-conformance: LINTER ERROR — $GOLDEN_DIR holds no golden; the glob matched nothing"
	exit 2
fi

suites="$(find test/conformance -maxdepth 1 -name '*.test.ts' 2>/dev/null || true)"
if [ -z "$suites" ]; then
	echo "check-conformance: LINTER ERROR — no test/conformance suite; there is no replay to run"
	exit 2
fi

# The manifest is JSON and this is shell, so node reads it. One that cannot be
# parsed is a could-not-run: nothing was asked of this tree.
counted="$(node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).goldens
process.stdout.write(rows.length + " " + rows.reduce((n, r) => n + r.steps, 0))
' "$GOLDEN_DIR/manifest.json" 2>/dev/null || true)"
if [ -z "$counted" ]; then
	echo "check-conformance: LINTER ERROR — $GOLDEN_DIR/manifest.json could not be read"
	exit 2
fi
rows_counted="${counted%% *}"
steps_counted="${counted##* }"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

set -f
IFS='
'
# shellcheck disable=SC2086 # the suite list is newline-separated by construction
set -- $suites
unset IFS
set +f

set +e
CHUG_GOLDEN_DIR="$GOLDEN_DIR" node --test --test-reporter=dot "$@" >"$work/out" 2>&1
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
	sed 's/^/    /' "$work/out"
	echo "check-conformance: the replay reported the finding(s) above (rc=$rc)"
	echo "check-conformance: rerun with: CHUG_GOLDEN_DIR=$GOLDEN_DIR node --test test/conformance/*.test.ts"
	exit 1
fi

echo "check-conformance: $rows_counted golden(s), $steps_counted step(s) replayed clean, records, states and bundle"
