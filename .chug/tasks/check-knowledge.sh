#!/bin/sh
# A design doc holds only what the tree does not yet carry.
#
# WHY. Every other rule in this tree is stated in the thing that enforces it, so
# changing the enforcement changes the statement. A design doc has no enforcer,
# so it only accretes — this one outgrew every other prose file in the tree put
# together, most of it restating decisions the code, the gates and their suites
# had already landed, and knowing what was true meant reading a head, a body and
# a stack of corrections that partly superseded each other. Once the tree
# carries a decision, the statement lives in the enforcer and the doc's copy is
# a second version of itself waiting to happen.
#
# WHAT IS DECIDABLE. Not "is this claim carried yet" — that is the reviewer's,
# and a gate that guessed at it would be noise, and a noisy gate gets bypassed.
# Two consequences of the rule are mechanical, and both are shapes this tree
# actually grew:
#
#   C1  NO `## Correction` SECTION, at any heading level. A correction is
#       written after the thing it corrects has landed, so what it says is
#       already fixed in the code, the gates and the suites; what is left over
#       is one session's confusion, paid for by every later reader. The body is
#       editable — CLAUDE.md says so — so a correction always has somewhere
#       better to go: into the head, or nowhere.
#   C2  A LANDED ROW IS A POINTER, NOT AN ARGUMENT. In a table, a row carrying
#       a cell that says Landed and nothing else may carry no sentence
#       punctuation in any of its cells — no full stop, no semicolon. A label,
#       a dependency list and a commit pointer have neither; a contract
#       restated after the commit that satisfied it has both.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes. A
# clause with no terminator reads as a label and gets through. A row whose
# status is spelled some other way is not recognised as landed, and is not
# judged. Prose outside a table row is invisible entirely: a section arguing for
# work that landed last week is a reviewer's finding and never this gate's.
# That is the trade — it catches the two shapes that accreted here without ever
# arguing with a sentence.
#
# SCOPE: tracked `docs/design/*.md`, whole-directory rather than diff-aware,
# because that corpus is one directory and selecting part of it would cost more
# than reading all of it. It is also the only directory this gate reads, for the
# same reason `check-figures.sh` and `check-paths.sh` are the ones that carve it
# out: it is where this tree writes in the future tense, and the rule is about
# what happens when that tense expires.
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

# A glob that matches nothing is a verdict about nothing, and this tree's other
# corpus gates say so rather than passing.
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
# commit pointer, a path and an identifier all carry punctuation that is not a
# sentence, and none of it is prose.
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
