#!/bin/sh
# The console's TypeScript states no colour; it references a token.
#
# THE RULE: no `.ts` or `.tsx` under `ui/chuggy-ui/app/` writes a literal
# colour — a hex, a colour function (`rgb()`, `rgba()`, `hsl()`, `hsla()`,
# `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`), or a CSS named
# colour used as a style value. A colour is a token, referenced as
# `var(--…)` or as the class a sheet fills from one. The failure it prevents: a
# theme repaints the console by setting tokens, so a literal is a patch of the
# old palette in a themed console, and in the default theme it looks right.
#
# WHERE IT LOOKS. A colour in TypeScript is a value, so only the text of string
# literals is judged: quoted strings, the text of a template literal outside
# its `${}`, and with them every JSX attribute value. Comments are prose and
# code is names, so `this.#face`, `deadbeef` and `0xfff` are silent. A named
# colour is a whole lowercase word of a string, a hyphenated word staying whole,
# so `conversation-waiting-gold`, `whitespace` and the name `Azure` are not
# colours and `red` and `1px solid red` are. The roster is CSS Color Level 4's named colours, the same
# one `check-console-sheets.sh` holds the sheets to. `currentColor`,
# `transparent` and `inherit` name no colour of their own and are not literals.
#
# STANDING EXCEPTIONS, each with its reason:
#   - test files (`*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`),
#     wherever they sit. Their colours are fixtures that set a token and read
#     back what it resolved to, and draw nothing; so do the literals in
#     `ui/chuggy-ui/test/tokenContrast.test.ts` and
#     `ui/chuggy-ui/tools/rendered/harness.spec.ts`, which sit outside the scope
#     besides.
#   - `ui/chuggy-ui/public/manifest.webmanifest`, which is not TypeScript and
#     keeps fixed colours: a manifest is fetched once and cannot follow a theme.
#   - sheets, which are where colours are defined; `check-console-sheets.sh`
#     holds them.
#
# WHAT IT CANNOT SEE. A colour assembled at run time — a hex built from
# numbers, a name read from a variable — and a colour in a data file a module
# loads. The string reader is a lexer, not a parser: a regex literal is told
# from a division by the character before it, and an apostrophe in JSX text
# opens a string to the end of its line. Copy lives in the catalog rather than
# in JSX text, so the second is rare; either can only misread the one line it
# is on. An English sentence in a string that names a colour is read as one,
# and a colour name written with a capital, `Tomato`, is read as a name.
#
# Usage:
#   .chug/tasks/check-console-colours.sh [<file>...]
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-console-colours: LINTER ERROR — not a git checkout, so there is no console to read" >&2
	exit 2
fi
cd "$root" || exit 2

app="ui/chuggy-ui/app"

