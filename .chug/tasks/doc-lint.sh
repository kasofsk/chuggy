#!/bin/sh
# Markdown lint over every tracked `*.md`. Two checks, POSIX sh and awk only,
# so it runs anywhere the repo is checked out:
#
#   1. Well-formedness — headings need a space after the `#`, and code fences
#      must close. ERRORS. Trailing whitespace is a WARNING only.
#   2. Intra-repo links resolve — every relative markdown link `](path)` points
#      at something that exists. Anchors, `http(s)://` and `mailto:` targets are
#      skipped. A dangling relative link is an ERROR.
#
# Whole-tree, not diff-aware: diff selection needs a base ref and a `git fetch`
# to resolve it, and this repo's CI is local-only.
#
# Usage:
#   .chug/tasks/doc-lint.sh [<file>...]
#   .chug/tasks/doc-lint.sh --emit-links [<file>...]
#
# `--emit-links` is rule 2's extractor with the verdict removed: it judges
# nothing and prints `<file><tab><line><tab><target>` for every intra-repo
# relative link, target normalized to a repo-relative path.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "doc-lint: LINTER ERROR — not a git checkout, so there is no tree to lint" >&2
	exit 2
fi
cd "$root" || exit 2

emit_links=0
if [ "${1:-}" = "--emit-links" ]; then
	emit_links=1
	shift
fi

# --- Select the markdown files ----------------------------------------------
files=""
if [ "$#" -gt 0 ]; then
	for f in "$@"; do
		case "$f" in
		*.md) files="$files$f
" ;;
		esac
	done
else
	files="$(git ls-files '*.md' 2>/dev/null || true)
"
fi

# A selected doc can be missing from the worktree — deleted and not yet
# committed, or named by a caller. The filter sits here rather than inside the
# loops so the tally counts what this run read, not what it was handed.
set -f
IFS='
'
readable=""
for f in $files; do
	[ -f "$f" ] || continue
	readable="$readable$f
"
done
unset IFS
set +f

files="$(printf '%s' "$readable" | grep -v '^$' || true)"
if [ -z "$files" ]; then
	[ "$emit_links" -eq 1 ] || echo "doc-lint: no tracked markdown — nothing to lint"
	exit 0
fi

# --- Extract structured records ---------------------------------------------
# ERR:<line>:<msg>   WARN:<line>:<msg>   LINK:<line>:<target>
# Fenced blocks are skipped so their contents are never linted.
extract() {
	awk '
	BEGIN { fence = 0 }
	{
		if ($0 ~ /^[[:space:]]*(```|~~~)/) { fence = !fence; next }
		if (fence) next
		if ($0 ~ /^#+[^ #]/) print "ERR:" NR ":heading needs a space after #"
		if ($0 ~ /[ \t]+$/)  print "WARN:" NR ":trailing whitespace"
		s = $0
		while (match(s, /\]\([^)]+\)/)) {
			print "LINK:" NR ":" substr(s, RSTART + 2, RLENGTH - 3)
			s = substr(s, RSTART + RLENGTH)
		}
	}
	END { if (fence) print "ERR:0:unclosed code fence" }
	' "$1"
}

# The target is joined onto the linking file's directory and `.`/`..` segments
# are collapsed, so the emitted path is the one the rest of the tree calls it
# by. Anchor-only and off-tree targets are dropped.
if [ "$emit_links" -eq 1 ]; then
	IFS='
'
	for f in $files; do
		extract "$f" | awk -v f="$f" -v dir="$(dirname "$f")" '
			function norm(p,   a, n, i, k, o, r) {
				n = split(p, a, "/"); k = 0
				for (i = 1; i <= n; i++) {
					if (a[i] == "" || a[i] == ".") continue
					if (a[i] == "..") { if (k > 0) k--; continue }
					o[++k] = a[i]
				}
				for (i = 1; i <= k; i++) r = r (i > 1 ? "/" : "") o[i]
				return r
			}
			/^LINK:/ {
				rest = substr($0, 6)
				ln = rest; sub(/:.*$/, "", ln)
				t = substr(rest, length(ln) + 2)
				sub(/ .*$/, "", t)
				sub(/#.*$/, "", t)
				if (t == "" || t ~ /:\/\// || t ~ /^(mailto|tel):/ || t ~ /^\//) next
				out = norm(dir "/" t)
				if (out != "") print f "\t" ln "\t" out
			}
		'
	done
	unset IFS
	exit 0
fi

errors=0
warnings=0
report_err()  { echo "ERROR $1"; errors=$((errors + 1)); }
report_warn() { echo "warn  $1"; warnings=$((warnings + 1)); }

IFS='
'
for f in $files; do
	dir="$(dirname "$f")"
	out="$(extract "$f")"
	while IFS= read -r rec; do
		[ -n "$rec" ] || continue
		kind="${rec%%:*}"
		rest="${rec#*:}"
		ln="${rest%%:*}"
		val="${rest#*:}"
		case "$kind" in
		ERR) report_err "$f:$ln: $val" ;;
		WARN) report_warn "$f:$ln: $val" ;;
		LINK)
			target="${val%% *}"    # drop any `"title"` suffix
			target="${target%%#*}" # drop any #anchor
			[ -n "$target" ] || continue
			case "$target" in
			http://* | https://* | ftp://* | mailto:* | tel:* | //* | \#*) continue ;;
			*"://"*) continue ;;
			esac
			[ -e "$dir/$target" ] || report_err "$f:$ln: broken relative link -> $target"
			;;
		esac
	done <<-RECORDS
		$out
	RECORDS
done
unset IFS

echo "doc-lint: $errors error(s), $warnings warning(s) across $(printf '%s\n' "$files" | grep -c .) file(s)"
[ "$errors" -eq 0 ]
