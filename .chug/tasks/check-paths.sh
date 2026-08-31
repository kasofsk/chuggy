#!/bin/sh
# A path this tree names must be a path this tree has.
#
# WHOLE TREE, EVERY FILE TYPE. Prose about paths lives in shell headers, model
# comments and markdown alike; the one class markdown tooling covers, a
# relative link, `doc-lint.sh` already resolves.
#
# WHAT COUNTS AS A CLAIM. A token with a slash in it, and then only under one
# of two positive rules. Everything else is skipped in SILENCE:
#
#   R1  Its first segment is a tracked top-level entry of this repo, so the
#       token is claiming a path here and the path must resolve — as a tracked
#       file, or as a directory with any tracked file beneath it.
#   R1b A token written with a leading `./` is relative to something, and which
#       is not decidable from the text: a module names its neighbour, a script
#       that has cd'd to the root names the root. So it resolves against the
#       directory of the file that writes it OR against the root, and is a
#       finding only when it resolves against neither.
#   R2  Its first segment is NOT tracked now, but the token or that segment was
#       tracked at some point in this history. The tree deleted it and the
#       sentence did not notice. Asking git what it ever had separates some
#       other repo's path from our own deleted one, and needs no list of
#       tombstones for anyone to maintain.
#
# IN A `*.test.sh`, ONLY COMMENT LINES ARE READ. A suite builds fixture trees in
# a throwaway repo, so its code is full of paths that are real somewhere else;
# what a suite says about THIS repo it says in its header.
#
# SKIPPED, deliberately: a glob or a placeholder, a token a glob character
# immediately follows, a shell variable, a bracketed template, an absolute or
# home-relative path, a URL, an elision, and any token whose first segment
# neither is nor ever was ours.
#
# THERE IS ONE EXEMPTION, IT COVERS ONE DIRECTORY, AND IT SUPPRESSES NOTHING:
# `docs/design/*.md`, on a line carrying one of CLAUDE.md's claim markers —
# `<!-- intent -->`, `<!-- runtime -->`, `<!-- absent -->`. The path is still
# resolved and still reported; it prints as `intent` rather than `ERROR` and is
# counted separately in the tally, so a design doc naming a directory nobody
# ever built says so on every run. A design doc is the one place in this tree
# that writes in the future tense, which is why `check-figures.sh` carves out
# the same directory.
#
# What is still forbidden everywhere, this directory included, is an UNMARKED
# claim — and naming a *specific* deleted file exactly, since neither skip
# above applies to one.
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

# The arguments if given, else every tracked file. A named file that is not
# tracked is still scanned.
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
# below is git's. The filters are index tests rather than regexes so no awk has
# to agree with another about escaping inside a character class.
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
	# A line with no slash cannot carry a path, and most lines have none.
	if (index($0, "/") == 0) next
	if (comments_only && $0 !~ /^[ \t]*#/) next
	s = $0
	while (match(s, "[A-Za-z0-9_.@-]+/[A-Za-z0-9_.@/-]*")) {
		t = substr(s, RSTART, RLENGTH)
		after = substr(s, RSTART + RLENGTH, 1)
		s = substr(s, RSTART + RLENGTH)
		# A glob or a template immediately after the match means the match is
		# the leading literal of a pattern, not a path.
		if (index("*?{[<$", after) > 0 && after != "") continue
		# A leading `./` says the token is relative to something, and which is
		# not lexical: a module names its neighbour, a script that has changed
		# to the root names the root. The directory holding the file goes out
		# beside the token so the resolver can try both.
		here = ""
		if (substr(t, 1, 2) == "./") {
			here = FILENAME
			if (!sub(/\/[^\/]*$/, "", here)) here = "."
			sub(/^\.\//, "", t)
		}
		while (length(t) > 0 && index(".,;:)", substr(t, length(t), 1)) > 0) {
			t = substr(t, 1, length(t) - 1)
		}
		if (index(t, "/") == 0) continue
		if (junk(t)) continue
		# The verdict still runs on a marked line; only its severity changes.
		marked = (design && $0 ~ /<!-- *(intent|runtime|absent) *-->/)
		print FILENAME ":" FNR ":" t ":" (marked ? "MARKED" : "PLAIN") ":" here
	}
}
' "$@" > "$work/candidates"

# What this tree has deleted, asked ONCE: R2 needs "was this ever ours", and a
# git call per token is a process per token. One history dump answers them all
# in memory.
git log --diff-filter=D --name-only --format= 2>/dev/null | sort -u > "$work/deleted" || true

# Resolution in one pass over the three lists.
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
	here = $5
	first = tok
	sub(/\/.*$/, "", first)
	bare = tok
	sub(/\/$/, "", bare)
	if (here != "" && here != ".") {
		near = here "/" bare
		if (near in path || (near "/") in dir) { print "OK"; next }
	}
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
