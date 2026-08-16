#!/bin/sh
# The randomized walk: the implementation driven by its own enablement
# predicates and the model's own draw sets, seeded, over the full-roster
# instances of model/mc/mc_chuggy.qnt — the counterpart of check-model.sh's
# randomized stage, run against this tree's deciders instead of the model.
# Every step asserts the whole invariant bundle on the states either side of it
# plus the per-ticket completion-emission accumulator, which is the property no
# single state can refute and no golden subsumes: the corpus replays recorded
# walks, and this gate takes walks nobody recorded, steered by the guards the
# replay never consults.
#
# THE RUN IS DETERMINISTIC BY DEFAULT. Every draw comes from a seeded generator
# and the seed base defaults to a constant, so on an untouched tree this gate
# answers the same every time — in a tree whose only CI is local gates, a red
# that surfaces in an unrelated commit's check is a cost this gate declines to
# impose. Fresh exploration is one variable away (CHUG_WALK_SEED_BASE), and the
# model gate's unseeded runs keep exploring the same state space on every check.
#
# A FINDING CARRIES ITS REPRODUCTION: the instance and the seed, which are the
# whole run — and, when the failing step produced a decision, a shrunk
# counterexample written as a corpus that test/conformance/ replays as it
# stands, at the directory the failure message names.
#
# The clean line reports what the run consumed, from a tally the suite counts
# as it walks; a pass that wrote no tally is a could-not-run, because a clean
# line with no account of the run is not a verdict.
#
# Env:
#   CHUG_WALK_SAMPLES    runs per instance; the default below matches the
#                        model gate's --max-samples
#   CHUG_WALK_SEED_BASE  first seed of the sweep; run seeds count up from it
#   CHUG_WALK_SEED, CHUG_WALK_INSTANCE
#                        set together: reproduce exactly one named run
#   CHUG_WALK_DIR        where a counterexample is written; the default is a
#                        fresh temp directory the failure names
#
# Usage:
#   .chug/tasks/check-random.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-random: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

# The runner's output is re-printed with an indent, so its colour escapes are
# noise. `NO_COLOR` is the switch and a caller's `FORCE_COLOR` beats it.
unset FORCE_COLOR
export NO_COLOR=1

if ! command -v node >/dev/null 2>&1; then
	echo "check-random: LINTER ERROR — no node, so nothing can walk"
	exit 2
fi

suites="$(find test/random -maxdepth 1 -name '*.test.ts' 2>/dev/null | sort || true)"
if [ -z "$suites" ]; then
	echo "check-random: LINTER ERROR — no test/random suite; the glob matched nothing"
	exit 2
fi

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
CHUG_WALK_SAMPLES="${CHUG_WALK_SAMPLES:-2000}" \
	CHUG_WALK_TALLY="$work/tally" \
	node --test --test-reporter=dot "$@" >"$work/out" 2>&1
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
	sed 's/^/    /' "$work/out"
	echo "check-random: the walk reported the finding(s) above (rc=$rc)"
	echo "check-random: a failure names its seed and instance; rerun that one run with"
	echo "check-random:   CHUG_WALK_SEED=... CHUG_WALK_INSTANCE=... node --test test/random/walk.test.ts"
	exit 1
fi

counted="$(node -e '
const tally = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
process.stdout.write(tally.instances + " " + tally.runs + " " + tally.steps)
' "$work/tally" 2>/dev/null || true)"
if [ -z "$counted" ]; then
	echo "check-random: LINTER ERROR — the walk passed but wrote no tally of what it consumed"
	exit 2
fi

set -f
# shellcheck disable=SC2086 # the tally is three fields the suite wrote itself
set -- $counted
set +f
echo "check-random: $1 instance(s), $2 run(s), $3 step(s) walked clean against the bundle and the completion accumulator"
