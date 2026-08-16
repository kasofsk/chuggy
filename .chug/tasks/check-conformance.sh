#!/bin/sh
# THE CONFORMANCE GATE: every committed golden trace replays through this
# tree's own deciders, step for step, and the corpus covers every obligation
# it owes.
#
# THE RULE IT EXISTS FOR. `model/` is the specification and it emits golden
# traces; this implementation grows up against them (standing rule 4). Replay
# is what makes that a checked fact rather than an intention: for each step of
# each trace, the decision the model took is driven through the shipped
# deciders and must return the SAME StepRecord and the SAME post-state, with
# the whole domain invariant bundle evaluated after every step. When the two
# disagree, the code is wrong.
#
# IT REPLAYS AND NEVER REGENERATES. Nothing here runs quint. A gate that
# regenerated its own fixtures would take its verdict from whatever the model
# says at the moment it runs, which is not a check of anything — and it would
# make the verdict depend on `--mbt`, an experimental flag, and on the quint
# release installed. Regeneration is `src/tools/emit-corpus.ts`, run by hand
# when the model moves; the diff it leaves is the thing to read.
#
# WHAT IT CANNOT SEE, said plainly, and the list is measured rather than
# reasoned — each entry below was verified by making the change and watching
# this gate stay green.
#
#   1. THE MODEL MOVING UNDER THE CORPUS. A new decider with no fixture reddens
#      the coverage roster, but a CHANGED decider whose traces were never
#      regenerated replays green against the machine it was emitted from. Two
#      things narrow it: the manifest's consts are compared against the model's
#      own const blocks on every run, so an instance moving under the corpus is
#      a finding here; and `check-model.sh` runs the model's own suites in the
#      same `just check`.
#   2. AN ENABLEMENT ARM WIDENED. `cmdEnabled` refusing less than the machine
#      does is invisible to replay — every fixture holds decisions the machine
#      TOOK, and a widened guard still admits those. What covers it is
#      `src/spine/cmd.test.ts`, which pins each arm as an exact set over a
#      fleet holding one ticket per phase.
#   3. A DECIDER-ATTRIBUTION ROW SWAPPED. `decidersReached` feeds the coverage
#      roster and nothing else, so swapping two single-decider rows leaves
#      every fixture replaying and every roster complete. What covers it is the
#      per-tag table in the same suite, and the swap was watched to red there
#      and nowhere else.
#
# WHY THE WORK IS IN TypeScript AND NOT IN THIS FILE. Decoding an ITF document
# into the domain vocabulary and driving the deciders needs the domain
# vocabulary. What belongs in a gate is here: locating the checkout, refusing
# to run without a toolchain, and turning a tool's report into an exit code.
#
# It needs `node` and nothing else — no `npm ci`, because the replayer imports
# no package. The node version is probed FUNCTIONALLY rather than read off
# `node --version`, for the reason `.chug/tasks/check-ts.sh` states at its own
# probe: a version string says a release is installed, not that this build
# strips types.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run — and 2 is not a pass.
# A run that printed no verdict line is a could-not-run whatever it exited
# with, on `.chug/tasks/check-duplication.sh`'s policy: a tool that produced no
# verdict measured nothing.
#
# Usage:
#   .chug/tasks/check-conformance.sh
set -eu
export LC_ALL=C

TOOL="src/tools/replay-corpus.ts"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-conformance: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if [ ! -f "$TOOL" ]; then
	echo "check-conformance: LINTER ERROR — $TOOL is missing"
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

printf 'const answer: number = 1;\nif (answer !== 1) throw new Error("no");\n' \
	> "$work/probe.ts"
if ! node "$work/probe.ts" > "$work/probe.out" 2>&1; then
	echo "check-conformance: LINTER ERROR — this node cannot run TypeScript directly."
	echo "check-conformance: package.json requires node >=22.18.0; found $(node --version 2>/dev/null || echo none)"
	exit 2
fi

out="$work/out"
set +e
node "$TOOL" > "$out" 2>&1
rc=$?
set -e

sed 's/^/    /' "$out"

if ! grep -q '^check-conformance: ' "$out"; then
	echo "check-conformance: LINTER ERROR — the replayer produced no verdict (rc=$rc)"
	exit 2
fi

case "$rc" in
0)
	exit 0
	;;
1)
	echo "check-conformance: FINDING — the corpus does not replay clean"
	exit 1
	;;
*)
	echo "check-conformance: LINTER ERROR ($rc) — the replayer could not run; this is not a pass"
	exit 2
	;;
esac
