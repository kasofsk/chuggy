#!/bin/sh
# Nothing outside `ui/chuggy-ui/app/styles/tokens.css` states a raw colour or a
# raw length.
#
# THE FAILURE IT PREVENTS is the one the console's pre-system sheet already
# had: a page-local colour that holds in one theme and not the other, and a
# second "small" size a hair off the first. Every colour is defined once for
# both themes behind `light-dark()`, so a page that states its own is a page
# that goes wrong when the theme flips — and no reader of the sheet can see
# that it will.
#
# WHAT IS A RAW COLOUR: a hex, a colour function — `rgb()`, `hsl()`, `lab()`,
# `oklch()` and their family — or a colour English has a name for. Keywords
# that name no colour of their own are not raw: `currentColor`, `transparent`
# and `inherit` all resolve to something a token chose.
#
# WHAT IS A RAW LENGTH: a number written in `px` or `rem`, which are the units
# the type and space scales are stated in and so the units a page can be a hair
# off the scale in. `0` and `1px` are the exceptions, because a zero names no
# step of any scale and a hairline is the one length a browser rounds for you.
#
# `em`, `%`, `ch`, `vh` AND `fr` ARE NOT LENGTHS THIS CAN JUDGE, and are
# skipped in silence. Each is a ratio to something the element already has — its
# own type size, its parent, the viewport, the grid — so it cannot be a step of
# a scale that is a hair off another step. This is narrower than the design
# document's own phrasing, and deliberately: the mark inside a pill is half the
# height of the word beside it, and that is a fact about the pill rather than a
# size anyone could name once.
#
# A BREAKPOINT IS A SIZE A MEDIA QUERY CANNOT READ FROM A CUSTOM PROPERTY, so
# the widths are named in the token file's header instead and this holds the
# sheets to them: a `min-width` or `max-width` naming a width that is not one
# of those is a fourth breakpoint, which is exactly the drift the rule is
# about.
#
# SCOPE: tracked `*.css` under `ui/chuggy-ui/app/`, less two files. The token
# file is where a colour and a length are stated, so it is the definition site
# rather than a violation of itself. `ui/chuggy-ui/app/styles.css` is the sheet
# the console drew before the design system: it is being deleted a page at a
# time rather than tokenised, and naming it here is what makes the exemption
# visible — when the last page leaves it and the file goes, this line stops
# resolving and `check-paths.sh` says so.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes. A
# colour reached through a variable this tree does not define is invisible, and
# so is one written into a data URI. An `em` given to `font-size` escapes the
# type scale and reads as legitimate here; that one is the reviewer's. An id
# selector spelled entirely in hex digits reads as a colour and would be a
# false finding — no sheet here has one, and the report names the token so a
# reader can see which it was.
#
# Usage:
#   .chug/tasks/check-console-tokens.sh [<file>...]
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-console-tokens: LINTER ERROR — not a git checkout, so there are no sheets to read" >&2
	exit 2
fi
cd "$root" || exit 2

tokens="ui/chuggy-ui/app/styles/tokens.css"
legacy="ui/chuggy-ui/app/styles.css"

if ! git ls-files --error-unmatch "$tokens" >/dev/null 2>&1; then
	echo "check-console-tokens: LINTER ERROR — no $tokens, so there is no definition site to hold the sheets to"
	exit 2
fi

# The arguments if given, else every tracked sheet of the console but the two
# the scope leaves out. A named file is scanned wherever it lives.
set -f
if [ "$#" -eq 0 ]; then
	corpus="$(git ls-files 'ui/chuggy-ui/app/*.css' 'ui/chuggy-ui/app/**/*.css' \
		":!:$tokens" ":!:$legacy" 2>/dev/null || true)"
	if [ -z "$corpus" ]; then
		echo "check-console-tokens: LINTER ERROR — no sheet under ui/chuggy-ui/app/ but the two the scope leaves out; the glob matched nothing"
		exit 2
	fi
	IFS='
'
	set -- $corpus
	unset IFS
