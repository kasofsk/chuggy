#!/bin/sh
# Shell test for check-knowledge.sh.
#
# THE NEGATIVE CASES CARRY THIS SUITE. The gate refuses a shape that a design
# doc is otherwise made of — a table row, a section heading — so every allowed
# form gets a case proving it stays silent: a proposed row arguing at length, a
# landed row that is only a pointer, a heading that says the word later in its
# own title, and prose anywhere but a table.
#
# The tally case is the other half. A gate's success line reports what that run
# consumed, so this suite builds a corpus whose landed rows, headings and docs
# it knows by construction and requires the line to report exactly those.
#
# Run:  .chug/tasks/check-knowledge.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-knowledge.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

run_in() { # <dir>
	OUT="$WORK/.out"
	set +e
	(cd "$1" && "$SUT") > "$OUT" 2>&1
	RC=$?
	set -e
}

doc_saying() { # <line>...
	fresh_repo "$R"
	mkdir -p "$R/docs/design"
	printf '%s\n' "$@" > "$R/docs/design/004-plan.md"
	git -C "$R" add -A
	run_in "$R"
}

# --- The shapes it must catch ------------------------------------------------

doc_saying '# A plan' '## Correction — 2026-08-16 (what one session got wrong)' 'It was wrong.'
check "a Correction section is a finding" 1 "$RC" "004-plan.md:2: a Correction section"

# A correction hidden a level down is the same accretion under a smaller
# heading, so the level is not part of the rule.
doc_saying '# A plan' '#### correction' 'It was wrong.'
check "a Correction at any level is a finding" 1 "$RC" "a Correction section"

# A landed row restating the contract the commit already satisfied.
doc_saying '| S0 | Toolchain | Formatter and linter sequenced in. | **Landed** `abc1234` |'
check "a landed row with a sentence is a finding" 1 "$RC" "a landed row states its argument"

# A SEMICOLON JOINS CLAUSES, so it is the other half of the same test: the
# contract cells in this tree's own table joined theirs that way.
doc_saying '| S1 | Corpus | one script emits; the gate replays | **Landed** `abc1234` |'
check "a semicolon in a landed row is a finding" 1 "$RC" "a landed row states its argument"

# --- The shapes it must stay silent on ---------------------------------------

# A row that is a pointer. The backticked spans go before the test, so a commit
# pointer and a path carry punctuation that is not prose.
doc_saying '| # | Label | Contract | Status |' '|---|---|---|---|' \
	'| S0 | Toolchain and tree shape | — | **Landed** `abc1234` |' \
	'| S8 | The interpreter | the wiring in `src/compose.ts` | **Landed** `def5678` |'
check "a landed row that is a pointer is silent" 0 "$RC" "0 finding(s)"

# AN UNLANDED ROW IS WHERE THE ARGUMENT BELONGS, and it may argue at any length.
doc_saying '| S7 | The journaled actor | Cmd, Entry, and the carry rule. Pure; its suite is exhaustive. | Proposed |'
check "a proposed row may argue" 0 "$RC" "0 finding(s)"

# The rule is about a section that corrects, not about the word.
doc_saying '# A plan' '## What a correction cannot buy' 'A correction is one session.'
check "a heading that mentions the word later is silent" 0 "$RC" "0 finding(s)"

# Prose outside a table row is the reviewer's, and the gate says nothing.
doc_saying '# A plan' 'S0 landed the toolchain. It did more than the row asked.'
check "prose outside a row is invisible" 0 "$RC" "0 finding(s)"

# --- Scope -------------------------------------------------------------------

# ONE DIRECTORY, because it is the only one that writes in the future tense.
fresh_repo "$R"
mkdir -p "$R/docs/design"
printf '%s\n' '# Notes' '## Correction — 2026-08-16' > "$R/README.md"
printf '%s\n' '# A plan' > "$R/docs/design/004-plan.md"
git -C "$R" add -A
run_in "$R"
check "a Correction outside the directory is silent" 0 "$RC" "0 finding(s)"

# --- The success line --------------------------------------------------------

# THE FIGURES ARE THE RUN'S OWN, and this fixture is built so the suite knows
# each of them: two docs, three rows saying Landed and nothing else, three
# headings. A separator row says nothing and is counted as nothing.
fresh_repo "$R"
mkdir -p "$R/docs/design"
printf '%s\n' '# A plan' '## The slice table' '| # | Label | Status |' '|---|---|---|' \
	'| S0 | Toolchain | **Landed** `abc1234` |' \
	'| S1 | Corpus | **Landed** `def5678` |' \
	'| S2 | Vocabulary | Proposed |' > "$R/docs/design/004-plan.md"
printf '%s\n' '# Another plan' '| S0 | **Landed** `999aaaa` |' > "$R/docs/design/005-other.md"
git -C "$R" add -A
run_in "$R"
check "the clean line reports what the run read" 0 "$RC" \
	"check-knowledge: 0 finding(s) across 3 landed row(s) and 3 heading(s) in 2 design doc(s)"

# --- Could not run -----------------------------------------------------------

# A corpus that matched nothing is not a clean tree.
fresh_repo "$R"
printf '%s\n' '{}' > "$R/package.json"
git -C "$R" add -A
run_in "$R"
check "an empty corpus exits 2, not 0" 2 "$RC" "glob matched nothing"

# Tracked and gone from the worktree reads as tracked, and there is nothing to
# open — which must not print as a clean run over a corpus nobody read.
doc_saying '# A plan'
rm -f "$R/docs/design/004-plan.md"
run_in "$R"
check "a tracked doc missing from the worktree exits 2" 2 "$RC" "no design doc is readable"

# Outside a git checkout there is no corpus to resolve.
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-knowledge.test.sh"
