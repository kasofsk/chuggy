#!/bin/sh
# Shell test for .githooks/pre-commit.
#
# The load-bearing case is #4: a gate that could not run must be a loud skip
# here and a failure in `just check`. That asymmetry is the whole reason the
# hook can be trusted not to block a commit CI would accept, and it is the one
# behaviour a well-meaning edit is most likely to "fix" into a rejection.
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

# 1. Clean gates -> the commit proceeds.
stub_repo 0
run_hook
check "clean gates allow the commit" 0 "$RC" "clean"

# 2. A finding rejects, and the gate's own output reaches the author — a
#    rejection that does not say why is a rejection that gets bypassed.
stub_repo 1
run_hook
check "a finding rejects the commit" 1 "$RC" "REJECTED by doc-lint"
check "the gate's output is shown to the author" 1 "$RC" "stub doc-lint spoke"

# 3. Could-not-run is a LOUD SKIP, not a rejection. `just check` fails on this
#    same verdict; the hook must be the more permissive of the two.
stub_repo 2
run_hook
check "could-not-run does not block the commit" 0 "$RC" "could not run"
check "could-not-run still names the full check" 0 "$RC" "just check"

# 4. A mid-merge commit is skipped: it is not the author's edit, and gating it
#    would block a conflict resolution they cannot change.
stub_repo 1
: > "$R/.git/MERGE_HEAD"
run_hook
check "a merge in progress skips the hook" 0 "$RC" "MERGE_HEAD present"
rm -f "$R/.git/MERGE_HEAD"

# 5. An absent gate is not an error — gates land over time, and the hook must
#    work in a repo that does not have all of them yet.
rm -rf "$R"
mkdir -p "$R/.chug/tasks"
git -C "$R" init -q -b main
git -C "$R" config user.email t@example.com
git -C "$R" config user.name t
run_hook
check "an absent gate is skipped, not an error" 0 "$RC" "clean"

# 6. Outside a git checkout the hook fails OPEN. It is not a gate of record;
#    `just check` is, and it fails closed on the same condition.
OUT="$WORK/.out"
set +e
(cd "$WORK" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a checkout the hook fails open" 0 "$RC" "skipping"

# 7. THE STAGED-ARGUMENT BRANCH, which nothing here drove. check-paths is the
#    one gate the hook narrows: whole-tree in `just check`, staged-only here,
#    and the narrowing is a hand-rolled split of `git diff --cached` output
#    onto the argument list. Get that split wrong and the gate is handed one
#    argument that names no file, answers "no readable files to scan", exits 0
#    — and the hook reports a clean commit having checked nothing.
#
#    So the case drives the REAL check-paths over a real staged set, with the
#    claim in the file whose NAME is the thing under test: reach it and the
#    split held, miss it and the hook says clean. check-paths itself is left
#    unstaged, because a gate script full of true claims about the repo it
#    ships in is full of false ones about a fixture.
#
#    THE SPLIT HAS TWO GUARDS AND EACH GETS ITS OWN NAME. `set -f` stops the
#    staged words being glob-expanded and the newline `IFS` stops them being
#    split on whitespace; drop either one and the other still looks like it is
#    working. A filename with a space in it is what the IFS is for, and a
#    filename spelled like a bracket glob — with the file it would expand to
#    sitting beside it, clean — is what `set -f` is for. Both produce the same
#    false clean, from opposite ends.
#    The copy of check-paths goes in AFTER everything is staged, and it is the
#    last thing this helper does for that reason: stage it and its own header's
#    claims — true of the repo it ships in, false of a fixture — become the
#    findings, and every case here would go red whatever the split did.
staged_repo() { # <claim-carrying filename> <its body> [<extra clean file>]
	stub_repo 0
	printf 'placeholder\n' > "$R/README.md"
	printf '%s\n' "$2" > "$R/$1"
	[ -z "${3:-}" ] || printf 'nothing is claimed here\n' > "$R/$3"
	git -C "$R" add -A
	cp "$HERE/../.chug/tasks/check-paths.sh" "$R/.chug/tasks/check-paths.sh"
	chmod +x "$R/.chug/tasks/check-paths.sh"
}

BAD='It is written in `.chug/tasks/nope.sh`.'

staged_repo notes.md "$BAD"
run_hook
check "a staged file with a bad path claim rejects" 1 "$RC" "REJECTED by check-paths"
check "the staged file is reached, so the split held" 1 "$RC" ".chug/tasks/nope.sh"

# The IFS. Split on the default whitespace and this name becomes two arguments,
# neither of which is a file, and check-paths answers over an empty scan.
staged_repo 'bad claim.md' "$BAD"
run_hook
check "a staged name with a space is one argument" 1 "$RC" "bad claim.md"

# `set -f`. Dropped, the shell expands the staged word as a pattern and hands
# over the clean file it matches instead of the one carrying the claim — which
# is why `a.md` has to exist and be clean for the case to mean anything.
staged_repo '[a].md' "$BAD" a.md
run_hook
check "a staged name spelled like a glob is not expanded" 1 "$RC" "[a].md"

# The control. Same staged set, a claim that resolves — so the rejections above
# are the claim's doing and not the branch's mere existence.
staged_repo notes.md 'It is written in `.chug/tasks/doc-lint.sh`.'
run_hook
check "a staged file with a good path claim passes" 0 "$RC" "clean"

done_ "pre-commit.test.sh"
