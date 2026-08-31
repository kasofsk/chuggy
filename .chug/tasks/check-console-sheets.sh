#!/bin/sh
# A console sheet states its values once, and states its rules inside its
# layer.
#
# Two clauses over one corpus, because they are two halves of the same thing:
# what a sheet may say, and where what it says takes effect.
#
# CLAUSE 1 — NOTHING OUTSIDE `ui/chuggy-ui/app/styles/tokens.css` STATES A RAW
# COLOUR OR A RAW LENGTH. The failure it prevents is the one the console's
# pre-system sheet already had: a page-local colour that holds in one theme and
# not the other, and a second "small" size a hair off the first. Every colour
# is defined once for both themes behind `light-dark()`, so a page that states
# its own is a page that goes wrong when the theme flips — and no reader of the
# sheet can see that it will.
#
#   A RAW COLOUR is a hex, a colour function — `rgb()`, `hsl()`, `lab()`,
#   `oklch()` and their family — or one of CSS Color Level 4's named colours,
#   the roster below, taken from the `color-name` package this tree already
#   installs and sorted. Keywords that name no colour of their own are not
#   raw: `currentColor`, `transparent` and `inherit` all resolve to something a
#   token chose.
#
#   A RAW LENGTH is a number written in `px` or `rem` — the units the type and
#   space scales are stated in, and so the units a page can be a hair off the
#   scale in — with or without a sign. `0` and `1px` are the exceptions,
#   because a zero names no step of any scale and a hairline is the one length
#   a browser rounds for you. NO OTHER UNIT IS JUDGED, and each is skipped in
#   silence: `em`, `ch` and `%` are ratios to something the element already has
#   — its own type, its parent — so they cannot be a step that is a hair off
#   another step; `vh`, `vw` and `fr` are ratios to the viewport and the grid;
#   `pt`, `cm` and the rest of the absolute units are not written here at all,
#   and the clause would rather miss one than pretend to a roster of units it
#   has never seen.
#
#   A BREAKPOINT IS A LENGTH A MEDIA QUERY CANNOT READ FROM A CUSTOM PROPERTY,
#   so the widths are named in the token file's header instead and this holds
#   the sheets to them: a `min-width` or `max-width` naming a width that is not
#   one of those is a fourth breakpoint, which is exactly the drift the clause
#   is about.
#
# CLAUSE 2 — EVERY RULE SITS INSIDE THE LAYER ITS SHEET DECLARES. A rule
# outside every layer beats every layered rule, whatever its specificity, so
# one closing brace in the wrong place silently promotes part of a primitive
# over the whole system and nothing about the sheet looks wrong. Prettier
# formats it, the bundler ships it, and the page it breaks is a page nobody has
# opened yet. At the top level of a sheet only `@layer`, `@charset`, `@import`
# and `@namespace` may appear; everything else belongs under a layer.
#
# SCOPE: tracked `*.css` under `ui/chuggy-ui/app/`, less two files. The token
# file is where a colour and a length are stated, so clause 1 does not judge
# it — clause 2 does. `ui/chuggy-ui/app/styles.css` is out of both: it is the
# sheet the console drew before the design system, it is unlayered on purpose
# while it lives, and it is being deleted a page at a time rather than
# tokenised. Naming it here is what makes the exemption visible — when the last
# page leaves it and the file goes, this line stops resolving and
# `check-paths.sh` says so.
#
# WHAT IT CANNOT SEE, said plainly so nobody trusts it further than it goes. A
# colour reached through a variable this tree does not define is invisible, and
# so is one written into a data URI. An `em` given to `font-size` escapes the
# type scale and reads as legitimate here; that one is the reviewer's. Which
# layer a sheet declares is not judged — that a primitive declares `ui` and a
# page `page` is the reviewer's, and the order the layers end up in is
# `scripts/console-policy.ts`, over the stylesheet the build emits. An id
# selector spelled entirely in hex digits reads as a colour and would be a
# false finding; no sheet here has one, and the report names the token so a
# reader can see which it was. A colour named twice on one line, once as the
# function of the same name, is read as the function both times. A brace inside
# a string would take the layer scan with it; no sheet here writes one.
#
# Usage:
#   .chug/tasks/check-console-sheets.sh [<file>...]
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-console-sheets: LINTER ERROR — not a git checkout, so there are no sheets to read" >&2
	exit 2
fi
cd "$root" || exit 2

tokens="ui/chuggy-ui/app/styles/tokens.css"
legacy="ui/chuggy-ui/app/styles.css"

if ! git ls-files --error-unmatch "$tokens" >/dev/null 2>&1; then
	echo "check-console-sheets: LINTER ERROR — no $tokens, so there is no definition site to hold the sheets to"
	exit 2
fi

