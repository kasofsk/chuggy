#!/bin/sh
# Markdown lint over every tracked `*.md`. Three checks, no external tooling —
# POSIX sh + awk only, so it runs anywhere the repo is checked out:
#
#   1. Well-formedness — headings need a space after the `#`, and code fences
#      must close. ERRORS. Trailing whitespace is a WARNING only.
#   2. Intra-repo links resolve — every relative markdown link `](path)` points
#      at something that exists. Anchors, `http(s)://` and `mailto:` targets are
#      skipped. A dangling relative link is an ERROR.
#   3. Design filenames — each `docs/design/*.md` is named
#      `{seq}-{slug}.md`: leading digits, a hyphen, then a lowercase-kebab slug.
#      The directory does not exist today and this rule is what will be waiting
#      when it does.
#      ERROR. The match anchors on the repo-relative path, so a path merely
#      *ending* in `docs/design/*.md` is some other repo's file, and a nested
#      subdirectory is out of scope. Its character classes are spelled out
#      rather than written as `a-z` ranges: range membership in shell patterns
#      follows the locale's collation order, so under en_US.UTF-8 `a-z` also
#      spans the uppercase letters and the rule would quietly stop rejecting
#      them. Same reason LC_ALL=C is pinned below — the verdict must be the
#      same on every host.
#
# WHOLE-TREE, NOT DIFF-AWARE, deliberately. Diff selection needs a base ref and
# a `git fetch` to resolve it; under this repo's local-only CI there is no base
# ref to read, so every run would take the fall-back path and print a
# degradation notice about a degradation that is simply the normal case — and a
# notice that prints every time is read by nobody. Whole-tree over a corpus this
# size costs milliseconds, needs no network, and cannot report a stale verdict.
# Re-introduce diff scoping when the corpus makes it worth the machinery, not
# before.
#
# Usage:
#   .chug/tasks/doc-lint.sh [<file>...]
#   .chug/tasks/doc-lint.sh --emit-links [<file>...]
#
# `--emit-links` is rule 2's extractor with the verdict removed: it judges
# nothing and prints `<file><tab><line><tab><target>` for every intra-repo
# relative link, target normalized to a repo-relative path. It exists so the
# deferred orphan check asks rule 2 "what does this doc link to" rather than
# growing a second answer to the same question.
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

files="$(printf '%s' "$files" | grep -v '^$' || true)"
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
# are collapsed, so a doc linking `../reference/style.md` emits the path the
# rest of the tree calls it by. Anchor-only and off-tree targets are dropped.
if [ "$emit_links" -eq 1 ]; then
	IFS='
'
	for f in $files; do
		[ -f "$f" ] || continue
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
	[ -f "$f" ] || continue # a deleted doc can be named explicitly but has no content
	case "$f" in
	docs/design/*/*) : ;; # a nested subdirectory is not a design doc
	docs/design/*.md)
		base="${f##*/}"
		seq="${base%%-*}"
		slug="${base#*-}"
		slug="${slug%.md}"
		name_ok=1
		case "$seq" in
		"" | *[!0123456789]*) name_ok=0 ;;
		esac
		case "$slug" in
		*[!abcdefghijklmnopqrstuvwxyz0123456789-]*) name_ok=0 ;;
		esac
		[ "$name_ok" -eq 1 ] \
			|| report_err "$f: design doc filename must be {seq}-{slug}.md, e.g. 001-nomad-fabric.md"
		;;
	esac
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
