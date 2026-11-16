#!/bin/sh
# Shell test for check-console-colours.sh.
#
# EACH FORM THE HEADER NAMES GETS A PLANTED LITERAL, so a form dropped from the
# scan is a red case rather than a header that claims more than the gate reads.
# THE NEGATIVE CASES ARE THE OTHER HALF: TypeScript is full of names that
# contain a colour or look like hex, and a gate that rejected `this.#face` or a
# class named `…-gold` would be turned off within a week.
#
# Run:  .chug/tasks/check-console-colours.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-console-colours.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"
UI="ui/chuggy-ui/app/browser/ui"

run_in() { # <dir> [<file>...]
	_dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$_dir" && "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

# A console of one module, whose lines the case writes.
module_saying() { # <line>...
	fresh_repo "$R"
	mkdir -p "$R/$UI"
	printf '%s\n' "$@" > "$R/$UI/Pill.tsx"
	git -C "$R" add -A
	run_in "$R"
}

# --- Each literal form is a finding ------------------------------------------

module_saying 'export const pill = { color: "#b3261e" };'
check "a six-digit hex is a finding" 1 "$RC" "Pill.tsx:1: #b3261e — a literal colour"

module_saying "export const pill = { color: '#FFF' };"
check "a three-digit hex in any case is a finding" 1 "$RC" "#fff — a literal colour"

module_saying 'export const pill = <path fill="#b3261ecc" />;'
check "an eight-digit hex in a JSX attribute is a finding" 1 "$RC" "#b3261ecc — a literal colour"

for form in "rgb(20 30 20)" "rgba(20, 30, 20, 0.5)" "hsl(120 40% 50%)" "hsla(120, 40%, 50%, 1)" \
	"oklch(0.7 0.1 150)" "oklab(0.7 0.1 0.1)" "color(display-p3 1 0 0)"; do
	module_saying "export const pill = { background: \"$form\" };"
	check "${form%%(*}() is a finding" 1 "$RC" "${form%%(*}() — a literal colour"
done

module_saying 'export const pill = { color: "white" };'
check "a named colour as a style value is a finding" 1 "$RC" "white — a literal colour"

module_saying 'export const pill = { border: "1px solid rebeccapurple" };'
check "a named colour inside a shorthand is a finding" 1 "$RC" "rebeccapurple — a literal colour"

module_saying 'export const pill = <circle fill="Tomato" />;'
check "a named colour in a JSX attribute is a finding" 1 "$RC" "tomato — a literal colour"

module_saying 'export const pill = (n: number) => `${n}px solid #b3261e`;'
check "a hex in a template literal is a finding" 1 "$RC" "#b3261e — a literal colour"

module_saying 'export const pill = `' '  color: red;' '`;'
check "a template literal carries to the lines after it" 1 "$RC" "Pill.tsx:2: red — a literal colour"

# A division read as a regex would skip to the next slash, and the string
# between them with it.
module_saying 'export const pill = (n: number) => ({ width: n / 2, color: "#b3261e", height: n / 4 });'
check "a division does not hide the string after it" 1 "$RC" "#b3261e — a literal colour"

# ONE ROSTER, TWO GATES. The sheets' gate's is held to CSS's list by
# `test/scripts/consolePolicy.test.ts`; this one is held to the sheets' gate's.
roster() { sed -n '/split("aliceblue/,/name, " ")/p' "$1"; }
OUT="$WORK/.out"
set +e
roster "$HERE/check-console-sheets.sh" > "$WORK/.sheets"
roster "$SUT" > "$WORK/.modules"
if [ -s "$WORK/.sheets" ] && cmp -s "$WORK/.sheets" "$WORK/.modules"; then RC=0; else RC=1; fi
set -e
echo "roster compared" > "$OUT"
check "the named colours are the roster the sheets' gate states" 0 "$RC" "roster compared"

# --- The shapes it must stay silent on ---------------------------------------

module_saying 'export const pill = { color: "var(--ink-1)", background: "var(--surface-0)" };' \
	'export const mark = <path className="locomotive-body" />;'
check "a token reference is silent" 0 "$RC" "0 finding(s)"

module_saying 'export const pill = <path className="conversation-waiting-gold" />;' \
	'export const wrap = { whiteSpace: "nowrap", redraw: "redrawn", label: "goldenrods" };'
check "a word that merely contains a colour name is silent" 0 "$RC" "0 finding(s)"

module_saying 'export class Pill {' '  #face = 0xfade;' '  #add() { return this.#face; }' '}' \
	'export const deadbeef = 1;' 'export const anchor = "/tickets#add-ticket";'
check "a hex-looking identifier is silent" 0 "$RC" "0 finding(s)"

module_saying '// drawn in "#b3261e" until a token names it' '/* "red", and' '   still "white" */' \
	'export const pill = { color: "currentColor", background: "transparent" };' \
	'export const red = (n: number) => n / 2;' "export const tan = /\"#fff\"|'red'/;"
check "comments, code names, keywords and regex literals are silent" 0 "$RC" "0 finding(s)"

module_saying 'export const pill = (tone: string) => `var(--tone-${tone})`;' \
	'export const issue = (n: number) => `#${n}fff`;'
check "a value joined across an interpolation is not a literal" 0 "$RC" "0 finding(s)"

# --- Scope -------------------------------------------------------------------

# THE SUCCESS LINE REPORTS WHAT THE RUN READ: two modules, and the test beside
# them that the scope leaves out.
fresh_repo "$R"
mkdir -p "$R/$UI"
printf '%s\n' 'export const pill = { color: "var(--ink-1)" };' > "$R/$UI/Pill.tsx"
printf '%s\n' 'export const tone = "var(--ink-2)";' > "$R/$UI/tone.ts"
printf '%s\n' 'expect(read()).toBe("rgb(21, 26, 23)");' 'const fill = "#151a17";' > "$R/$UI/Pill.test.tsx"
printf '%s\n' 'const fill = "#151a17";' > "$R/$UI/Pill.spec.ts"
git -C "$R" add -A
run_in "$R"
check "a test file is excepted, and the line counts what was read" 0 "$RC" "0 finding(s) across 2 module(s)"

# Sheets are where colours are defined; a module outside the console is not
# the console's.
fresh_repo "$R"
mkdir -p "$R/$UI" "$R/src"
printf '%s\n' 'export const pill = { color: "var(--ink-1)" };' > "$R/$UI/Pill.tsx"
printf '%s\n' '.pill { color: #b3261e; }' > "$R/$UI/Pill.css"
printf '%s\n' 'export const fill = "#b3261e";' > "$R/src/fill.ts"
git -C "$R" add -A
run_in "$R"
check "a sheet and a module outside the console are out of scope" 0 "$RC" "across 1 module(s)"

# Naming a file scans it wherever it lives.
fresh_repo "$R"
mkdir -p "$R/$UI"
printf '%s\n' 'export const pill = { color: "var(--ink-1)" };' > "$R/$UI/Pill.tsx"
printf '%s\n' 'const fill = "#151a17";' > "$R/$UI/Pill.test.tsx"
git -C "$R" add -A
run_in "$R" "$UI/Pill.test.tsx"
check "a named file is scanned wherever it lives" 1 "$RC" "#151a17 — a literal colour"

# --- Could not run -----------------------------------------------------------

# A tree with no console module is not a clean console: the glob read nothing.
fresh_repo "$R"
printf '%s\n' 'x' > "$R/README"
git -C "$R" add -A
run_in "$R"
check "no console module exits 2, not 0" 2 "$RC" "the glob read nothing"

run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

done_ "check-console-colours.test.sh"
