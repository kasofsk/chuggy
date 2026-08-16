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
# a dropped manifest entry leaves behind.
#
# THE FIXTURE IS CHOSEN SO THAT ONLY THE ORPHAN CHECK CAN RED, and the choice
# is the whole case. This used to drop `retryfree-settled` and match the
# generic `FINDING` line — which that fixture's departure produces three
# further ways, because it is the corpus's only settled step, only settled
# exemption arm and only retryfree instance. The case passed whether or not the
# orphan check existed. `budgeted-desk-only-revoke` is coverage-redundant:
# every roster entry it reaches, another fixture reaches too, so the orphan
# message below is the only thing the gate can say about its absence.
# `src/tools/verify.test.ts` asserts the same finding as an exact list.
real_repo
node -e '
const fs = require("node:fs");
const path = process.argv[1];
const m = JSON.parse(fs.readFileSync(path, "utf8"));
m.tier1 = m.tier1.filter((f) => f.name !== "budgeted-desk-only-revoke");
fs.writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
' "$R/corpus/manifest.json"
run_in_repo
check "a fixture dropped from the manifest is reported as an orphan" 1 "$RC" \
	"corpus/tier1/budgeted-desk-only-revoke.itf.json is committed and the manifest names no fixture for it"

# A FIXTURE WITH ITS LAST STATE CUT OFF, which is the one corruption the trace
# cannot report about itself: every state carries its own `#meta.index` and the
# decoder checks it, so a state removed from the MIDDLE is a decode failure —
# but taking the last one leaves a dense, ascending, perfectly readable shorter
# trace. This fixture's pins are all reached before its end, so before the
# manifest carried a length the whole gate passed over it at exit 0.
# `src/tools/verify.test.ts` asserts the same finding as an exact list; this is
# the half that shows it reaches the gate's exit code.
real_repo
node -e '
const fs = require("node:fs");
const path = process.argv[1];
const doc = JSON.parse(fs.readFileSync(path, "utf8"));
doc.states.pop();
fs.writeFileSync(path, JSON.stringify(doc));
' "$R/corpus/tier2/witness-lease-exclusive.itf.json"
run_in_repo
check "a fixture with its last state cut off is a finding" 1 "$RC" \
	"witness-lease-exclusive: the manifest says the trace holds"

# THE PER-STEP INVARIANT BUNDLE, RED-PROVED. Spine layer 1 is exact equality
# AND the whole domain bundle after every step, and the second half is the one
# a healthy tree can never make fire: the replayer evaluates the bundle over the
# state its own deciders just produced at the replay's own consts, so no fixture
# and no doctored trace can falsify a CORRECT conjunct — which is exactly what
# makes discarding the verdict invisible. What can falsify one is a wrong
# conjunct, so that is what this case ships.
#
# THE MUTATION IS DEEP ON PURPOSE. `wrapUpWallNamed`'s Budgeted arm is `true`;
# giving it the DeadlineOnly arm's body makes it false only for a ticket that
# has hit the wrap-up-budget wall — a state no sampled walk reaches and only the
# deterministic half of the corpus carries. Nothing else moves: the conjunct is
# read by no decider, so every record and every post-state still matches and the
# bundle verdict is the only producer left.
#
# Delete `bundleFindings`' push in `src/spine/replay.ts` and this case is what
# goes red.
real_repo
node -e '
const fs = require("node:fs");
const path = process.argv[1];
const src = fs.readFileSync(path, "utf8");
const from = "    case \"Budgeted\":\n      return true;";
const to = "    case \"Budgeted\":\n      return everyTicket(c, (jb) => jb.reason !== \"RsWrapUpBudgetExhausted\");";
if (!src.includes(from)) {
  console.error("check-conformance.test.sh: the conjunct this case breaks has moved");
  process.exit(3);
}
fs.writeFileSync(path, src.replace(from, to));
' "$R/src/domain/invariants.ts"
run_in_repo
check "a conjunct false only on the deep half reaches the gate as the bundle verdict" \
	1 "$RC" "the domain invariant bundle is false after this step"

# No corpus at all: could not run, never a pass. A gate that reported "clean"
# for a tree with nothing to check is the failure this whole file exists for.
real_repo
rm -rf "$R/corpus"
run_in_repo
check "a missing corpus exits 2, not 0" 2 "$RC" "LINTER ERROR"


