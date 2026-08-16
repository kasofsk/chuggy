#!/bin/sh
# A comment may not state a quantity measured from this tree that a reader has
# to trust.
#
# WHY A GATE AND NOT A CONVENTION. The convention was "a figure carries its
# measurement date", and it failed in the ordinary way: the dates were never
# written, the figures went stale in silence, and a single session turned the
# same defect up in a gate header, a sequencer comment, a suite header and the
# routing doc. A date would have saved none of them, because a dated figure is
# still one the reader cannot check without leaving the sentence. What makes a
# figure legitimate is being CHECKABLE, and the ways of being checkable are:
#
#   - THE CODE ACTS ON IT. A cap, a default, a threshold — `${X:-60}` is a
#     value the script reads, not a claim about the tree. Only comment lines
#     are read here, so this one needs no rule of its own.
#   - IT IS DERIVED AT RUN TIME. Every duration this tree prints is
#     interpolated from a variable rather than written down, so it cannot go
#     stale. Also not a comment, so also free.
#   - IT IS A PIN OR A DATE. `0.32.0`, `2026-08-08`. Neither carries a unit,
#     and a numeral with a dot or a dash between digits is skipped below.
#   - THE SENTENCE SHIPS THE PROCEDURE THAT REPRODUCES IT. That is the
#     treatment that replaces a figure instead of dating it: `check-paths.sh`
#     says which flag to flip and what to run rather than how many its own
#     narrowing skips.
#
# WHAT COUNTS AS A QUANTITY. Two shapes, and everything else is skipped in
# SILENCE, because a gate that argues with prose is a gate that gets bypassed:
#
#   Q1  A number bound to a measure — a time unit written onto the numeral
#       (`Ns`, `Nms`), or a measure noun within a word or two after it:
#       seconds and minutes, or lines, files, bytes, tokens and characters.
#   Q2  A number spelled as a word, larger than three. Below that, English is
#       using the number as structure and the sentence carries its own
#       evidence: "one pass", "two counters", "three checks". At and above it,
#       this tree has only ever spelled a number out to report a measurement.
#
# A DURATION IS A MEASUREMENT AT ANY SIZE, so Q1 reads a time unit after a
# number below the floor as well. Below the floor, a number in front of
# `checks` or `counters` is the sentence counting what it has just listed; in
# front of `seconds` it is a figure. The countable nouns get no such treatment
# — `lines` after a small number describes a shape rather than measuring the
# tree, and a count stops being a description only once it passes the floor.
#
# This header is inside the corpus, so it cannot quote the shapes it rejects.
# Naming the noun is what is left, and it is the better sentence anyway.
#
# Q2 IS THE LOAD-BEARING HALF. A noun list catches only the nouns it already
# knows, so on its own it would need an inventory of everything this tree
# contains, kept current — the very thing being banned. Spelling is a property
# of the sentence rather than of the thing counted, so Q2 catches a count of
# anything: witnesses, plugins, comments, gates, rules.
#
# Refutation trigger: Q2's floor is a claim that small numbers here are
# enumeration and larger ones are measurement. A legitimate sentence that must
# spell out a larger number refutes it, and the fix is to look at that
# sentence before touching the floor — every rejection so far has had a rewrite
# that reads better than the original.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes. A
# magnitude with no number — "costs milliseconds" — is invisible, and has to
# be: "a violation costs seconds instead of a rework" is the same shape and is
# honest rhetoric. A dotted numeral reads as a version, so a sub-second
# duration written with a decimal point gets through. A count below the floor
# is deliberate. What is left over is the reviewer's, and
# `.chug/tasks/review-change.md` is where that is written.
#
# SCOPE: tracked `*.md`, `*.sh` and `*.qnt`, the hook and the justfile — the
# files this tree writes prose in. In everything but markdown ONLY COMMENT
# LINES ARE READ, the narrowing `check-paths.sh` makes for a suite and for its
# reason: a figure in code is a value, and a value is not a claim. In markdown
# a fenced block is code, so it is skipped.
#
# THE MODEL IS PROSE. `model/` is the specification, and its `///` headers are
# where this tree argues at length: a count in one of them is a claim about the
# tree exactly as a count in a gate header is, and being proved says nothing
# about the prose wrapped round the proof. Quint's `///` is a comment marker
# like any other, so the comment-line narrowing needs nothing added for it.
#
# THERE IS NO ESCAPE, on `check-paths.sh`'s policy and for its reason. A count
# of things the sentence itself lists does not need the count; a count of
# things it does not list is the defect. The one surface left alone is
# `docs/design/*.md`, because a design doc argues a decision and has to be able
# to cite the measurement that motivated it — dated, and with the command that
# reproduces it. That directory does not exist yet and this is what will be
# waiting when it does.
#
# Usage:
#   .chug/tasks/check-figures.sh [<file>...]
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass —
# and that includes the tool being absent. The whole scan is one awk program,
# so without awk the shell would exit on the missing command with a status this
# header does not claim. The guard is the same one
# `.chug/tasks/check-shell-quoting.sh` carries, for the same reason: an unrun
# gate is not a clean tree.
set -eu
export LC_ALL=C

