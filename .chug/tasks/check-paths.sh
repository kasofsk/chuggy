#!/bin/sh
# A path this tree names must be a path this tree has.
#
# WHOLE TREE, EVERY FILE TYPE, and that is the point. Prose about paths lives
# in shell headers, model comments and markdown alike, and the failures that
# motivated this gate were spread across all three: gate headers citing proof
# scripts belonging to another repo, and model comments citing documents this
# tree had deleted. A markdown-only check would have caught none of them, and
# the one class markdown tooling does cover — a relative link — `doc-lint.sh`
# already resolves.
#
# WHAT COUNTS AS A CLAIM. A token with a slash in it, and then only under one
# of two positive rules. Everything else is skipped in SILENCE, because a gate
# that argues with prose is a gate that gets bypassed:
#
#   R1  Its first segment is a tracked top-level entry of this repo, so the
#       token is claiming a path here and the path must resolve — as a tracked
#       file, or as a directory with any tracked file beneath it.
#   R2  Its first segment is NOT tracked now, but the token or that segment was
#       tracked at some point in this history. The tree deleted it and the
#       sentence did not notice.
#
# R2 is what makes a deleted directory visible. Under R1 alone, deleting a
# whole top-level directory would delete the gate's interest in every reference
# to it — the references would stop being claims about this tree at the exact
# moment they stopped being true. Asking git whether a path ever existed
# separates some other repo's path from our own deleted one, and it needs no
# list of tombstones for anyone to maintain.
#
# IN A `*.test.sh`, ONLY COMMENT LINES ARE READ, and that narrowing is measured
# rather than assumed. A suite builds fixture trees in a throwaway repo, so its
# code is full of paths that are real somewhere else, and each one reads as a
# claim about here. To re-measure: set `comments_only` to 0 below and run this
# gate over `git ls-files '*.test.sh'`. Every finding that then appears is a
# fixture path, and none of them is a claim this tree makes. What a suite says
# about THIS repo it says in its header, which is also where both motivating
# failures lived, so the narrowing costs the gate nothing it was built to catch.
#
# Refutation trigger: the narrowing rests on that second half, never on how many
# the first half produces. One finding among them that is a true claim about
# this tree ends the case for reading only comments.
#
# SKIPPED, deliberately: a glob or a placeholder, a token a glob character
# immediately follows, a shell variable, a bracketed template, an absolute or
# home-relative path, a URL, an elision, and any token whose first segment
# neither is nor ever was ours. A `package.json` dependency spelled with a
# scope is skipped by that last one and needs no rule of its own.
#
# THERE IS ONE EXEMPTION, IT COVERS ONE DIRECTORY, AND IT SUPPRESSES NOTHING.
# Everywhere else a line this gate rejects is fixed by editing the sentence,
# because every rejection so far has had a rewrite that reads better than the
# original: a directory is named without its trailing slash, a rule about files
# is stated as the glob it actually matches, and both are skipped above without
# needing an exemption.
#
# The exception is `docs/design/*.md`, on a line carrying one of CLAUDE.md's
# claim markers — `<!-- intent -->`, `<!-- runtime -->`, `<!-- absent -->`. The
# path is still resolved and still reported; it prints as `intent` rather than
# `ERROR` and is counted separately in the tally. Nothing is hidden, so the
# marker cannot rot into the unused suppression marker this gate tried once and
# removed: a design doc naming a directory nobody ever built says so on every
# run, in a line and a count a reviewer reads without asking for it.
#
# WHY IT WAS NEEDED, since the policy above was previously absolute. A design
# doc is the one place in this tree that writes in the future tense, which is
# why `check-figures.sh` already exempts exactly this directory for exactly
# this reason — a doc arguing a decision has to be able to name what it is
# proposing. That was invisible here for as long as the proposal was about
# directories the gate could not see: it judges a token only when the token's
# first segment is, or once was, tracked, so a plan for `src/` was outside its
# scope while `src/` did not exist. The commit that created `src/domain/` put
# every other row of that plan's target table inside it at once, and turned a
# document arguing for a shape into a document making false claims. The
# alternatives were worse in the ways this repo already rejects: a plan that
# may only name what already exists is not a plan, and a directory tracked with
# a placeholder so a path resolves is a tree lying to its own gate.
#
# What is still forbidden everywhere, this directory included, is an UNMARKED
# claim — and naming a *specific* deleted file exactly, since neither skip
# above applies to one. Reach for a marker rather than `--no-verify`, which
# bypasses every gate at once.
#
# Usage:
#   .chug/tasks/check-paths.sh [<file>...]
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-paths: LINTER ERROR — not a git checkout, so there is nothing to resolve against" >&2
	exit 2
fi
cd "$root" || exit 2

tracked="$(git ls-files 2>/dev/null || true)"
if [ -z "$tracked" ]; then
	echo "check-paths: LINTER ERROR — no tracked files, so the scan would judge nothing"
	exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$tracked" > "$work/tracked"

# The files to scan: the arguments if given, else every tracked file. A named
# file that is not tracked is still scanned — an author asking about a file
# they have not added yet should get the answer, not silence.
set -f
if [ "$#" -eq 0 ]; then
	IFS='
'
	set -- $tracked
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
	echo "check-paths: no readable files to scan"
	exit 0
fi

set -f
IFS='
'
set -- $files
unset IFS
set +f

