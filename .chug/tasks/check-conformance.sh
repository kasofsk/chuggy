#!/bin/sh
# Every step of every committed golden replays through this implementation's own
# deciders, reproducing the model's step record and post-state exactly, with the
# whole invariant bundle evaluated on every state either side of the step.
#
# THE MODEL LEADS THE IMPLEMENTATION, and this is where that stops being a
# slogan. `model/` is proved and it emits the corpus; the corpus is therefore
# the specification's own output, and where a replay and a golden disagree the
# code is wrong. Reproduction is exact equality on the whole state rather than a
# spot check, because a spot check is how a dropped field survives.
#
# IT NEVER REGENERATES, AND NOT AS A PROMISE. Emission and verdict are separate
# jobs — a job that can rewrite its own expected output is not a check — so
# `.chug/tasks/emit-goldens.sh` writes the corpus and this reads it. What stops
# a regeneration here is that there is nothing to regenerate from: emitting a
# golden needs quint at the pinned release and the model beside it, and this
# gate locates neither, runs neither, and has no flag, mode or variable that
# would. The suites it runs open the corpus for reading and hold no writer, and
# `.chug/tasks/check-conformance.test.sh` puts that beyond argument by running
# this gate against a corpus whose files it has made unwritable and requiring a
# clean verdict: a run that tried to write one would fail there.
#
# IT RUNS SUITES `check-source.sh` ALSO RUNS, and that is the trade rather than
# an oversight. That gate asks whether the TypeScript survives its own tooling
# and discovers every suite in the tree to ask it; this one asks whether the
# implementation still agrees with the specification, which is a different
# question, has to be able to go red on its own, and has to be re-runnable while
# a decider is being fixed. The cost is one more node process; carving the
# conformance suites out of the other gate's discovery would buy that back and
# leave a gate whose glob has an exception in it.
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
#   - NOT THE INVARIANTS AGAINST THE MACHINE, and not because the machine has
#     been proved to satisfy them. The states here are the model's own OUTPUT,
#     which is the weaker thing: what stands behind `allInvariants` in this
#     tree is the unseeded randomized run `.chug/tasks/check-model.sh` makes
#     over the full-roster instances, plus the deterministic witness and
#     refinement suites, which assert it at every step of the particular
#     traces they walk. There is no `quint verify` here and no inductive
#     proof. A sample says nothing about whether the states in this corpus are
#     among the ones it visited, and the rows emitted under
#     `model/mc/mc_chuggy_directed.qnt`'s restricted step relation — most of
#     the corpus's steps, by the manifest's own count — are longer than that
#     run's step bound, which is the same reason those emitters had to be
#     written. So a red bundle is a disagreement between this tree's
#     transcription and the specification, and the transcription is where to
#     look first: a leaf transcribed too strongly is the direction S4's
#     make-it-red demonstrations cannot reach, and neither substitutes for the
#     other. On a directed-emitter state it is also the first evaluation the
#     bundle has ever had there — the aimed run refuted a label predicate, not
#     this one — so a reading against the specification stays open until the
#     transcription is cleared.
#
# WHAT THE CLEAN LINE COUNTS, and why it is not the files in the directory. The
# suite iterates the manifest's rows, so a count of `*.itf.json` on disk is a
# count of a set nothing replayed — and the two disagree exactly when the corpus
# holds a golden no row names, which is the case a reader most needs told. So
# the figure is the manifest's own account of the corpus, rows and steps, and it
# is worth printing only because two other things hold it there:
# `test/conformance/replay.test.ts` fails unless the replay consumed every row
# and every step that account claims, and fails again on a golden in the
# directory that no row names. The find below stays what it always was, a
# precondition — a corpus with nothing in it is a could-not-run rather than a
# clean sweep of nothing.
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

# The runner's output is captured and re-printed with an indent, so an escape
# sequence inside it is noise a reader has to look past. `NO_COLOR` is the
# switch, and a caller's `FORCE_COLOR` wins over it, so that goes first.
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

# A glob that matched nothing would otherwise be the way this gate passes, which
# is the failure every discovery in this directory is written to prevent.
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

# The manifest is JSON and this is shell, so node reads it, the way
# `.chug/tasks/emit-goldens.sh` reads the same file for the same reason. A
# manifest that cannot be parsed is a could-not-run for the reason an absent one
# is: nothing was asked of this tree.
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
