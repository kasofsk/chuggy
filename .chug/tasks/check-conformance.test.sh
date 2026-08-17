#!/bin/sh
# Shell test for check-conformance.sh.
#
# WHAT IT HAS TO PROVE IS THAT THE GATE BITES: each case hands it a corpus
# carrying the defect it names — a record that is not the model's, a row
# replayed under another instance's constants — and requires a finding.
#
# AND THAT IT ONLY READS. The case that settles the gate's central claim makes
# every file of the fixture corpus unwritable and requires the same clean
# verdict, so a run that opened a golden for writing fails there rather than
# being trusted not to.
#
# THE FIXTURES ARE A REAL GOLDEN AND ITS OWN MANIFEST ROW, copied rather than
# written, because a hand-built trace would test this suite's idea of the ITF
# encoding instead of the corpus. The clean line's figure is computed from that
# manifest rather than transcribed, so a regenerated corpus cannot leave this
# suite asserting against a stale count.
#
# Run:  .chug/tasks/check-conformance.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-conformance.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# A read-only fixture cannot be removed while it stays that way, so the write
# bit goes back before the harness's own cleanup runs.
trap 'chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

OUT="$WORK/.out"
GOLDEN="budgeted-work-failed"

run_gate() { # <golden-dir>
	set +e
	(cd "$ROOT" && CHUG_GOLDEN_DIR="$1" "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

fixture() { # <dir> [<instance>]
	mkdir -p "$1"
	cp "$ROOT/test/golden/$GOLDEN.itf.json" "$1/$GOLDEN.itf.json"
	node -e '
const fs = require("fs")
const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).goldens
const row = rows.find((r) => r.name === process.argv[3])
if (!row) throw new Error("no such row: " + process.argv[3])
if (process.argv[4]) row.instance = process.argv[4]
fs.writeFileSync(process.argv[2], JSON.stringify({ goldens: [row] }, null, 2) + "\n")
' "$ROOT/test/golden/manifest.json" "$1/manifest.json" "$GOLDEN" "${2:-}"
}

# What the fixture's manifest accounts for, which is what the gate's clean line
# has to report.
steps_in() { # <manifest>
	node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).goldens
process.stdout.write(String(rows.reduce((n, r) => n + r.steps, 0)))
' "$1"
}

# --- Could not run -----------------------------------------------------------

run_gate "$WORK/absent"
check "no corpus directory exits 2, not 0" 2 "$RC" "there is no corpus to replay"

mkdir -p "$WORK/bare"
run_gate "$WORK/bare"
check "no manifest exits 2, not 0" 2 "$RC" "says nothing about itself"

mkdir -p "$WORK/rowless"
printf '%s\n' '{ "goldens": [] }' > "$WORK/rowless/manifest.json"
run_gate "$WORK/rowless"
check "a manifest with no golden beside it exits 2, not 0" 2 "$RC" "the glob matched nothing"

# --- The clean verdict -------------------------------------------------------

fixture "$WORK/clean"
run_gate "$WORK/clean"
check "a golden that replays exits 0" 0 "$RC" "replayed clean"
check "the clean line counts what the replay consumed" 0 "$RC" \
	"1 golden(s), $(steps_in "$WORK/clean/manifest.json") step(s) replayed clean"

# --- A golden the replay never opened ----------------------------------------
#
# The manifest is what the replay iterates, so a corpus can hold goldens no row
# names and every one of them goes unreplayed.

fixture "$WORK/orphaned"
cp "$ROOT"/test/golden/*.itf.json "$WORK/orphaned/"
run_gate "$WORK/orphaned"
check "a golden no manifest row names is a finding" 1 "$RC" "with no manifest row"

# --- It only reads -----------------------------------------------------------
#
# Made unwritable, a gate that wrote would fail here.

fixture "$WORK/readonly"
chmod -R a-w "$WORK/readonly"
run_gate "$WORK/readonly"
chmod -R u+w "$WORK/readonly"
check "a corpus it cannot write to still replays clean" 0 "$RC" "replayed clean"

# --- A record the model never emitted ----------------------------------------

fixture "$WORK/tampered"
node -e '
const fs = require("fs")
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const lastStep = doc.vars.find((v) => v.endsWith("::lastStep"))
doc.states[1][lastStep].label = "a-label-this-machine-never-emits"
fs.writeFileSync(process.argv[1], JSON.stringify(doc, null, 2) + "\n")
' "$WORK/tampered/$GOLDEN.itf.json"
run_gate "$WORK/tampered"
check "a step record that is not the model's is a finding" 1 "$RC" "the step record diverged"
grep -qF "$GOLDEN state 1" "$OUT" || {
	echo "FAIL - the finding did not name the golden and the state a reader has to open"
	fail=$((fail + 1))
}

# --- A state the bundle refuses ----------------------------------------------
#
# No edit to a trace alone can make a leaf go red — the replay diverges first,
# before the invariants have anything to disagree with. What the corpus does
# not fix is the constants the row is replayed under.

fixture "$WORK/misfiled" mc_chuggy_retryfree
run_gate "$WORK/misfiled"
check "a row replayed under another instance's constants is a finding" 1 "$RC" "came back false"
grep -qF "accountsBounded" "$OUT" || {
	echo "FAIL - the finding did not name the leaf that came back false"
	fail=$((fail + 1))
}

done_ "check-conformance.test.sh"
