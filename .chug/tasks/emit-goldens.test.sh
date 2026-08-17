#!/bin/sh
# Shell test for emit-goldens.sh.
#
# THE CENTRAL CASE IS BYTE-IDENTITY ACROSS TWO REGENERATIONS. A committed
# fixture that rewrites itself on every run produces a diff nobody opens, and a
# diff nobody opens is a fixture nobody is checking. The normalisation is what
# makes it true, so it is where this suite spends its cases.
#
# It runs the real quint against the real model, because the thing under test
# is an interaction with that binary at that pin.
#
# Run:  .chug/tasks/emit-goldens.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/emit-goldens.sh"
ROOT="$(cd "$HERE/../.." && pwd)"
trap 'rm -rf "$WORK"' EXIT

OUT="$WORK/.out"

# One helper: two spellings of "run the emitter" is how the no-argument case
# ends up passing an empty string as a name filter.
run_emit() { # <golden-dir> [<name>...]
	_dir="$1"
	shift
	set +e
	(cd "$ROOT" && CHUG_GOLDEN_DIR="$_dir" "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

# A manifest holding one short, cheap row: an unaimed walk with a small step
# bound rather than one of the corpus's aimed searches, to stay inside the
# sequencer per-suite cap.
one_row_manifest() { # <dir> [<extra-json>]
	mkdir -p "$1"
	cat > "$1/manifest.json" <<-JSON
	{
	  "goldens": [
	    {
	      "name": "probe",
	      "instance": "mc_chuggy_budgeted",
	      "module": "mc_chuggy_budgeted",
	      "source": "model/mc/mc_chuggy.qnt",
	      "step": "step",
	      "seed": "0x1",
	      "maxSamples": 1,
	      "maxSteps": 6,
	      "invariant": "",
	      "steps": 6,
	      "quintVersion": "0.32.0",
	      "purpose": "a suite fixture"
	    }
	  ]
	}
	JSON
}

# --- Could not run -----------------------------------------------------------

run_emit "$WORK/absent"
check "no manifest exits 2, not 0" 2 "$RC" "there is nothing to regenerate"

mkdir -p "$WORK/empty"
printf '%s\n' '{ "goldens": [] }' > "$WORK/empty/manifest.json"
run_emit "$WORK/empty"
check "a manifest listing nothing exits 2, not 0" 2 "$RC" "lists no goldens"

mkdir -p "$WORK/broken"
printf '%s\n' 'not json at all' > "$WORK/broken/manifest.json"
run_emit "$WORK/broken"
check "an unreadable manifest exits 2, not 0" 2 "$RC" "could not be read"

one_row_manifest "$WORK/named"
run_emit "$WORK/named" no-such-row
check "a name matching no row exits 2, not 0" 2 "$RC" "no manifest row matched"

# --- The central property ----------------------------------------------------

one_row_manifest "$WORK/det"
run_emit "$WORK/det"
check "a row regenerates" 0 "$RC" "1 golden(s) written"

cp "$WORK/det/probe.itf.json" "$WORK/first.json"
run_emit "$WORK/det"
if cmp -s "$WORK/first.json" "$WORK/det/probe.itf.json"; then
	echo "ok   - two regenerations are byte-identical"
	pass=$((pass + 1))
else
	echo "FAIL - two regenerations differ:"
	diff "$WORK/first.json" "$WORK/det/probe.itf.json" | head -20
	fail=$((fail + 1))
fi

# The clock is what would otherwise differ, so its absence is asserted rather
# than inferred from the case above passing.
if grep -q '"timestamp"' "$WORK/det/probe.itf.json"; then
	echo "FAIL - the wall clock survived normalisation"
	fail=$((fail + 1))
else
	echo "ok   - the wall clock is normalised out"
	pass=$((pass + 1))
fi

if grep -q '"description"' "$WORK/det/probe.itf.json"; then
	echo "FAIL - the dated description survived normalisation"
	fail=$((fail + 1))
else
	echo "ok   - the dated description is normalised out"
	pass=$((pass + 1))
fi

# What is kept is what describes the trace rather than the run.
for keeper in '"format"' '"source"' '"status"'; do
	if grep -q "$keeper" "$WORK/det/probe.itf.json"; then
		echo "ok   - $keeper is kept"
		pass=$((pass + 1))
	else
		echo "FAIL - $keeper was dropped by normalisation"
		fail=$((fail + 1))
	fi
done

# The per-state index is derived from the trace, not from the clock, so it
# stays: the replayer reports failures by state number.
if grep -q '"#meta"' "$WORK/det/probe.itf.json"; then
	echo "ok   - the per-state index is kept"
	pass=$((pass + 1))
else
	echo "FAIL - the per-state index was dropped"
	fail=$((fail + 1))
fi

# --- The corpus lands formatted ----------------------------------------------
#
# Checked with the same binary the gate runs, so this case cannot pass against
# a shape the gate would reject.

if (cd "$ROOT" && ./node_modules/.bin/prettier --check --log-level warn "$WORK/det/probe.itf.json") > /dev/null 2>&1; then
	echo "ok   - a regenerated golden is already in the formatter's shape"
	pass=$((pass + 1))
else
	echo "FAIL - a regenerated golden does not survive the format stage"
	fail=$((fail + 1))
fi

# --- An aimed row must hit its aim -------------------------------------------

mkdir -p "$WORK/aimed"
cat > "$WORK/aimed/manifest.json" <<'JSON'
{
  "goldens": [
    {
      "name": "unhittable",
      "instance": "mc_chuggy_budgeted",
      "module": "mc_chuggy_budgeted",
      "source": "model/mc/mc_chuggy.qnt",
      "step": "step",
      "seed": "0x1",
      "maxSamples": 30,
      "maxSteps": 4,
      "invariant": "lastStep.label != \"no-such-label-exists\"",
      "steps": 0,
      "quintVersion": "0.32.0",
      "purpose": "an aim that cannot be met"
    }
  ]
}
JSON
run_emit "$WORK/aimed"
check "an aim that is never met is a failure, not a shorter corpus" 1 "$RC" "the invariant was not refuted"

done_ "emit-goldens.test.sh"
