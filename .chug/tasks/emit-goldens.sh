#!/bin/sh
# Regenerates the golden corpus from the model. NOT A GATE — it writes.
#
# THE CORPUS IS COMMITTED AND THIS IS THE ONLY THING THAT WRITES IT. The gate
# that checks the implementation against it replays and never regenerates,
# because a job that can rewrite its own expected output is not a check. The
# two are separate files for that reason and no other.
#
# It carries a suite because `check-gates.sh` asks every script in this
# directory for one, and because the normalisation below is the part that goes
# wrong: a corpus that is not byte-identical across two regenerations produces
# a diff on every run, and a diff nobody reads is a fixture nobody is checking.
#
# WHAT IS NORMALISED, and why the corpus would otherwise be noise. Quint writes
# a top-level `#meta` carrying a wall-clock `timestamp` and a `description`
# containing the run date. Both change on every run and neither says anything
# about the trace, so both are dropped and the deterministic fields kept. The
# per-state `#meta` is a state index and is kept — it is derived from the trace
# rather than from the clock.
#
# EVERY GOLDEN IS REPRODUCIBLE FROM ITS MANIFEST ROW, which is what makes the
# corpus reviewable rather than magic: instance, seed, sample budget, step
# bound, and the invariant used to aim the search. `--n-threads=1` is pinned so
# determinism does not depend on how many cores the machine has; regeneration
# runs once, so what that costs in wall time buys the removal of an entire
# class of argument about whether a reproduction was luck.
#
# HOW A TRACE IS AIMED. Most of this machine's step labels never come up in a
# random walk — arrivals are capped, a quiesced fleet stutters, and the deep
# labels need a specific interleaving. So a golden that must contain a label
# asks quint to refute "this label never occurs" and keeps the counterexample.
# The model is not modified and the pipeline is the same one the untargeted
# traces use; the aiming is a flag, recorded in the row beside the seed. A row
# with no invariant is an ordinary walk.
#
# Usage:
#   .chug/tasks/emit-goldens.sh              regenerate every row
#   .chug/tasks/emit-goldens.sh <name>...    regenerate the named rows only
#
# Exits 0 on success, 1 when a row did not reproduce, 2 when it could not run.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "emit-goldens: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

GOLDEN_DIR="${CHUG_GOLDEN_DIR:-test/golden}"
MANIFEST="$GOLDEN_DIR/manifest.json"
QUINT_VERSION="0.32.0"

if [ ! -f "$MANIFEST" ]; then
	echo "emit-goldens: LINTER ERROR — no $MANIFEST; there is nothing to regenerate"
	exit 2
fi

if [ -x ./node_modules/.bin/quint ]; then
	QUINT=./node_modules/.bin/quint
elif command -v quint >/dev/null 2>&1; then
	QUINT=quint
else
	echo "emit-goldens: LINTER ERROR — no quint found. Install with \`npm ci\`."
	exit 2
fi

have="$("$QUINT" --version 2>/dev/null || true)"
if [ "$have" != "$QUINT_VERSION" ]; then
	echo "emit-goldens: LINTER ERROR — quint $have, expected $QUINT_VERSION."
	echo "emit-goldens: a different release can change what a seed produces; not guessing."
	exit 2
fi

if ! command -v node >/dev/null 2>&1; then
	echo "emit-goldens: LINTER ERROR — no node, so the manifest cannot be read"
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The manifest is JSON and this is shell, so node reads it and prints one
# tab-separated row per golden. Parsing JSON in awk would be a second parser to
# keep correct.
if ! node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).goldens
for (const r of rows) {
  process.stdout.write([r.name, r.source, r.module, r.step, r.seed, r.maxSamples, r.maxSteps, r.invariant ?? ""].join("\t") + "\n")
}
' "$MANIFEST" > "$work/rows" 2>"$work/err"; then
	echo "emit-goldens: LINTER ERROR — $MANIFEST could not be read"
	sed 's/^/    /' "$work/err"
	exit 2
fi

if [ ! -s "$work/rows" ]; then
	echo "emit-goldens: LINTER ERROR — the manifest lists no goldens"
	exit 2
fi

wanted=""
for arg in "$@"; do
	wanted="$wanted$arg
"
done

failed=0
emitted=0

while IFS="$(printf '\t')" read -r name source module stepname seed samples steps invariant; do
	if [ -n "$wanted" ] && ! printf '%s' "$wanted" | grep -qx "$name"; then
		continue
	fi
	target="$GOLDEN_DIR/$name.itf.json"
	raw="$work/$name.raw.json"

	set -f
	if [ ! -f "$source" ]; then
		echo "emit-goldens: FAILED — $name: its source $source is not in this tree"
		failed=$((failed + 1))
		continue
	fi
	set -- run "$source" "--main=$module" "--step=$stepname" --mbt --out-itf "$raw" \
		"--seed=$seed" "--max-samples=$samples" "--max-steps=$steps" --n-threads=1
	if [ -n "$invariant" ]; then
		set -- "$@" --invariant "$invariant"
	fi
	set +e
	"$QUINT" "$@" >"$work/out" 2>&1
	rc=$?
	set +f
	set -e

	# An aimed row must find its counterexample; quint reports that as 1. An
	# unaimed row must complete; quint reports that as 0. Either way the run
	# has to have written a trace, and a row that stops matching its aim is a
	# failure rather than a quietly shorter corpus.
	if [ -n "$invariant" ] && [ "$rc" -ne 1 ]; then
		echo "emit-goldens: FAILED — $name: the invariant was not refuted (rc=$rc)"
		echo "emit-goldens:   its aim is: $invariant"
		failed=$((failed + 1))
		continue
	fi
	if [ -z "$invariant" ] && [ "$rc" -ne 0 ]; then
		echo "emit-goldens: FAILED — $name: the walk did not complete (rc=$rc)"
		sed 's/^/    /' "$work/out" | tail -5
		failed=$((failed + 1))
		continue
	fi
	if [ ! -f "$raw" ]; then
		echo "emit-goldens: FAILED — $name: no trace was written"
		failed=$((failed + 1))
		continue
	fi

	mkdir -p "$GOLDEN_DIR"
	node -e '
const fs = require("fs")
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
// Keep only the fields that describe the trace. `description` and `timestamp`
// are the clock, and a corpus that carries the clock is a corpus that diffs
// on every regeneration.
const meta = doc["#meta"] ?? {}
doc["#meta"] = {
  format: meta.format,
  "format-description": meta["format-description"],
  source: meta.source,
  status: meta.status,
}
fs.writeFileSync(process.argv[2], JSON.stringify(doc, null, 2) + "\n")
' "$raw" "$target"

	steps_emitted="$(node -e '
const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
process.stdout.write(String(doc.states.length - 1))
' "$target")"
	echo "emit-goldens: $name — $steps_emitted step(s)"
	emitted=$((emitted + 1))
done < "$work/rows"

if [ "$emitted" -eq 0 ] && [ -n "$wanted" ]; then
	echo "emit-goldens: LINTER ERROR — no manifest row matched the names given"
	exit 2
fi

echo "emit-goldens: $emitted golden(s) written, $failed failed"
[ "$failed" -eq 0 ]