# The arguments if given, else every tracked sheet of the console but the one
# the scope leaves out. A named file is scanned wherever it lives.
set -f
if [ "$#" -eq 0 ]; then
	corpus="$(git ls-files 'ui/chuggy-ui/app/*.css' 'ui/chuggy-ui/app/**/*.css' \
		":!:$legacy" 2>/dev/null || true)"
	if [ -z "$corpus" ]; then
		echo "check-console-sheets: LINTER ERROR — the corpus is empty though $tokens is tracked; the glob read nothing"
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
	echo "check-console-sheets: no readable sheet to scan"
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

awk -v tokens="$tokens" '
BEGIN {
	split("aliceblue antiquewhite aqua aquamarine azure beige bisque black " \
		"blanchedalmond blue blueviolet brown burlywood cadetblue " \
		"chartreuse chocolate coral cornflowerblue cornsilk crimson cyan " \
		"darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " \
		"darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " \
		"darksalmon darkseagreen darkslateblue darkslategray darkslategrey " \
		"darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey " \
		"dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " \
		"ghostwhite gold goldenrod gray green greenyellow grey honeydew " \
		"hotpink indianred indigo ivory khaki lavender lavenderblush " \
		"lawngreen lemonchiffon lightblue lightcoral lightcyan " \
		"lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " \
		"lightsalmon lightseagreen lightskyblue lightslategray " \
		"lightslategrey lightsteelblue lightyellow lime limegreen linen " \
		"magenta maroon mediumaquamarine mediumblue mediumorchid " \
		"mediumpurple mediumseagreen mediumslateblue mediumspringgreen " \
		"mediumturquoise mediumvioletred midnightblue mintcream mistyrose " \
		"moccasin navajowhite navy oldlace olive olivedrab orange orangered " \
		"orchid palegoldenrod palegreen paleturquoise palevioletred " \
		"papayawhip peachpuff peru pink plum powderblue purple " \
		"rebeccapurple red rosybrown royalblue saddlebrown salmon " \
		"sandybrown seagreen seashell sienna silver skyblue slateblue " \
		"slategray slategrey snow springgreen steelblue tan teal thistle " \
		"tomato turquoise violet wheat white whitesmoke yellow yellowgreen", \
		name, " ")
	for (i in name) colour[name[i]] = 1
	split("40em 60em 80em", width, " ")
	for (i in width) breakpoint[width[i]] = 1
	# The colour scans read the character before a match to reject an
	# identifier; the length scan does not, because a sign is part of a length.
	ident = "0123456789abcdefghijklmnopqrstuvwxyz_-"
	unsigned = "0123456789abcdefghijklmnopqrstuvwxyz_."
}
FNR == 1 {
	open_comment = 0
	depth = 0
	# The name as the corpus lists it, so naming the token file on the command
	# line reaches the same verdict as the default scan does.
	named = FILENAME
	sub(/^\.\//, "", named)
	values = (named != tokens)
}
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

	# CLAUSE 2, decided on the depth this line opens at, before its own braces
	# move it.
	bare = low
	gsub(/[ \t]+/, "", bare)
	trimmed = low
	sub(/^[ \t]+/, "", trimmed)
	sub(/[ \t]*\{.*$/, "", trimmed)
	sub(/[ \t]+$/, "", trimmed)
	if (depth == 0 && bare != "" && bare != "}" &&
		trimmed !~ /^@(layer|charset|import|namespace)([ \t{;]|$)/)
		print "ERROR " FILENAME ":" FNR ": " trimmed " — a rule outside the layer this sheet declares"
	opened = gsub(/\{/, "{", low)
	closed = gsub(/\}/, "}", low)
	depth += opened - closed
	if (depth < 0) depth = 0

	if (!values) next

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
		if (index(ident, before) > 0) continue
		print "ERROR " FILENAME ":" FNR ": " tok "() — a raw colour, and a colour is stated once in tokens.css"
	}

	# A SIGN IS PART OF A LENGTH, so the character before a number is read
	# against a class that has no `-` in it: a negative margin is a raw length
	# like any other, and reading `-` as an identifier character is how one
	# gets through.
	s = low
	while (match(s, /[0-9]+(\.[0-9]+)?(px|rem)/)) {
		tok = substr(s, RSTART, RLENGTH)
		before = (RSTART == 1) ? " " : substr(s, RSTART - 1, 1)
		after = substr(s, RSTART + RLENGTH, 1)
		s = substr(s, RSTART + RLENGTH)
		if (index(unsigned, before) > 0) continue
		if (after != "" && index(ident, after) > 0) continue
		if (before == "-") tok = "-" tok
		if (tok == "1px") continue
		print "ERROR " FILENAME ":" FNR ": " tok " — a raw length, and a length is stated once in tokens.css"
	}

	# A word of English for a colour, in what is left of the line. A hyphenated
	# identifier stays whole, so `white-space` is a property and not a colour,
	# and a name a bracket follows is a function rather than a value.
	n = split(low, w, /[^a-z-]+/)
	for (i = 1; i <= n; i++)
		if (w[i] in colour && index(low, w[i] "(") == 0)
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
echo "check-console-sheets: $found finding(s) across $(printf '%s' "$sheets" | grep -c .) sheet(s)"
[ "$found" -eq 0 ]