# --- The emitter, over a fake quint -----------------------------------------
# `src/tools/emit-corpus.ts` is not in `ci.sh` — it regenerates, which is the
# one thing the gate must never do — so nothing ran it until here. What needs
# covering is its refusals: the three ways a run can produce NO VERDICT read
# identically from a distance, and only one of them may be retried. A real
# quint cannot be made to segfault on demand, so the cases below drive a fake
# one whose behaviour is a file the case writes.
#
# The canned trace is a REAL committed fixture, so what the emitter writes is
# something the replayer can then read: a fake trace would test the file copy
# and nothing else.
#
# THE `states` FIELDS ARE THE CANNED TRACES' OWN LENGTHS, and they are seeds
# rather than assertions: the manifest reader refuses an entry without one, and
# the emitter rewrites every one of them from what it actually wrote before the
# replay that follows reads them. A case that changes a canned trace's length —
# the truncation case at the bottom does — therefore needs nothing changed here.

EMIT_MANIFEST='{
  "tier1": [
    {
      "name": "faked",
      "instance": "retryfree",
      "seed": "0x2a",
      "maxSamples": 20000,
      "maxSteps": 60,
      "invariant": "lastStep.label != \"settled\"",
      "expect": "violation",
      "states": 6,
      "pins": ["settled"],
      "rationale": "a fake run, driven by the suite",
      "consts": {
        "N_TICKETS": "2",
        "N_TASKS": "2",
        "REWORK_POLICY": "RWBudget(1)",
        "GAS": "2",
        "WRAPUP_PRICING": "DeadlineOnly",
        "OP_RETRY_PRICING": "RetryFree",
        "MAX_STAGES": "2",
        "N_PROJECTS": "2"
      }
    }
  ],
  "tier2": [
    {
      "name": "witness-draft-wait",
      "module": "chuggy_witness_draft_wait_test",
      "run": "draftWaitAcceptedDeterministicTest",
      "states": 4,
      "pins": ["decideRelease", "ticket-released"],
      "rationale": "the committed witness, re-emitted by the fake",
      "consts": {
        "N_TICKETS": "2",
        "N_TASKS": "1",
        "REWORK_POLICY": "RWBudget(1)",
        "GAS": "3",
        "WRAPUP_PRICING": "Budgeted(1)",
        "OP_RETRY_PRICING": "RetryCharged",
        "MAX_STAGES": "1",
        "N_PROJECTS": "1"
      }
    }
  ]
}'

# The fake. `$R/mode` selects what a `run` invocation does; `--version` answers
# from `$R/version`; `test` always writes the canned tier-2 trace. Attempts are
# counted in `$R/attempts` so a case can make the flake stop.
emit_repo() { # <mode> <version>
	fresh_repo "$R"
	cp -R "$ROOT/src" "$ROOT/model" "$R/"
	mkdir -p "$R/corpus/tier1" "$R/corpus/tier2" "$R/node_modules/.bin"
	printf '%s\n' "$EMIT_MANIFEST" >"$R/corpus/manifest.json"
	cp "$ROOT/corpus/tier1/retryfree-settled.itf.json" "$R/canned1.itf.json"
	cp "$ROOT/corpus/tier2/witness-draft-wait.itf.json" "$R/canned2.itf.json"
	printf '%s\n' "$1" >"$R/mode"
	printf '%s\n' "$2" >"$R/version"
	: >"$R/attempts"
	cat >"$R/node_modules/.bin/quint" <<'FAKE'
#!/bin/sh
# A fake quint, driven by files in the checkout it is run from.
root="$(pwd)"
if [ "$1" = "--version" ]; then cat "$root/version"; exit 0; fi
out=""
for arg in "$@"; do
	case "$arg" in --out-itf=*) out="${arg#--out-itf=}" ;; esac
done
if [ "$1" = "test" ]; then
	cp "$root/canned2.itf.json" \
		"$(echo "$out" | sed 's/{test}/draftWaitAcceptedDeterministicTest/; s/{seq}/0/')"
	exit 0
fi
echo x >>"$root/attempts"
attempts="$(grep -c . "$root/attempts")"
case "$(cat "$root/mode")" in
segv) kill -SEGV $$ ;;
segv-noisy)
	echo "quint: partial output before dying"
	kill -SEGV $$
	;;
segv-then-ok)
	if [ "$attempts" -lt 3 ]; then kill -SEGV $$; fi
	cp "$root/canned1.itf.json" "$out"
	exit 1
	;;