fi
sheets=""
for f in "$@"; do
	[ -f "$f" ] || continue
	sheets="$sheets$f
"
done
set +f

if [ -z "$sheets" ]; then
	echo "check-console-tokens: no readable sheet to scan"
	exit 0
fi

set -f
IFS='
'
set -- $sheets
unset IFS
set +f

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

awk '
BEGIN {
	split("black white red green blue yellow orange purple pink brown gray grey silver navy teal olive maroon lime aqua cyan magenta fuchsia gold ivory beige khaki coral salmon crimson indigo violet turquoise", name, " ")
	for (i in name) colour[name[i]] = 1
	split("40em 60em 80em", width, " ")
	for (i in width) breakpoint[width[i]] = 1
	alnum = "0123456789abcdefghijklmnopqrstuvwxyz_-"
}
FNR == 1 { open_comment = 0 }
{
	# The comments come out first, and an unterminated one carries to the next
	# line: a colour named in prose is prose.
	rest = $0
	code = ""
	while (length(rest) > 0) {
		if (open_comment) {
			at = index(rest, "*/")
			if (at == 0) { rest = ""; break }
			rest = substr(rest, at + 2)
			open_comment = 0
			continue
		}
		at = index(rest, "/*")
		if (at == 0) { code = code rest; rest = ""; break }
		code = code substr(rest, 1, at - 1)
		rest = substr(rest, at + 2)
		open_comment = 1
	}
	low = tolower(code)

	s = low
	while (match(s, /#[0-9a-f]+/)) {
		tok = substr(s, RSTART, RLENGTH)
		s = substr(s, RSTART + RLENGTH)
		n = length(tok) - 1
		if (n == 3 || n == 4 || n == 6 || n == 8)
			print "ERROR " FILENAME ":" FNR ": " tok " — a raw colour, and a colour is stated once in tokens.css"
	}

	s = low
	while (match(s, /(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/)) {
		tok = substr(s, RSTART, RLENGTH - 1)
		before = (RSTART == 1) ? " " : substr(s, RSTART - 1, 1)
		s = substr(s, RSTART + RLENGTH)
		if (index(alnum, before) > 0) continue
		print "ERROR " FILENAME ":" FNR ": " tok "() — a raw colour, and a colour is stated once in tokens.css"
	}

	s = low
	while (match(s, /[0-9]+(\.[0-9]+)?(px|rem)/)) {
		tok = substr(s, RSTART, RLENGTH)
		before = (RSTART == 1) ? " " : substr(s, RSTART - 1, 1)
		after = substr(s, RSTART + RLENGTH, 1)
		s = substr(s, RSTART + RLENGTH)
		if (index(alnum ".", before) > 0) continue
		if (after != "" && index(alnum, after) > 0) continue
		if (tok == "1px") continue
		print "ERROR " FILENAME ":" FNR ": " tok " — a raw length, and a length is stated once in tokens.css"
	}

	# A word of English for a colour, in what is left of the line. The property
	# half is read too, because no property here is named for a colour.
	n = split(low, w, /[^a-z-]+/)
	for (i = 1; i <= n; i++)
		if (w[i] in colour)
			print "ERROR " FILENAME ":" FNR ": " w[i] " — a raw colour, and a colour is stated once in tokens.css"

	if (low ~ /@media/) {
		s = low
		while (match(s, /(min|max)-width:[ \t]*[^),]+/)) {
			tok = substr(s, RSTART, RLENGTH)
			s = substr(s, RSTART + RLENGTH)
			sub(/^(min|max)-width:[ \t]*/, "", tok)
			sub(/[ \t]+$/, "", tok)
			if (!(tok in breakpoint))
				print "ERROR " FILENAME ":" FNR ": " tok " — a fourth breakpoint; the widths are the ones named in tokens.css"
		}
	}
}
' "$@" > "$work/findings"

cat "$work/findings"
found="$(grep -c . "$work/findings" || true)"
echo "check-console-tokens: $found finding(s) across $(printf '%s' "$sheets" | grep -c .) sheet(s)"
[ "$found" -eq 0 ]
