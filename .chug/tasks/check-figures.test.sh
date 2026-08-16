#!/bin/sh
# Shell test for check-figures.sh.
#
# THE NEGATIVE CASES ARE THE POINT OF THIS SUITE. A gate that only ever says
# no has not been shown to be scoped to what it names, and this one refuses a
# shape that legitimate prose is full of — numbers. So every allowed kind of
# figure gets a case proving the gate stays silent on it: a threshold, a
# version pin, a date, a run-time derivation, a small enumeration, an ordered
# list, a fenced block.
#
# Fixtures are built with printf rather than a heredoc on purpose. A heredoc
# body carrying a `#` would be a comment line in THIS file, and the gate reads
# comment lines — the suite would then reject itself.
#
# Run:  .chug/tasks/check-figures.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-figures.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"

run_in() { # <dir> [<file>...]
	_dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$_dir" && "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

gate_saying() { # <comment line>...
	fresh_repo "$R"
	{
		printf '%s\n' '#!/bin/sh'
		printf '# %s\n' "$@"
		printf '%s\n' 'exit 0'
	} > "$R/gate.sh"
	git -C "$R" add -A
	run_in "$R"
}

doc_saying() { # <prose line>...
	fresh_repo "$R"
	printf '%s\n' "$@" > "$R/NOTES.md"
	git -C "$R" add -A
	run_in "$R"
}

# --- The shapes it must catch ------------------------------------------------

# 1. A duration with its unit written onto the numeral.
gate_saying 'the model run is ~50s, so it goes last.'
check "a duration in a comment is a finding" 1 "$RC" "50s — a duration"

# 2. A number spelled out above the floor.
gate_saying 'this makes the convention a rule, in fifteen lines.'
check "a spelled quantity is a finding" 1 "$RC" "fifteen — a spelled quantity"

# 3. A numeral taking a measure noun, with an adjective between them.
gate_saying 'the scan covers 39 tracked files.'
check "a numeral with its measure noun is a finding" 1 "$RC" "39 files — a measured count"

# 4. A DURATION IS A MEASUREMENT AT ANY SIZE. Below the floor a number is
#    enumeration everywhere else, but never in front of a time unit.
gate_saying 'asking git per token costs three seconds on this tree.'
check "a small spelled duration is a finding" 1 "$RC" "three seconds — a measured count"

# 5. Markdown is prose throughout — there is no comment marker to hide behind.
doc_saying 'It enables the eight plugins listed elsewhere.'
check "a figure in markdown is a finding" 1 "$RC" "eight — a spelled quantity"

# --- The shapes it must stay silent on ---------------------------------------

# 6. A pin, a date, and a threshold the code reads. None is a claim about the
#    tree, and each is checkable where it stands.
gate_saying 'quint 0.32.0 is pinned. jscpd v5, dash 0.5 and bash 5.2 diverge,' \
	'measured 2026-08-08. The per-suite cap defaults to 60.'
check "pins, dates and thresholds are silent" 0 "$RC" "0 finding(s)"

# 7. Only comment lines are read, so a figure in code is a value rather than a
#    claim — which is what makes a run-time derivation free.
fresh_repo "$R"
printf '%s\n' '#!/bin/sh' 'msg="took fifty seconds, about 50s"' > "$R/gate.sh"
git -C "$R" add -A
run_in "$R"
check "a figure in code is not a claim" 0 "$RC" "0 finding(s)"

# 8. A small number counting what the sentence has just listed.
gate_saying 'a check helper, a temp dir, a trap, two counters. Three checks, one pass.'
check "a small enumeration is silent" 0 "$RC" "0 finding(s)"

# 9. THE ORDERED LIST. Its leading numeral is a label, and the noun that
#    follows belongs to the sentence rather than to the number.
doc_saying '2. Read the files it touches in full, not just the hunks.'
check "an ordered list marker is silent" 0 "$RC" "0 finding(s)"

# 10. A fenced block is code, wherever it is quoted from.
doc_saying 'Before:' '```sh' '# the model run is ~50s and fifteen lines long' '```'
check "a fenced block is silent" 0 "$RC" "0 finding(s)"

# 11. A small number in front of a countable noun describes a shape rather
#     than measuring the tree.
gate_saying 'the two lines after it bind inside the if.'
check "a small count of a countable noun is silent" 0 "$RC" "0 finding(s)"

# --- Scope -------------------------------------------------------------------

# 12. `model/` is out of the default corpus and reachable by naming it. The
#     deferral has to be visible, or it is indistinguishable from a clean tree.
fresh_repo "$R"
mkdir -p "$R/model"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$R/gate.sh"
printf '%s\n' '/// the eight witness modules' > "$R/model/domain.qnt"
git -C "$R" add -A
run_in "$R"
check "model is out of the default corpus" 0 "$RC" "0 finding(s)"
run_in "$R" model/domain.qnt
check "naming a model file scans it" 1 "$RC" "eight — a spelled quantity"

# 13. A design doc may carry a measurement, dated and reproducible, so the
#     directory is left alone. It does not exist yet; this is what will be
#     waiting when it does.
fresh_repo "$R"
mkdir -p "$R/docs/design"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$R/gate.sh"
printf '%s\n' 'Measured at fifty seconds, 2026-08-08.' > "$R/docs/design/001-x.md"
git -C "$R" add -A
run_in "$R"
check "a design doc is out of the default corpus" 0 "$RC" "0 finding(s)"

# 14. A path with a space in it is scanned like any other. The corpus is split
#     on newlines for exactly this reason.
fresh_repo "$R"
printf '%s\n' 'It ran in fifteen lines.' > "$R/a note.md"
git -C "$R" add -A
run_in "$R"
check "a path with a space is scanned" 1 "$RC" "a note.md"

# --- Could not run -----------------------------------------------------------

# 15. A corpus that matched nothing is not a clean tree.
fresh_repo "$R"
printf '%s\n' '{}' > "$R/package.json"
git -C "$R" add -A
run_in "$R"
check "an empty corpus exits 2, not 0" 2 "$RC" "glob matched nothing"

# 16. Outside a git checkout there is nothing to read.
run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-figures.test.sh"