term) kill -TERM $$ ;;
no-violation) exit 0 ;;
violation)
	cp "$root/canned1.itf.json" "$out"
	exit 1
	;;
esac
FAKE
	chmod +x "$R/node_modules/.bin/quint"
}

run_emit() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && node src/tools/emit-corpus.ts) >"$OUT" 2>&1
	RC=$?
	set -e
}

# The binary missing altogether reads as "no verdict" too, and retrying it
# would blame the flake for a missing install.
emit_repo violation 0.32.0
rm "$R/node_modules/.bin/quint"
run_emit
check "the emitter names a missing quint, and says npm ci" 2 "$RC" "could not be run"

# The pin. A corpus emitted by an unpinned tool cannot be regenerated to the
# same bytes, and `--mbt` is experimental, so the version is checked before
# anything is written.
emit_repo violation 0.31.0
run_emit
check "the emitter refuses an unpinned quint" 2 "$RC" "expected 0.32.0"

# THE FLAKE (ledger #12): SIGSEGV with no output, every time. Retried, and then
# reported as could-not-run — never recorded as a fixture.
emit_repo segv 0.32.0
run_emit
check "a persistent segfault is could-not-run, not a fixture" 2 "$RC" \
	"produced no verdict after every retry"

# The same signal, twice, and then a verdict: the run is given again and the
# emission proceeds. This is the case the retry exists for.
emit_repo segv-then-ok 0.32.0
run_emit
check "a segfault that stops is retried and the run continues" 1 "$RC" \
	"wrote corpus/tier1/faked.itf.json"
grep -qF "retrying (ledger #12)" "$OUT" || {
	echo "FAIL - the retry was not reported"
	fail=$((fail + 1))
}

# THE SAME SIGNAL, WITH OUTPUT. Not the flake: ledger #12's signature is
# SIGSEGV *and nothing written*, and a crash that got far enough to say
# something got far enough to be worth reading. Removing the output half of
# that guard leaves every other case here green — the run still ends in a 2 —
# and only the REASON changes, from "was killed" to "produced no verdict after
# every retry", which is the failure class the flake fix exists to keep apart.
emit_repo segv-noisy 0.32.0
run_emit
check "a segfault that printed something is not the flake" 2 "$RC" \
	"was killed by SIGSEGV"
if grep -qF "retrying (ledger #12)" "$OUT"; then
	echo "FAIL - a segfault with output was retried as the flake"
	fail=$((fail + 1))
else
	echo "ok   - a segfault with output is refused rather than retried"
	pass=$((pass + 1))
fi

# ANY OTHER SIGNAL. Something killed quint; this tool does not get to decide it
# was harmless, and it is not the flake.
emit_repo term 0.32.0
run_emit
check "a kill by another signal is not treated as the flake" 2 "$RC" \
	"was killed by SIGTERM"

# A search that reports the wrong thing. The manifest says the seed finds a
# violation; a run that reports none has not reproduced the fixture, whatever
# it wrote.
emit_repo no-violation 0.32.0
run_emit
check "a search that does not report what the manifest says is refused" 2 "$RC" \
	"the search was to report violation"

# TRAILING SETTLED TRUNCATION, which is one of the two ways a committed fixture
# differs from raw quint output. The fake writes a trace whose settled run is
# several states long; the committed form keeps exactly one, and keeping NONE
# would drop the label and the exemption arm the corpus owes a step.
emit_repo violation 0.32.0
node -e '
const fs = require("node:fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const last = doc.states[doc.states.length - 1];
for (let i = 1; i <= 3; i += 1) {
  const copy = JSON.parse(JSON.stringify(last));
  copy["#meta"].index = doc.states.length;
  doc.states.push(copy);
}
fs.writeFileSync(process.argv[1], JSON.stringify(doc));
' "$R/canned1.itf.json"
run_emit
OUT="$WORK/.out"
set +e
node -e '
const fs = require("node:fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const settled = doc.states.filter((s) =>
  JSON.stringify(s).includes("\"label\":\"settled\""),
).length;
console.log(`settled states: ${settled}`);
' "$R/corpus/tier1/faked.itf.json" >"$OUT" 2>&1
RC=$?
set -e
check "a trailing settled run is truncated to one state" 0 "$RC" "settled states: 1"

done_ "check-conformance.test.sh"