command -v awk > /dev/null 2>&1 || {
	echo "check-figures: LINTER ERROR — no \`awk\` on PATH, so nothing was scanned."
	exit 2
}

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-figures: LINTER ERROR — not a git checkout, so there is no corpus to read" >&2
	exit 2
fi
cd "$root" || exit 2

# The files to scan: the arguments if given, else the tracked prose corpus. A
# named file is scanned wherever it lives, so the one directory the corpus
# leaves out is reachable without an option to remember.
set -f
if [ "$#" -eq 0 ]; then
	corpus="$(git ls-files '*.md' '*.sh' '*.qnt' '.githooks/pre-commit' 'justfile' \
		':!:docs/design/*' 2>/dev/null || true)"
	if [ -z "$corpus" ]; then
		echo "check-figures: LINTER ERROR — no prose files tracked; the glob matched nothing"
		exit 2
	fi
	IFS='
'
	set -- $corpus
	unset IFS
fi
files=""
for f in "$@"; do
	[ -f "$f" ] || continue
	files="$files$f
"
done
set +f

if [ -z "$files" ]; then
	echo "check-figures: no readable files to scan"
	exit 0
fi

set -f
IFS='
'
set -- $files
unset IFS
set +f

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

awk '
BEGIN {
	split("four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million", word, " ")
	for (i in word) spelled[word[i]] = 1
	split("second seconds minute minutes hour hours millisecond milliseconds", unit, " ")
	for (i in unit) duration[unit[i]] = 1
	split("line lines file files byte bytes token tokens character characters", noun, " ")
	for (i in noun) measure[noun[i]] = 1
	# Below the floor a number is enumeration in front of any noun but a time
	# unit, where it is a measurement at any size.
	split("one two three", low_word, " ")
	for (i in low_word) small[low_word[i]] = 1
	alnum = "0123456789abcdefghijklmnopqrstuvwxyz_"
}
FNR == 1 { md = (FILENAME ~ /\.md$/); fence = 0 }
md && /^[ \t]*(```|~~~)/ { fence = !fence; next }
md && fence { next }
!md && $0 !~ /^[ \t]*(#|\/\/)/ { next }
{
	low = tolower($0)

	# Q1, first half. A unit written onto the numeral. The character before
	# rejects an identifier (`R2`, `v5`) and a dotted version, the character
	# after rejects a longer word (`21st`, `50mm`).
	s = low
	while (match(s, /[0-9]+(ms|ns|us|s|m|h)/)) {
		tok = substr(s, RSTART, RLENGTH)
		before = (RSTART == 1) ? " " : substr(s, RSTART - 1, 1)
		after = substr(s, RSTART + RLENGTH, 1)
		s = substr(s, RSTART + RLENGTH)
		if (index(alnum ".", before) > 0) continue
		if (after != "" && index(alnum, after) > 0) continue
		print "ERROR " FILENAME ":" FNR ": " tok " — a duration a reader has to trust"
	}

	# The rest of the line reads as words. The leading whitespace and comment
	# marker go first, so an ordered list item is recognizable and its leading
	# numeral can be read as the label it is rather than as a count.
	body = low
	sub(/^[ \t]+/, "", body)
	sub(/^(#|\/\/)+[ \t]*/, "", body)
	marker = (body ~ /^[0-9]+[.)][ \t]/)
	n = split(body, w, /[ \t]+/)
	for (i = 1; i <= n; i++) {
		bare = w[i]
		sub(/^[^a-z0-9]+/, "", bare)
		sub(/[^a-z0-9]+$/, "", bare)

		# Q2 reads every alphabetic run inside the word, because a spelled
		# number is a number wherever it sits, and a hyphenated compound
		# spells a number in each half.
		m = split(bare, part, /[^a-z0-9]+/)
		said = 0
		for (k = 1; k <= m && said == 0; k++) {
			if (part[k] in spelled) {
				print "ERROR " FILENAME ":" FNR ": " part[k] " — a spelled quantity a reader has to trust"
				said = 1
			}
		}
		if (said) continue

		# Q1, second half. The number must be the whole word: a quantity is
		# its noun phrase, so `SUITES=0` is a value and `case 4` takes no
		# noun of its own. An adjective may sit between the two.
		if (bare ~ /^[0-9]+$/) counting = 1
		else if (bare in small) counting = 0
		else continue
		if (i == 1 && marker) continue
		for (j = i + 1; j <= i + 2 && j <= n; j++) {
			tail = w[j]
			sub(/^[^a-z0-9]+/, "", tail)
			sub(/[^a-z0-9]+$/, "", tail)
			if (tail in duration || (counting && tail in measure)) {
				print "ERROR " FILENAME ":" FNR ": " bare " " tail " — a measured count a reader has to trust"
				break
			}
		}
	}
}
' "$@" > "$work/findings"

cat "$work/findings"
found="$(grep -c . "$work/findings" || true)"
echo "check-figures: $found finding(s) across $(printf '%s' "$files" | grep -c .) file(s)"
[ "$found" -eq 0 ]