# Candidate tokens as `<file>:<line>:<token>`. Purely lexical — every verdict
# below is git's. The filters are index tests rather than regexes so that no
# awk has to agree with another about escaping inside a character class.
awk '
function junk(t,   i, c) {
	c = "*?{}<>$()|\\`\"'"'"' "
	for (i = 1; i <= length(c); i++) if (index(t, substr(c, i, 1)) > 0) return 1
	if (index(t, "..") > 0) return 1
	if (index(t, "://") > 0) return 1
	if (index(t, "…") > 0) return 1
	c = substr(t, 1, 1)
	return (c == "~" || c == "-")
}
FNR == 1 {
	comments_only = (FILENAME ~ /\.test\.sh$/)
	design = (FILENAME ~ /(^|\/)docs\/design\/[^\/]+\.md$/)
}
{
	# A line with no slash cannot carry a path, and most lines have none. The
	# test is one index() against a match loop whose dynamic pattern is
	# recompiled per call, and dropping it measured far slower on this tree,
	# nearly all of the difference in the model.
	if (index($0, "/") == 0) next
	if (comments_only && $0 !~ /^[ \t]*#/) next
	s = $0
	while (match(s, "[A-Za-z0-9_.@-]+/[A-Za-z0-9_.@/-]*")) {
		t = substr(s, RSTART, RLENGTH)
		after = substr(s, RSTART + RLENGTH, 1)
		s = substr(s, RSTART + RLENGTH)
		# A glob or a template immediately after the match means the match is
		# the leading literal of a pattern, not a path: the `.chug/tasks/` cut
		# out of a `.chug/tasks/*.sh` case arm is a claim nobody made.
		if (index("*?{[<$", after) > 0 && after != "") continue
		sub(/^\.\//, "", t)
		while (length(t) > 0 && index(".,;:)", substr(t, length(t), 1)) > 0) {
			t = substr(t, 1, length(t) - 1)
		}
		if (index(t, "/") == 0) continue
		if (junk(t)) continue
		# A design doc writes in the future tense, and a marked line says so.
		# The verdict still runs; only its severity changes, and the tally
		# below prints how many there are so an intent nobody acted on is
		# visible rather than suppressed.
		marked = (design && $0 ~ /<!-- *(intent|runtime|absent) *-->/)
		print FILENAME ":" FNR ":" t ":" (marked ? "MARKED" : "PLAIN")
	}
}
' "$@" > "$work/candidates"

# What this tree has deleted, asked ONCE. R2 needs "was this ever ours", and
# asking git per token costs a process per token, which measured far slower on
# this tree — nearly all of it spent proving that `and/or` and `read/write` are
# not paths. One history dump answers every token in memory instead.
#
# Refutation trigger: this walks the whole history, so it grows with the log
# rather than the tree. If it ever dominates the gate, narrow it to the range
# since the last tag.
git log --diff-filter=D --name-only --format= 2>/dev/null | sort -u > "$work/deleted" || true

# Resolution in one pass over the three lists, because a grep per token is a
# process per token, and the same work measured slower still spelled that way.
#   OK    — resolved, counted as a claim
#   MISS  — first segment is ours and the path is not
#   GONE  — first segment is not ours now, but this tree used to have it
awk -F: -v tf="$work/tracked" -v df="$work/deleted" '
FILENAME == df {
	gone[$0] = 1
	n = split($0, part, "/")
	gonetop[part[1]] = 1
	next
}
FILENAME == tf {
	path[$0] = 1
	n = split($0, part, "/")
	top[part[1]] = 1
	acc = ""
	for (i = 1; i < n; i++) {
		acc = acc part[i] "/"
		dir[acc] = 1
	}
	next
}
{
	loc = $1 ":" $2
	tok = $3
	marked = ($4 == "MARKED")
	first = tok
	sub(/\/.*$/, "", first)
	bare = tok
	sub(/\/$/, "", bare)
	if (!(first in top)) {
		if (!(first in gonetop)) next
		print (bare in gone ? "GONE" : "UNDER") "\t" loc "\t" tok "\t" first
		next
	}
	if (tok in path || bare in path || (bare "/") in dir) { print "OK"; next }
	print (marked ? "INTENT" : "MISS") "\t" loc "\t" tok "\t" first
}
' "$work/deleted" "$work/tracked" "$work/candidates" > "$work/verdicts"

findings=0
claims=0
intents=0
while IFS="$(printf '\t')" read -r kind loc tok seg; do
	case "$kind" in
	OK)
		claims=$((claims + 1))
		;;
	MISS)
		claims=$((claims + 1))
		echo "ERROR $loc: $tok — no such path; \`$seg\` is ours, so this names something here"
		findings=$((findings + 1))
		;;
	GONE)
		claims=$((claims + 1))
		echo "ERROR $loc: $tok — deleted from this tree, and this line still names it"
		findings=$((findings + 1))
		;;
	UNDER)
		claims=$((claims + 1))
		echo "ERROR $loc: $tok — under \`$seg\`, which this tree deleted"
		findings=$((findings + 1))
		;;
	INTENT)
		claims=$((claims + 1))
		intents=$((intents + 1))
		echo "intent $loc: $tok — designed, not built"
		;;
	esac
done < "$work/verdicts"

printf 'check-paths: %s finding(s)' "$findings"
[ "$intents" -eq 0 ] || printf ', %s marked as intent' "$intents"
printf ' across %s path claim(s) in %s file(s)\n' "$claims" "$(printf '%s' "$files" | grep -c .)"
[ "$findings" -eq 0 ]
