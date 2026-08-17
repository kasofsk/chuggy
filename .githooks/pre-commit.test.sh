#!/bin/sh
# Shell test for .githooks/pre-commit.
#
# THE LOAD-BEARING CASE is that a gate which could not run is a loud skip here
# and a failure in `just check`. That asymmetry is why the hook can be trusted
# not to block a commit the full check would accept, and it is the behaviour a
# well-meaning edit is most likely to "fix" into a rejection.
#
# Its boundary is the case after it: a gate the hook names and cannot find
# stops the commit, because that is a claim about the tree rather than about
# the machine the hook happens to be running on.
#
# Run:  .githooks/pre-commit.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../.chug/tasks/_suite.sh"
SUT="$HERE/pre-commit"

R="$WORK/repo"

# The hook's roster is the gates it calls, so the fixture reads it off the hook
# instead of keeping a list that would drift out of step with it.
hook_gates() { grep -o '\./\.chug/tasks/[a-z-]*\.sh' "$SUT" | sed 's|.*/||; s|\.sh$||'; }

if [ -z "$(hook_gates)" ]; then
	echo "pre-commit.test.sh: no gate calls found in $SUT; the fixture would stub nothing"
	exit 2
fi

stub_repo() { # <doc-lint exit> — every gate the hook names, clean but doc-lint
	fresh_repo "$R"
	mkdir -p "$R/.chug/tasks"
	for gate in $(hook_gates); do
		printf '#!/bin/sh\nexit 0\n' > "$R/.chug/tasks/$gate.sh"
		chmod +x "$R/.chug/tasks/$gate.sh"
	done
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

# A gate the hook names but the tree does not carry stops the commit, where the
# case above does not: a gate that ran and said it could not is describing the
# machine, and this is describing the tree. Guarding the call with `[ -x ]`
# made a deleted gate and a clean one print the same line.
stub_repo 0
rm -f "$R/.chug/tasks/check-gates.sh"
git -C "$R" add -A
run_hook
check "a missing named gate stops the commit" 2 "$RC" "check-gates.sh is missing"
check "the count of unrunnable gates is reported" 2 "$RC" "1 gate(s) named but not runnable"

# The half a diff hides in a mode line.
stub_repo 0
chmod -x "$R/.chug/tasks/check-comments.sh"
git -C "$R" add -A
run_hook
check "a non-executable named gate stops the commit" 2 "$RC" "check-comments.sh is not executable"

# Outside a git checkout the hook fails OPEN. It is not a gate of record;
# `just check` is, and it fails closed on the same condition.
OUT="$WORK/.out"
set +e
(cd "$WORK" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a checkout the hook fails open" 0 "$RC" "skipping"

done_ "pre-commit.test.sh"
