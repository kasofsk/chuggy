#!/bin/sh
# A design doc holds only what the tree does not yet carry.
#
# WHAT IS DECIDABLE. Not "is this claim carried yet" — that is the reviewer's.
# Two consequences of the rule are mechanical:
#
#   C1  NO `## Correction` SECTION, at any heading level. What a correction
#       says is already fixed in the code, the gates and the suites, and the
#       body is editable — CLAUDE.md says so — so it has somewhere better to
#       go: into the head, or nowhere.
#   C2  A LANDED ROW IS A POINTER, NOT AN ARGUMENT. In a table, a row carrying
#       a cell that says Landed and nothing else may carry no sentence
#       punctuation in any of its cells — no full stop, no semicolon. A label,
#       a dependency list and a commit pointer have neither; a contract
#       restated after the commit that satisfied it has both.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes. A
# clause with no terminator reads as a label and gets through. A row whose
# status is spelled some other way is not recognised as landed. Prose outside a
# table row is invisible entirely, and stays the reviewer's.
#
# SCOPE: tracked `docs/design/*.md`, whole-directory. It is the only directory
# this gate reads, for the reason `check-figures.sh` and `check-paths.sh` carve
# it out too: it is where this tree writes in the future tense.
#
# Usage:
#   .chug/tasks/check-knowledge.sh
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-knowledge: LINTER ERROR — not a git checkout, so there is no corpus to read" >&2
	exit 2
fi
cd "$root" || exit 2

# A glob that matches nothing is a verdict about nothing.
docs="$(git ls-files 'docs/design/*.md' 2>/dev/null || true)"
if [ -z "$docs" ]; then
	echo "check-knowledge: LINTER ERROR — no tracked docs/design/*.md; the glob matched nothing"
	exit 2
fi

set -f
IFS='
'
set -- $docs
unset IFS
set +f

# A tracked doc can be absent from the worktree — deleted and not yet committed
# — and there is nothing to read when it is.
present=""
for d in "$@"; do
	[ -f "$d" ] && present="$present$d
"
done
if [ -z "$present" ]; then
	echo "check-knowledge: LINTER ERROR — no design doc is readable in the worktree"
	exit 2
fi

set -f
IFS='
'
set -- $present
unset IFS
set +f

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

awk '
FNR == 1 { docs_read++ }

# C1. Any heading whose first word is Correction, at any level.
/^#+[ \t]/ {
	headings++
	head = $0
	sub(/^#+[ \t]+/, "", head)
	if (tolower(head) ~ /^correction([^a-z]|$)/)
		print "ERROR " FILENAME ":" FNR ": a Correction section — the tree carries what it corrects, so edit the head instead"
	next
}

# C2. A table row. The outer pipes are dropped before the split so an empty
# leading cell is not invented, and every backticked span goes with them: a
# commit pointer, a path and an identifier carry punctuation that is not prose.
/^[ \t]*\|/ {
	row = $0
	sub(/^[ \t]*\|/, "", row)
	sub(/\|[ \t]*$/, "", row)
	n = split(row, cell, /\|/)

	landed = 0
	for (i = 1; i <= n; i++) {
		bare = cell[i]
		gsub(/`[^`]*`/, "", bare)
		gsub(/[^A-Za-z]/, "", bare)
		if (tolower(bare) == "landed") landed = 1
	}
	if (!landed) next
	rows++

	for (i = 1; i <= n; i++) {
		bare = cell[i]
		gsub(/`[^`]*`/, "", bare)
		if (index(bare, ";") > 0 || bare ~ /[A-Za-z0-9]\.([ \t]|$)/) {
			print "ERROR " FILENAME ":" FNR ": a landed row states its argument; keep the pointer and let the tree carry the rest"
			break
		}
	}
}

END { print "TALLY " rows + 0 " " headings + 0 " " docs_read + 0 }
' "$@" > "$work/out"

grep -v '^TALLY ' "$work/out" || true
findings="$(grep -c '^ERROR ' "$work/out" || true)"
set -f
# shellcheck disable=SC2046 # the tally is three fields this script wrote itself
set -- $(sed -n 's/^TALLY //p' "$work/out")
set +f
echo "check-knowledge: $findings finding(s) across $1 landed row(s) and $2 heading(s) in $3 design doc(s)"
[ "$findings" -eq 0 ]
