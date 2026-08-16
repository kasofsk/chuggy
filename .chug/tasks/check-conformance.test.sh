#!/bin/sh
# Shell test for check-conformance.sh.
#
# TWO KINDS OF CASE, and both are needed. The STUB cases drive a replayer this
# file writes, because what the shell owns is the translation — a verdict line,
# an exit code, a refusal — and a stub is the only way to produce the failures a
# healthy tree never has. The REAL cases drive the shipped replayer over a copy
# of the actual corpus, because a gate that has only ever been observed saying
# "clean" has not been shown to discriminate: the tree carrying the defect the
# gate names is what makes it trustworthy, and that is a standing commitment
# rather than a preference.
#
# Run:  .chug/tasks/check-conformance.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-conformance.sh"
ROOT="$(cd "$HERE/../.." && pwd)"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

run_in_repo() { # runs the gate at the fixture repo's root
	OUT="$WORK/.out"
	set +e
	(cd "$R" && "$SUT") > "$OUT" 2>&1
	RC=$?
	set -e
}

# --- The stub cases ---------------------------------------------------------

stub_repo() { # <exit> <printed line>
	fresh_repo "$R"
	mkdir -p "$R/src/tools"
	printf 'console.log(%s);\nprocess.exitCode = %s;\n' "\"$2\"" "$1" \
		> "$R/src/tools/replay-corpus.ts"
}

stub_repo 0 "check-conformance: clean (0 fixture(s))"
run_in_repo
check "a clean replay exits 0" 0 "$RC" "check-conformance: clean"

stub_repo 1 "check-conformance: 3 finding(s)"
run_in_repo
check "a replay finding exits 1" 1 "$RC" "FINDING"

stub_repo 2 "check-conformance: LINTER ERROR — no corpus"
run_in_repo
check "a could-not-run replay exits 2" 2 "$RC" "LINTER ERROR"

# A tool that exits non-zero without a verdict crashed rather than judged.
stub_repo 1 "something went wrong"
run_in_repo
check "no verdict line exits 2, not 1" 2 "$RC" "produced no verdict"

# And the same the other way round: a SILENT success is not a success. This is
# the case that keeps the gate from passing over a replayer that never ran.
stub_repo 0 "nothing to say"
run_in_repo
check "a silent pass exits 2, not 0" 2 "$RC" "produced no verdict"

# The tool missing altogether.
stub_repo 0 "check-conformance: clean (0 fixture(s))"
rm -f "$R/src/tools/replay-corpus.ts"
run_in_repo
check "a missing replayer exits 2" 2 "$RC" "is missing"

# A node that cannot strip types. The probe is functional for exactly this
# reason: this node exists, answers --version, and cannot run the tool.
stub_repo 0 "check-conformance: clean (0 fixture(s))"
FAKEBIN="$WORK/fakebin"
mkdir -p "$FAKEBIN"
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v22.0.0; exit 0; fi\nexit 1\n' \
	> "$FAKEBIN/node"
chmod +x "$FAKEBIN/node"
# PREPENDED rather than replacing PATH: the fake must shadow node and nothing
# else, or the case fails on a missing `mktemp` and proves nothing about the
# probe.
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$FAKEBIN:$PATH" "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "a node that cannot run TypeScript exits 2" 2 "$RC" "cannot run TypeScript"

# Outside a git checkout.
OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2" 2 "$RC" "LINTER ERROR"

# --- The real cases: the gate over the real replayer and the real corpus ----
# The model is copied too: the manifest's consts are checked against the
# model's own const blocks, so a fixture repo without `model/` is not this
# gate's subject.

real_repo() {
	fresh_repo "$R"
	cp -R "$ROOT/src" "$ROOT/corpus" "$ROOT/model" "$R/"
}

real_repo
run_in_repo
check "the committed corpus replays clean" 0 "$RC" "check-conformance: clean"

# ONE BYTE of one fixture: a ticket's remaining gas, in one state. The replayed
# state stops matching the trace's, which is precisely what the gate is for.
real_repo
CORPUS="$R/corpus/tier1/budgeted-cascade-park.itf.json"
sed 's/"gasLeft":{"#bigint":"3"}/"gasLeft":{"#bigint":"2"}/' "$CORPUS" > "$CORPUS.tmp"
mv "$CORPUS.tmp" "$CORPUS"
run_in_repo
check "a corrupted fixture is a finding" 1 "$RC" "FINDING"

# A fixture the manifest no longer names is a trace nothing replays — the shape
# a dropped manifest entry leaves behind, and the coverage it carried goes with
# it.
real_repo
node -e '
const fs = require("node:fs");
const path = process.argv[1];
const m = JSON.parse(fs.readFileSync(path, "utf8"));
m.tier1 = m.tier1.filter((f) => f.name !== "retryfree-settled");
fs.writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
' "$R/corpus/manifest.json"
run_in_repo
check "a fixture dropped from the manifest is a finding" 1 "$RC" "FINDING"

# No corpus at all: could not run, never a pass. A gate that reported "clean"
# for a tree with nothing to check is the failure this whole file exists for.
real_repo
rm -rf "$R/corpus"
run_in_repo
check "a missing corpus exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-conformance.test.sh"
