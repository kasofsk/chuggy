#!/bin/sh
# Shell test for check-paths.sh.
#
# Every case runs in a throwaway repo. The gate's verdicts come from
# `git ls-files` and from the deletion history, so a fixture that is not a repo
# with commits in it would exercise neither.
#
# The case that decides whether the gate is usable is the silent one: a path no
# history of this repo has ever held. Without it the gate is a prose linter.
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

seeded_repo
cite 'The gate is `.chug/tasks/real.sh` and it runs.'
run_in "$R"
check "a resolving path is clean" 0 "$RC" "0 finding(s)"

# R1: the first segment is ours, so the path must be.
seeded_repo
cite 'See `.chug/tasks/missing.sh` for the details.'
run_in "$R"
check "a missing path under a tracked root is a finding" 1 "$RC" "notes.md:1: .chug/tasks/missing.sh"

# R1b: a `./` token resolves against the file that writes it, and the shape
# that needs it is a module naming its neighbour under a directory whose name
# is also a tracked top level.
seeded_repo
mkdir -p "$R/.chug/tasks/ui"
printf 'export const x = 1\n' > "$R/.chug/tasks/ui/Pill.tsx"
printf '%s\n' 'import { x } from "./ui/Pill.tsx"' > "$R/.chug/tasks/draw.tsx"
git -C "$R" add -A
run_in "$R"
check "a relative token resolves beside the file that writes it" 0 "$RC" "0 finding(s)"

# The root-relative reading is still open, which is what the sequencer calling
# a gate is: the caller sits in a directory holding no gate directory of its
# own, and names one from the root it changed to.
seeded_repo
printf '%s\n' '# it runs ./.chug/tasks/real.sh' > "$R/.chug/tasks/caller.sh"
git -C "$R" add -A
run_in "$R"
check "a relative token still resolves against the root" 0 "$RC" "0 finding(s)"

# Neither reading, and it is a finding like any other. The tracked top level
# is what puts the token under R1 in the first place.
seeded_repo
mkdir -p "$R/ui"
printf 'a console\n' > "$R/ui/README.md"
printf '%s\n' 'import { x } from "./ui/Missing.tsx"' > "$R/.chug/tasks/draw.tsx"
git -C "$R" add -A
run_in "$R"
check "a relative token that resolves nowhere is a finding" 1 "$RC" "ui/Missing.tsx"

# A directory claim is satisfied by anything tracked beneath it.
seeded_repo
cite 'Gate scripts live in `.chug/tasks/`.'
run_in "$R"
check "a directory with a file beneath it resolves" 0 "$RC" "0 finding(s)"

# R2: deleted, and still named. The deletion has to be committed — the history
# is where the answer comes from, not the working tree.
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

# And a path under the deleted directory, which was never itself a file.
cite 'Everything under `docs/reference/style.md` is gone.'
run_in "$R"
check "a path under a deleted directory is a finding" 1 "$RC" "which this tree deleted"

# A foreign path is SILENT: prose is full of slashes this repo has no opinion
# about.
seeded_repo
cite 'Compare `src/main/java/App.java`, and the read/write split, and and/or.'
run_in "$R"
check "a path that was never ours is not judged" 0 "$RC" "0 finding(s)"

# A glob's literal prefix is not a path claim.
seeded_repo
cite 'Handled by `.chug/nope/*.sh` and `.chug/nope/{a,b}.sh`.'
run_in "$R"
check "a glob prefix is not a claim" 0 "$RC" "0 finding(s)"

# In a *.test.sh, code is fixture-building and comments are claims, and both
# halves are asserted. The fixture line has to be one the gate WOULD flag if it
# read it — a path under a tracked root that does not resolve — or the case
# passes with the narrowing deleted.
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

# An explicit argument narrows the scan and nothing else.
seeded_repo
cite 'A finding lives here: `.chug/tasks/missing.sh`.'
run_in "$R" README.md
check "an argument scans only that file" 0 "$RC" "in 1 file(s)"

run_in "$NOREPO"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

# A listing matching nothing is the same failure as a glob matching nothing.
fresh_repo "$R"
run_in "$R"
check "no tracked files exits 2, not 0" 2 "$RC" "LINTER ERROR"



# --- The design-doc exemption ------------------------------------------------
#
# It covers one directory, needs a marker, and suppresses nothing. Each half
# gets a case: an exemption with no negative case is how a narrow one widens.

fresh_repo "$R"
mkdir -p "$R/docs/design" "$R/src"
printf '%s\n' 'x' > "$R/src/real.ts"
printf '%s\n' 'The layer lives at src/actor/ <!-- intent -->' > "$R/docs/design/004-plan.md"
git -C "$R" add -A
run_in "$R"
check "a marked design-doc claim is not a finding" 0 "$RC" "1 marked as intent"

run_in "$R"
check "a marked claim is still reported, never hidden" 0 "$RC" "designed, not built"

fresh_repo "$R"
mkdir -p "$R/docs/design" "$R/src"
printf '%s\n' 'x' > "$R/src/real.ts"
printf '%s\n' 'The layer lives at src/actor/' > "$R/docs/design/004-plan.md"
git -C "$R" add -A
run_in "$R"
check "an unmarked design-doc claim is still a finding" 1 "$RC" "no such path"

fresh_repo "$R"
mkdir -p "$R/docs" "$R/src"
printf '%s\n' 'x' > "$R/src/real.ts"
printf '%s\n' 'The layer lives at src/actor/ <!-- intent -->' > "$R/docs/notes.md"
git -C "$R" add -A
run_in "$R"
check "the marker works in no other directory" 1 "$RC" "no such path"

fresh_repo "$R"
mkdir -p "$R/docs/design" "$R/src"
printf '%s\n' 'x' > "$R/src/real.ts"
printf '%s\n' 'The gate is at .chug/tasks/nope.sh <!-- intent -->' > "$R/docs/design/004-plan.md"
mkdir -p "$R/.chug/tasks"
printf '%s\n' 'x' > "$R/.chug/tasks/real.sh"
git -C "$R" add -A
run_in "$R"
check "a marked claim about any tracked top level is exempt too" 0 "$RC" "1 marked as intent"

done_ "check-paths.test.sh"
