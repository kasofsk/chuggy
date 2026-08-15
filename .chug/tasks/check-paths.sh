#!/bin/sh
# A path this tree names must be a path this tree has.
#
# WHOLE TREE, EVERY FILE TYPE, and that is the point. Prose about paths lives
# in shell headers, model comments and markdown alike, and the failures that
# motivated this gate were spread across all three: two gate headers cited
# proof scripts belonging to another repo, and seven model comments cited
# documents this tree had deleted. A markdown-only check would have caught
# none of them, and the one class markdown tooling does cover — a relative
# link — `doc-lint.sh` already resolves.
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
# code is full of paths that are real somewhere else — twenty of them in this
# tree's own suites, against zero true findings. What a suite says about THIS
# repo it says in its header, which is also where both motivating failures
# lived, so the narrowing costs the gate nothing it was built to catch.
#
# SKIPPED, deliberately: a glob or a placeholder, a token a glob character
# immediately follows, a shell variable, a bracketed template, an absolute or
# home-relative path, a URL, an elision, and any token whose first segment
# neither is nor ever was ours. A `package.json` dependency spelled with a
# scope is skipped by that last one and needs no rule of its own.
#
# THE ESCAPE IS ONE MARKER, `<!-- absent -->`, anywhere on the line, covering
# that line only. It reads naturally in markdown and survives inside a comment
# in every other file type, so there is one spelling to learn rather than one
# per language. A path that is simply stale is an edit, not a marker.
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
FNR == 1 { comments_only = (FILENAME ~ /\.test\.sh$/) }
{
	# A line with no slash cannot carry a path, and most lines have none. The
	# test is one index() against a match loop whose dynamic pattern is
	# recompiled per call: on this tree it is the difference between 3s and
	# well under 1s, nearly all of it in the model.
	if (index($0, "/") == 0) next
	if (index($0, "<!-- absent -->") > 0) next
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
		print FILENAME ":" FNR ":" t
	}
}
' "$@" > "$work/candidates"

# What this tree has deleted, asked ONCE. R2 needs "was this ever ours", and
# asking git per token costs a process per token — three seconds on this tree,
# nearly all of it spent proving that `and/or` and `read/write` are not paths.
# One history dump answers every token in memory instead.
#
# Refutation trigger: this walks the whole history, so it grows with the log
# rather than the tree. If it ever dominates the gate, narrow it to the range
# since the last tag.
git log --diff-filter=D --name-only --format= 2>/dev/null | sort -u > "$work/deleted" || true

# Resolution in one pass over the three lists, because a grep per token is a
# process per token: the same work took eighteen seconds spelled that way.
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
	print "MISS\t" loc "\t" tok "\t" first
}
' "$work/deleted" "$work/tracked" "$work/candidates" > "$work/verdicts"

findings=0
claims=0
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
	esac
done < "$work/verdicts"

echo "check-paths: $findings finding(s) across $claims path claim(s) in $(printf '%s' "$files" | grep -c .) file(s)"
[ "$findings" -eq 0 ]
