#!/bin/sh
# Shell test for .githooks/pre-commit.
#
# THE LOAD-BEARING CASE is that a gate which could not run is a loud skip here
# and a failure in `just check`. That asymmetry is why the hook can be trusted
# not to block a commit the full check would accept, and it is the behaviour a
# well-meaning edit is most likely to "fix" into a rejection.
#
# Run:  .githooks/pre-commit.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../.chug/tasks/_suite.sh"
SUT="$HERE/pre-commit"

R="$WORK/repo"

stub_repo() { # <doc-lint exit>
	rm -rf "$R"
	mkdir -p "$R/.chug/tasks"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
	printf '#!/bin/sh\necho stub doc-lint spoke\nexit %s\n' "$1" > "$R/.chug/tasks/doc-lint.sh"
	chmod +x "$R/.chug/tasks/doc-lint.sh"
	git -C "$R" add -A
}

run_hook() {
	OUT="$WORK/.out"
	set +e
	(cd "$R" && "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

stub_repo 0
run_hook
check "clean gates allow the commit" 0 "$RC" "clean"

# A rejection that does not say why is a rejection that gets bypassed.
stub_repo 1
run_hook
check "a finding rejects the commit" 1 "$RC" "REJECTED by doc-lint"
check "the gate's output is shown to the author" 1 "$RC" "stub doc-lint spoke"

# Could-not-run is a LOUD SKIP, not a rejection: `just check` fails on the same
# verdict, and the hook must be the more permissive of the two.
stub_repo 2
run_hook
check "could-not-run does not block the commit" 0 "$RC" "could not run"
check "could-not-run still names the full check" 0 "$RC" "just check"

# A mid-merge commit is not the author's edit, and gating it would block a
# conflict resolution they cannot change.
stub_repo 1
: > "$R/.git/MERGE_HEAD"
run_hook
check "a merge in progress skips the hook" 0 "$RC" "MERGE_HEAD present"
rm -f "$R/.git/MERGE_HEAD"

# Gates land over time, and the hook must work in a repo without all of them.
rm -rf "$R"
mkdir -p "$R/.chug/tasks"
git -C "$R" init -q -b main
git -C "$R" config user.email t@example.com
git -C "$R" config user.name t
run_hook
check "an absent gate is skipped, not an error" 0 "$RC" "clean"

# Outside a git checkout the hook fails OPEN. It is not a gate of record;
# `just check` is, and it fails closed on the same condition.
OUT="$WORK/.out"
set +e
(cd "$WORK" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a checkout the hook fails open" 0 "$RC" "skipping"

done_ "pre-commit.test.sh"
