#!/bin/sh
# Shell test for check-gates.sh.
#
# The rule this gate enforces is one this suite is itself an instance of, so
# the cases are built in throwaway repos: asserting against the real tree would
# pass or fail for reasons that have nothing to do with the script.
#
# Run:  .chug/tasks/check-gates.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-gates.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

fresh_repo() { # <dir> — an empty tracked repo
	rm -rf "$1"
	mkdir -p "$1/.chug/tasks"
	git -C "$1" init -q -b main
	git -C "$1" config user.email t@example.com
	git -C "$1" config user.name t
}

run_in() { # <dir>
	OUT="$WORK/.out"
	set +e
	(cd "$1" && "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

R="$WORK/repo"

fresh_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/alpha.sh"
printf '#!/bin/sh\n' > "$R/.chug/tasks/alpha.test.sh"
git -C "$R" add -A
run_in "$R"
check "a gate with its suite is clean" 0 "$RC" "0 gate(s) without a suite"

fresh_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/beta.sh"
git -C "$R" add -A
run_in "$R"
check "a gate without a suite is a finding" 1 "$RC" "expected .chug/tasks/beta.test.sh"

# A *.test.sh must not demand a test of its own, which would make the rule
# unsatisfiable.
fresh_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/gamma.sh"
printf '#!/bin/sh\n' > "$R/.chug/tasks/gamma.test.sh"
git -C "$R" add -A
run_in "$R"
check "a suite is not itself a gate" 0 "$RC" "across 1 gate(s)"

# The hook maps to its own suite name, not to `pre-commit.sh.test.sh`.
fresh_repo "$R"
mkdir -p "$R/.githooks"
printf '#!/bin/sh\n' > "$R/.githooks/pre-commit"
git -C "$R" add -A
run_in "$R"
check "the hook expects pre-commit.test.sh" 1 "$RC" "expected .githooks/pre-commit.test.sh"

# The gate reads git, not the filesystem, so a verdict cannot depend on a stray
# working-tree file.
fresh_repo "$R"
printf '#!/bin/sh\n' > "$R/.chug/tasks/tracked.sh"
printf '#!/bin/sh\n' > "$R/.chug/tasks/tracked.test.sh"
git -C "$R" add -A
printf '#!/bin/sh\n' > "$R/.chug/tasks/untracked.sh"
run_in "$R"
check "an untracked gate is not judged" 0 "$RC" "0 gate(s) without a suite"

# A glob matching nothing is the exact failure this script exists to prevent.
fresh_repo "$R"
printf 'placeholder\n' > "$R/README.md"
git -C "$R" add -A
run_in "$R"
check "no gates found exits 2, not 0" 2 "$RC" "glob matched nothing"

run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-gates.test.sh"
