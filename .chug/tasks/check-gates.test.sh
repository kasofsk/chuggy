#!/bin/sh
# Shell test for check-gates.sh.
#
# The rule this gate enforces — every gate has a sibling suite — is one this
# suite is itself an instance of, so the cases are built in throwaway repos
# rather than against the real tree: asserting against the real tree would
# make the suite pass or fail for reasons that have nothing to do with the
# script.
#
# THE REPO HELPER WRAPS `_suite.sh`'s RATHER THAN REPLACING IT. This file used
# to define its own `fresh_repo`, shadowing the shared one with a copy that
# differed by a single `mkdir` — so a reader who had read the harness knew the
# wrong thing about every case here, and a fix to the shared helper reached
# every suite but this one. Note what did NOT catch it:
# `.chug/tasks/check-duplication.sh` runs at threshold zero, but the detector
# has a floor and the copy sat under it. A clone too short to see is still two
# copies that will disagree, and a reviewer is the only thing that reads them.
#
# Run:  .chug/tasks/check-gates.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-gates.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

gates_repo() { # <dir> — a throwaway repo with the gate directory in place
	fresh_repo "$1"
	mkdir -p "$1/.chug/tasks"
}

# A suite that names its subject, which is what the gate now requires of one.
# Written by the same helper everywhere, so a case that means to violate the
# rule has to say so.
suite_naming() { # <path> <gate filename>
	printf '#!/bin/sh\nSUT="$HERE/%s"\n' "$2" > "$1"
}

run_in() { # <dir>
	OUT="$WORK/.out"
	set +e
	(cd "$1" && "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

R="$WORK/repo"

# 1. Every gate has its suite, and the suite names it -> clean.
gates_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/alpha.sh"
suite_naming "$R/.chug/tasks/alpha.test.sh" alpha.sh
git -C "$R" add -A
run_in "$R"
check "a gate with its suite is clean" 0 "$RC" "0 gate(s) without a suite"

# 2. A gate with no suite -> finding, naming the file it expected.
gates_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/beta.sh"
git -C "$R" add -A
run_in "$R"
check "a gate without a suite is a finding" 1 "$RC" "expected .chug/tasks/beta.test.sh"

# 3. A *.test.sh is not itself a gate — it must not demand a test of its own,
#    which would make the rule unsatisfiable.
gates_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/gamma.sh"
suite_naming "$R/.chug/tasks/gamma.test.sh" gamma.sh
git -C "$R" add -A
run_in "$R"
check "a suite is not itself a gate" 0 "$RC" "across 1 gate(s)"

# 4. The hook maps to its own suite name, not to `pre-commit.sh.test.sh`.
gates_repo "$R"
mkdir -p "$R/.githooks"
printf '#!/bin/sh\n' > "$R/.githooks/pre-commit"
git -C "$R" add -A
run_in "$R"
check "the hook expects pre-commit.test.sh" 1 "$RC" "expected .githooks/pre-commit.test.sh"

# 5. An untracked gate is invisible — the gate reads git, not the filesystem,
#    so a verdict cannot depend on a stray working-tree file.
gates_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/tracked.sh"
suite_naming "$R/.chug/tasks/tracked.test.sh" tracked.sh
git -C "$R" add -A
printf '#!/bin/sh\n' > "$R/.chug/tasks/untracked.sh"
run_in "$R"
check "an untracked gate is not judged" 0 "$RC" "0 gate(s) without a suite"

# 6. No gates at all -> could not run, not clean. A glob matching nothing is
#    the exact failure this script exists to prevent.
gates_repo "$R"
printf 'placeholder\n' > "$R/README.md"
git -C "$R" add -A
run_in "$R"
check "no gates found exits 2, not 0" 2 "$RC" "glob matched nothing"

# 7. A SUITE THAT NAMES NOTHING IS A PLACEHOLDER. File existence alone is
#    satisfied by an empty file, and an empty file is exactly what gets written
#    when a suite is added to satisfy this gate rather than to test anything.
gates_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/delta.sh"
printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/delta.test.sh"
git -C "$R" add -A
run_in "$R"
check "a suite that never names its gate is a finding" 1 "$RC" "never names delta.sh"

# 8. The hook's suite is held to the same rule, and its subject has no `.sh` to
#    name — the mapping above is not the only place the two spellings differ.
gates_repo "$R"
mkdir -p "$R/.githooks"
printf '#!/bin/sh\n' > "$R/.githooks/pre-commit"
printf '#!/bin/sh\nexit 0\n' > "$R/.githooks/pre-commit.test.sh"
git -C "$R" add -A
run_in "$R"
check "the hook's suite must name the hook" 1 "$RC" "never names pre-commit"
suite_naming "$R/.githooks/pre-commit.test.sh" pre-commit
git -C "$R" add -A
run_in "$R"
check "and is clean once it does" 0 "$RC" "0 gate(s) without a suite"

# 9. Outside a git checkout -> could not run.
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-gates.test.sh"
