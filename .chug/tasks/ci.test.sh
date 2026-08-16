#!/bin/sh
# Shell test for ci.sh — the sequencer's own behaviour, not the gates'.
#
# Cases run against throwaway repos holding stub gates with controllable exit
# codes: what is under test is how ci.sh *treats* a verdict — that a finding
# and a could-not-run stay different answers all the way to its own exit code,
# and that the suite budget stops where it says it does.
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
# recurse into a live run. That guard is inherited here and would skip the
# suite stage in the cases that exist to exercise it, so they set it back
# explicitly; recursion stays bounded because the stub ci.sh under test passes
# the guard down to its own stub suites.
run_ci() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_SHELL_SUITES=1 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
}

stub_repo 0
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "all gates clean exits 0" 0 "$RC" "all gates clean"
check "CHUG_CI_SHELL_SUITES=0 skips the suite stage" 0 "$RC" "SKIPPED"

stub_repo 1
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a gate finding exits 1" 1 "$RC" "1 gate(s) failed"

# A gate that could not run exits 2, NOT 1 and never 0.
stub_repo 2
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a gate that could not run exits 2" 2 "$RC" "could not run"
check "could-not-run is reported as not a pass" 2 "$RC" "this is not a pass"

stub_repo 0
printf '#!/bin/sh\nexit 1\n' > "$R/.chug/tasks/failing.test.sh"
chmod +x "$R/.chug/tasks/failing.test.sh"
git -C "$R" add -A
run_ci
check "a failing suite fails the run" 1 "$RC" "failing.test.sh"

stub_repo 0
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/passing.test.sh"
chmod +x "$R/.chug/tasks/passing.test.sh"
git -C "$R" add -A
run_ci
check "a passing suite leaves the run clean" 0 "$RC" "all gates clean"

# The budget stops between suites and NAMES what it did not run: one that
# silently truncates reads as full coverage.
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

# A glob matching nothing must not read as "the suites passed".
stub_repo 0
run_ci
check "no suites found exits 2, not 0" 2 "$RC" "matched nothing"

OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "ci.test.sh"
