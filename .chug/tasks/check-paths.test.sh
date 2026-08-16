#!/bin/sh
# Shell test for check-paths.sh.
#
# Every case runs in a throwaway repo. The gate's verdicts come from
# `git ls-files` and from the deletion history, so a fixture that is not a repo
# with commits in it would exercise neither.
#
# The two halves worth stating, because they are what the gate is for:
#
#   R1 — a token whose first segment is tracked is a claim about this tree, and
#        cases 2 and 3 hold it to that in both directions.
#   R2 — a token whose first segment is NOT tracked is only interesting if this
#        tree used to have it. Case 4 deletes a file and then names it; case 5
#        names a path no history of this repo has ever held, and must stay
#        silent. Without case 5 the gate would be a prose linter.
#
# Cases 7 and 8 pin the two narrowings that keep the noise down, and both are
# regressions waiting to happen: a glob's literal prefix is not a path, and a
# suite's fixture paths are real in a tree that is not this one.
#
# Run:  .chug/tasks/check-paths.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-paths.sh"
NOREPO="$(mktemp -d)"
trap 'rm -rf "$WORK" "$NOREPO"' EXIT

R="$WORK/repo"

run_in() { # <dir> [<arg>...]
	_dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$_dir" && "$SUT" "$@") > "$OUT" 2>&1
	RC=$?
	set -e
}

# A repo with one tracked gate under a `.chug/` root, ready to be cited.
seeded_repo() {
	fresh_repo "$R"
	mkdir -p "$R/.chug/tasks"
	printf '#!/bin/sh\n' > "$R/.chug/tasks/real.sh"
	printf '# chuggy\n' > "$R/README.md"
	git -C "$R" add -A
	git -C "$R" commit -qm seed
}

cite() { # <line...> — a file whose only job is to name paths
	printf '%s\n' "$@" > "$R/notes.md"
	git -C "$R" add -A
}

# 1. A path that resolves is a claim, and a satisfied one.
seeded_repo
cite 'The gate is `.chug/tasks/real.sh` and it runs.'
run_in "$R"
check "a resolving path is clean" 0 "$RC" "0 finding(s)"

# 2. R1: the first segment is ours, so the path must be.
seeded_repo
cite 'See `.chug/tasks/missing.sh` for the details.'
run_in "$R"
check "a missing path under a tracked root is a finding" 1 "$RC" "notes.md:1: .chug/tasks/missing.sh"

# 3. A directory claim is satisfied by anything tracked beneath it.
seeded_repo
cite 'Gate scripts live in `.chug/tasks/`.'
run_in "$R"
check "a directory with a file beneath it resolves" 0 "$RC" "0 finding(s)"

# 4. R2: deleted, and still named. The deletion has to be committed — the
#    history is where the answer comes from, not the working tree.
seeded_repo
mkdir -p "$R/docs"
printf 'gone\n' > "$R/docs/policy.md"
git -C "$R" add -A
git -C "$R" commit -qm add-docs
git -C "$R" rm -q docs/policy.md
git -C "$R" commit -qm drop-docs
cite 'The policy is in `docs/policy.md`.'
run_in "$R"
check "a deleted path is a finding" 1 "$RC" "deleted from this tree"

# 5. And a path under the deleted directory, which was never itself a file.
cite 'Everything under `docs/reference/style.md` is gone.'
run_in "$R"
check "a path under a deleted directory is a finding" 1 "$RC" "which this tree deleted"

# 6. A foreign path is SILENT. This is the case that decides whether the gate
#    is usable: prose is full of slashes this repo has no opinion about.
seeded_repo
cite 'Compare `src/main/java/App.java`, and the read/write split, and and/or.'
run_in "$R"
check "a path that was never ours is not judged" 0 "$RC" "0 finding(s)"

# 7. A glob's literal prefix is not a path claim. Without this the case
#    statement matching `.chug/tasks/*.sh` reads as a claim about a directory
#    named by the part before the star.
seeded_repo
cite 'Handled by `.chug/nope/*.sh` and `.chug/nope/{a,b}.sh`.'
run_in "$R"
check "a glob prefix is not a claim" 0 "$RC" "0 finding(s)"

# 8. In a *.test.sh, code is fixture-building and comments are claims. Both
#    halves asserted, because exempting the file entirely would have hidden
#    the citation this gate was written to catch.
#    The fixture line has to be one the gate WOULD flag if it read it — a path
#    under a tracked root that does not resolve. A fixture rooted anywhere else
#    is skipped for a different reason, and the case would pass with the
#    narrowing deleted.
seeded_repo
printf '%s\n' 'run .chug/tasks/fixture-only.sh' > "$R/.chug/tasks/real.test.sh"
git -C "$R" add -A
run_in "$R"
check "a suite's fixture paths are not claims" 0 "$RC" "0 finding(s)"

printf '%s\n' '# It replaces `.chug/tasks/vanished.sh`.' 'run docs/fixture/x.md' \
	> "$R/.chug/tasks/real.test.sh"
git -C "$R" add -A
run_in "$R"
check "a suite's comment IS a claim" 1 "$RC" "real.test.sh:1: .chug/tasks/vanished.sh"

# 9. An explicit argument narrows the scan and nothing else — the tracked set
#    it resolves against is still the whole tree.
seeded_repo
cite 'A finding lives here: `.chug/tasks/missing.sh`.'
run_in "$R" README.md
check "an argument scans only that file" 0 "$RC" "in 1 file(s)"

# 10. Outside a git checkout there is nothing to resolve against.
run_in "$NOREPO"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

# 11. A repo with no tracked files at all cannot be judged clean: the listing
#     matching nothing is the same shape of failure as a glob matching nothing.
fresh_repo "$R"
run_in "$R"
check "no tracked files exits 2, not 0" 2 "$RC" "LINTER ERROR"

# 12. NO AWK IS A BROKEN GATE, NOT A PASS. Both the token scan and the
#     resolution pass are awk programs, and without the guard the shell exits
#     on the missing command with a status this gate's header does not claim.
#
#     The PATH holds the rest of what the gate reaches for so the fixture is a
#     degraded host rather than an empty one, but that is honesty and not
#     discrimination: the awk guard sits above every other line in the gate, so
#     an empty PATH would produce the same verdict. Which means this case
#     cannot notice `tools_only` handing it a broken link either — the gate
#     refuses before it needs any of the tools named. `_suite.sh` says what
#     that costs and why it is worn rather than fixed.
NOAWK="$WORK/noawk"
tools_only "$NOAWK" git mktemp grep sort rm
seeded_repo
OUT="$WORK/.out"
set +e
(cd "$R" && env PATH="$NOAWK" "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "no awk exits 2, not 127" 2 "$RC" "no \`awk\` on PATH"

done_ "check-paths.test.sh"
