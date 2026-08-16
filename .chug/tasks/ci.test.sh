#!/bin/sh
# Shell test for ci.sh — the sequencer's own behaviour, not the gates'.
#
# Cases run against throwaway repos holding stub gates with controllable exit
# codes, because what is under test is how ci.sh *treats* a verdict: that a
# finding and a could-not-run are different answers all the way to its own
# exit code, and that the suite budget stops where it says it does.
#
# The real ci.sh hands every suite CHUG_CI_SHELL_SUITES=0, which is what keeps
# this file from recursing into a live run when the suite stage executes it.
#
# Run:  .chug/tasks/ci.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/ci.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

stub_repo() { # <doc-lint exit> — a repo whose only gate is a stub doc-lint
	rm -rf "$R"
	mkdir -p "$R/.chug/tasks"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
	cp "$SUT" "$R/.chug/tasks/ci.sh"
	printf '#!/bin/sh\necho stub doc-lint\nexit %s\n' "$1" > "$R/.chug/tasks/doc-lint.sh"
	chmod +x "$R/.chug/tasks/doc-lint.sh" "$R/.chug/tasks/ci.sh"
	git -C "$R" add -A
}

# The real ci.sh hands every suite CHUG_CI_SHELL_SUITES=0 so this file cannot
# recurse into a live run. That guard is inherited here, which would silently
# skip the suite stage in exactly the cases below that exist to exercise it —
# so they set it back to 1 explicitly. Recursion stays bounded because the
# stub ci.sh under test passes 0 down to its own stub suites.
run_ci() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_SHELL_SUITES=1 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}

# 1. Every gate clean, suite stage off -> clean.
stub_repo 0
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "all gates clean exits 0" 0 "$RC" "all gates clean"
check "CHUG_CI_SHELL_SUITES=0 skips the suite stage" 0 "$RC" "SKIPPED"

# 2. A gate returning 1 is a finding -> exit 1.
stub_repo 1
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a gate finding exits 1" 1 "$RC" "1 gate(s) failed"

# 3. A gate returning 2 could not run -> exit 2, NOT 1 and never 0. This is the
#    distinction the whole three-valued convention exists for.
stub_repo 2
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a gate that could not run exits 2" 2 "$RC" "could not run"
check "could-not-run is reported as not a pass" 2 "$RC" "this is not a pass"

# 4. The suite stage runs a tracked suite and reports its failure.
stub_repo 0
printf '#!/bin/sh\nexit 1\n' > "$R/.chug/tasks/failing.test.sh"
chmod +x "$R/.chug/tasks/failing.test.sh"
git -C "$R" add -A
run_ci
check "a failing suite fails the run" 1 "$RC" "failing.test.sh"

# 5. A suite that passes leaves the run clean, and the stage says so.
stub_repo 0
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/passing.test.sh"
chmod +x "$R/.chug/tasks/passing.test.sh"
git -C "$R" add -A
run_ci
check "a passing suite leaves the run clean" 0 "$RC" "all gates clean"

# 6. The budget stops between suites and NAMES what it did not run. A budget
#    that silently truncates reads as full coverage.
#
#    A skipped suite is a could-not-run, not a finding, and EVERY skipped suite
#    counts: the tally used to take one increment for the whole truncated tail,
#    so a budget that stopped the entire stage reported the same as a single
#    gate finding. Two suites here, so the tally has something to get wrong.
stub_repo 0
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/one.test.sh"
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/two.test.sh"
chmod +x "$R/.chug/tasks/one.test.sh" "$R/.chug/tasks/two.test.sh"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=1 CHUG_CI_SUITES_BUDGET_SECS=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "an exhausted budget names the suites it skipped" 2 "$RC" "did NOT run"
check "the skipped suite is named, not just counted" 2 "$RC" "one.test.sh"
check "a skipped suite is a could-not-run, not a failure" 2 "$RC" \
	"2 gate(s) could not run"

# 7. No suites at all -> could not run. The glob matching nothing must not read
#    as "the suites passed".
stub_repo 0
run_ci
check "no suites found exits 2, not 0" 2 "$RC" "matched nothing"

# 8. Outside a git checkout -> could not run.
OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

# 9. THE PER-SUITE CAP, which nothing drove until now — the one bound this file
#    announces on every run and had never once applied in a case. A suite the
#    cap kills reached no verdict, so it is a could-not-run and not a finding,
#    and the message has to name the cap: a reader told only "rc=124" goes
#    looking for a bug in a suite that never got to have one.
#
#    Skipped where no working `timeout` resolves, on ci.sh's own probe and for
#    its reason: macOS ships neither, the stage runs uncapped there, and a
#    sleeping suite with nothing to kill it would hang this file instead.
if timeout 5 true > /dev/null 2>&1 || gtimeout 5 true > /dev/null 2>&1; then
	stub_repo 0
	printf '#!/bin/sh\nsleep 30\n' > "$R/.chug/tasks/slow.test.sh"
	chmod +x "$R/.chug/tasks/slow.test.sh"
	git -C "$R" add -A
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_SHELL_SUITES=1 CHUG_CI_SUITE_TIMEOUT_SECS=2 \
		./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
	check "a suite the cap killed exits 2, not 1" 2 "$RC" "per-suite cap"
	check "the killed suite is named" 2 "$RC" "slow.test.sh"
else
	echo "skip - the per-suite cap (no working timeout or gtimeout on this host)"
fi

# 10. AND THE OTHER HALF OF THAT READING. The kill is recognised by an exit
#     code, and an exit code is not proof of a kill: 124 is a byte any suite
#     may return of its own accord. So the could-not-run reading is made only
#     where a cap was actually applied, and this drives the case that pins it —
#     the same 124, on a host with no `timeout` to have produced it, is a
#     finding. Without the conjunct the stage would announce a cap it is not
#     applying as the reason a suite it ran to completion did not finish.
NOCAP="$WORK/nocap"
tools_only "$NOCAP" git date sed sh
stub_repo 0
printf '#!/bin/sh\nexit 124\n' > "$R/.chug/tasks/onetwentyfour.test.sh"
chmod +x "$R/.chug/tasks/onetwentyfour.test.sh"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && env PATH="$NOCAP" CHUG_CI_SHELL_SUITES=1 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "that exit code without a cap applied is a finding" 1 "$RC" \
	"FAILED — .chug/tasks/onetwentyfour.test.sh"
check "and the stage says it was running uncapped" 1 "$RC" "UNCAPPED"

done_ "ci.test.sh"