# The arguments if given, else every tracked module of the console but its
# tests. A named file is scanned wherever it lives.
set -f
if [ "$#" -eq 0 ]; then
	corpus="$(git ls-files "$app/*.ts" "$app/*.tsx" 2>/dev/null |
		grep -Ev '\.(test|spec)\.tsx?$' || true)"
	if [ -z "$corpus" ]; then
		echo "check-console-colours: LINTER ERROR — no tracked TypeScript under $app; the glob read nothing"
		exit 2
	fi
	IFS='
'
	set -- $corpus
	unset IFS
fi
modules=""
for f in "$@"; do
	[ -f "$f" ] || continue
	modules="$modules$f
"
done
set +f

if [ -z "$modules" ]; then
	echo "check-console-colours: no readable module to scan"
	exit 0
fi

set -f
IFS='
'
set -- $modules
unset IFS
set +f

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

awk '
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
	split("return typeof case do else in of void yield await delete instanceof new throw", kw, " ")
	for (i in kw) keyword[kw[i]] = 1
	ident = "0123456789abcdefghijklmnopqrstuvwxyz_$"
	# A slash after one of these begins a regex rather than dividing.
	operator = "(,=:[!&|?{;+-*%<>~^"
	apostrophe = sprintf("%c", 39)
}

# The string text one line carries, judged once the line is read.
function judge(text,    s, tok, n, before, after, w, i) {
	s = tolower(text)
	while (match(s, /#[0-9a-f]+/)) {
		tok = substr(s, RSTART, RLENGTH)
		before = (RSTART == 1) ? " " : substr(s, RSTART - 1, 1)
		after = substr(s, RSTART + RLENGTH, 1)
		s = substr(s, RSTART + RLENGTH)
		n = length(tok) - 1
		if (index(ident "-", before) > 0 || (after != "" && index(ident "-", after) > 0)) continue
		if (n == 3 || n == 4 || n == 6 || n == 8) report(tok)
	}
	s = tolower(text)
	while (match(s, /(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/)) {
		tok = substr(s, RSTART, RLENGTH - 1)
		before = (RSTART == 1) ? " " : substr(s, RSTART - 1, 1)
		s = substr(s, RSTART + RLENGTH)
		if (index(ident "-", before) > 0) continue
		report(tok "()")
	}
	s = text
	n = split(s, w, /[^A-Za-z-]+/)
	for (i = 1; i <= n; i++)
		if (w[i] in colour && index(s, w[i] "(") == 0) report(w[i])
}

function report(tok) {
	print "ERROR " FILENAME ":" FNR ": " tok " — a literal colour; reference a token"
}

FNR == 1 {
	# code, block (comment), template; a quoted string never outlives its line.
	state = "code"
	depth = 0
	held = 0
	prev = ""
	word = ""
}
{
	line = $0
	len = length(line)
	text = ""
	i = 1
	while (i <= len) {
		c = substr(line, i, 1)
		d = substr(line, i + 1, 1)
		if (state == "block") {
			if (c == "*" && d == "/") { state = "code"; i += 2; continue }
			i++
			continue
		}
		if (state == "template") {
			if (c == "\\") { text = text substr(line, i, 2); i += 2; continue }
			if (c == "`") { state = "code"; prev = "`"; word = ""; i++; continue }
			if (c == "$" && d == "{") {
				# The text before an interpolation is judged apart from the text
				# after it, so a value joined across one is not a literal.
				text = text " "
				held++
				resume[held] = depth
				depth++
				state = "code"
				prev = "{"
				word = ""
				i += 2
				continue
			}
			text = text c
			i++
			continue
		}
		# code
		if (c == "/" && d == "/") break
		if (c == "/" && d == "*") { state = "block"; i += 2; continue }
		if (c == "\"" || c == apostrophe) {
			j = i + 1
			while (j <= len) {
				e = substr(line, j, 1)
				if (e == "\\") { j += 2; continue }
				if (e == c) break
				j++
			}
			text = text " " substr(line, i + 1, j - i - 1) " "
			i = j + 1
			prev = c
			word = ""
			continue
		}
		if (c == "`") { state = "template"; text = text " "; i++; continue }
		if (c == "/" && d != ">" && prev != "<" && (prev == "" || index(operator, prev) > 0 || word in keyword)) {
			# A regex literal, skipped whole; it never outlives its line.
			j = i + 1
			class = 0
			while (j <= len) {
				e = substr(line, j, 1)
				if (e == "\\") { j += 2; continue }
				if (e == "[") class = 1
				else if (e == "]") class = 0
				else if (e == "/" && !class) break
				j++
			}
			i = j + 1
			prev = "/"
			word = ""
			continue
		}
		if (c == "{") depth++
		if (c == "}") {
			depth--
			if (held > 0 && depth == resume[held]) {
				held--
				state = "template"
				i++
				continue
			}
		}
		if (c != " " && c != "\t") {
			lc = tolower(c)
			if (index(ident, lc) > 0) word = (index(ident, prev) > 0 ? word : "") lc
			else word = ""
			prev = lc
		}
		i++
	}
	if (text != "") judge(text)
}
' "$@" > "$work/findings"

cat "$work/findings"
found="$(grep -c . "$work/findings" || true)"
echo "check-console-colours: $found finding(s) across $(printf '%s' "$modules" | grep -c .) module(s)"
[ "$found" -eq 0 ]
