#!/bin/sh
# Shell test for ci.sh — the sequencer's own behaviour, not the gates'.
#
# Cases run against throwaway repos holding stub gates with controllable exit
# codes: what is under test is how ci.sh *treats* a verdict — that a finding
# and a could-not-run stay different answers all the way to its own exit code,
# and that the suite budget stops where it says it does.
#
# The fixture carries a stub for every gate the sequencer names, because a
# named gate that is absent is itself a could-not-run. A fixture short of one
# would exercise that rather than the case it was written for.
#
# Run:  .chug/tasks/ci.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/ci.sh"
SELECT="$HERE/_ci-select.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

# No case inherits a sequencer input it did not choose. ci.sh hands each suite
# the environment it was given, so an ambient one reaches the nested runs below
# and answers a question the case did not ask. These are ci.sh's own Env block
# and the base `_ci-select.sh` reads, less CHUG_CI_SHELL_SUITES — the recursion
# guard, which each case that reaches the suite stage sets for itself.
unset CHUG_CI_FULL CHUG_CI_BASE GITHUB_BASE_REF \
	CHUG_CI_SUITE_TIMEOUT_SECS CHUG_CI_SUITES_BUDGET_SECS

ROOT="$(cd "$HERE/../.." && pwd)"
grep -F '    ./.chug/tasks/ci.sh' "$ROOT/Justfile" >/dev/null
grep -F '    CHUG_CI_FULL=1 ./.chug/tasks/ci.sh' "$ROOT/Justfile" >/dev/null

# Read off the sequencer rather than listed here: the roster is the calls, and
# a second copy of it would be the half that drifts.
named_gates() { # <script> — the gates it calls, by bare name
	grep -o '\./\.chug/tasks/[a-z-]*\.sh' "$1" | sed 's|.*/||; s|\.sh$||'
}

# An empty roster would leave every case below passing against a repo with no
# gates at all — the exact reading this suite exists to refuse.
if [ -z "$(named_gates "$SUT")" ]; then
	echo "ci.test.sh: no gate calls found in $SUT; the fixture would stub nothing"
	exit 2
fi

stub_repo() { # <doc-lint exit> — every named gate stubbed clean but doc-lint
	fresh_repo "$R"
	mkdir -p "$R/.chug/tasks"
	cp "$SUT" "$R/.chug/tasks/ci.sh"
	cp "$SELECT" "$R/.chug/tasks/_ci-select.sh"
	chmod +x "$R/.chug/tasks/ci.sh"
	for gate in $(named_gates "$SUT"); do
		printf '#!/bin/sh\necho stub %s\nexit 0\n' "$gate" > "$R/.chug/tasks/$gate.sh"
		chmod +x "$R/.chug/tasks/$gate.sh"
	done
	printf '#!/bin/sh\necho stub doc-lint\nexit %s\n' "$1" > "$R/.chug/tasks/doc-lint.sh"
	chmod +x "$R/.chug/tasks/doc-lint.sh"
	git -C "$R" add -A
}

# The gate stage alone: with the suite stage on, the fixture's empty suite glob
# would add a second could-not-run and the counts below would stop being about
# the roster.
run_gates_only() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && CHUG_CI_SHELL_SUITES=0 ./.chug/tasks/ci.sh) >"$OUT" 2>&1
	RC=$?
	set -e
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
git -C "$R" commit -qm baseline
run_gates_only
check "all gates clean exits 0" 0 "$RC" "all gates clean"
check "CHUG_CI_SHELL_SUITES=0 skips the suite stage" 0 "$RC" "SKIPPED"
check "the default run uses change selection" 0 "$RC" "changed run"

stub_repo 0
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_FULL=1 CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "CHUG_CI_FULL forces every gate" 0 "$RC" "full run (CHUG_CI_FULL=1)"
check "the forced run executes the model gate" 0 "$RC" "stub check-model"

# A resolved base activates selection. Documentation does not reach the model,
# database or source toolchains, and each skip is stated rather than hidden.
stub_repo 0
git -C "$R" commit -qm baseline
printf '# docs\n' > "$R/README.md"
git -C "$R" add README.md
git -C "$R" commit -qm docs
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a resolved base activates a changed run" 0 "$RC" "changed run"
check "a docs-only change skips the model" 0 "$RC" "check-model: SKIPPED"
check "a docs-only change still runs doc-lint" 0 "$RC" "stub doc-lint"

stub_repo 0
mkdir -p "$R/src/domain"
printf 'export const changed = true;\n' > "$R/src/domain/changed.ts"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'export const changed = false;\n' > "$R/src/domain/changed.ts"
git -C "$R" add -A
git -C "$R" commit -qm source
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a source-only change skips Quint" 0 "$RC" "check-model: SKIPPED"
check "a source-only change selects static checks" 0 "$RC" "stub check-source"

stub_repo 0
mkdir -p "$R/model"
printf 'module before {}\n' > "$R/model/domain.qnt"
git -C "$R" add -A
git -C "$R" commit -qm baseline
printf 'module after {}\n' > "$R/model/domain.qnt"
git -C "$R" add -A
git -C "$R" commit -qm model
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=HEAD^ CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "a model change selects Quint" 0 "$RC" "stub check-model"
check "a model change selects model API generation" 0 "$RC" "stub check-model-api"

# An unresolvable base fails open to complete coverage, never to no coverage.
stub_repo 0
OUT="$WORK/.out"
set +e
(cd "$R" && CHUG_CI_BASE=refs/heads/absent CHUG_CI_SHELL_SUITES=0 \
	./.chug/tasks/ci.sh) >"$OUT" 2>&1
RC=$?
set -e
check "an absent base falls back to a full run" 0 "$RC" "full run"
check "the fallback explains the unresolved base" 0 "$RC" "cannot be resolved"

stub_repo 1
run_gates_only
check "a gate finding exits 1" 1 "$RC" "1 gate(s) failed"

# A gate that could not run exits 2, NOT 1 and never 0.
stub_repo 2
run_gates_only
check "a gate that could not run exits 2" 2 "$RC" "could not run"
check "could-not-run is reported as not a pass" 2 "$RC" "this is not a pass"

# A gate the sequencer names but the tree does not carry is a could-not-run
# too. Guarding the call with `[ -x ]` made this print "all gates clean" having
# never attempted the gate — a not-run that read exactly like a pass.
stub_repo 0
rm -f "$R/.chug/tasks/check-gates.sh"
git -C "$R" add -A
run_gates_only
check "a missing named gate exits 2, not 0" 2 "$RC" "1 gate(s) could not run"
check "the missing gate is named" 2 "$RC" "check-gates.sh is missing"

# The half a diff hides in a mode line.
stub_repo 0
chmod -x "$R/.chug/tasks/check-conformance.sh"
git -C "$R" add -A
run_gates_only
check "a non-executable named gate exits 2, not 0" 2 "$RC" "1 gate(s) could not run"
check "the non-executable gate is named" 2 "$RC" "check-conformance.sh is not executable"

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
