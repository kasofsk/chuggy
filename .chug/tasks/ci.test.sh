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
export LC_ALL=C

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/ci.sh"

WORK="$(mktemp -d)"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

pass=0
fail=0
check() { # <name> <expected-rc> <actual-rc> <must-contain>
	name="$1"; want="$2"; got="$3"; needle="$4"
	if [ "$got" = "$want" ] && grep -qF "$needle" "$OUT"; then
		echo "ok   - $name (rc=$got)"
		pass=$((pass + 1))
	else
		echo "FAIL - $name: rc want=$want got=$got; expected output to contain: $needle"
		echo "----- output -----"; cat "$OUT"; echo "------------------"
		fail=$((fail + 1))
	fi
}

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
stub_repo 0
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/one.test.sh"
chmod +x "$R/.chug/tasks/one.test.sh"
git -C "$R" add -A
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=1 CHUG_CI_SUITES_BUDGET_SECS=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "an exhausted budget names the suites it skipped" 1 "$RC" "did NOT run"
check "the skipped suite is named, not just counted" 1 "$RC" "one.test.sh"

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

echo "ci.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
