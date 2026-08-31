#!/bin/sh
# Shell test for check-console-sheets.sh.
#
# THE NEGATIVE CASES ARE HALF OF IT. This gate reads every sheet of the console
# for shapes legitimate CSS is also full of — a word that begins a property
# name, a length in a unit that is a ratio, a function whose name is also a
# colour — so each allowed shape gets a case proving the gate stays silent on
# it. A gate that also rejected `white-space` would be turned off within a
# week.
#
# THE LAYER CLAUSE GETS THE DEFECT IT WAS WRITTEN FOR: a sheet whose layer
# closes early, leaving its last rules unlayered and beating every layered rule
# in the console. Prettier accepts it and the bundler ships it, which is why
# the case is here rather than in a reviewer's memory.
#
# Each fixture carries the token file, because a tree without one is a
# could-not-run rather than a clean tree, and the case would pass for the wrong
# reason.
#
# Run:  .chug/tasks/check-console-sheets.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-console-sheets.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"
SHEETS="ui/chuggy-ui/app/browser/ui"
TOKENS="ui/chuggy-ui/app/styles/tokens.css"

run_in() { # <dir> [<file>...]
	_dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$_dir" && "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

# A console with its token file and one primitive sheet, whose rules the case
# writes inside the sheet's own layer.
sheet_saying() { # <line>...
	fresh_repo "$R"
	mkdir -p "$R/$SHEETS" "$R/ui/chuggy-ui/app/styles"
	printf '%s\n' '@layer tokens { :root { --ink-1: light-dark(#151a17, #eef2ee); --space-2: 0.5rem; } }' \
		> "$R/$TOKENS"
	{
		printf '%s\n' '@layer ui {'
		printf '  %s\n' "$@"
		printf '%s\n' '}'
	} > "$R/$SHEETS/Pill.css"
	git -C "$R" add -A
	run_in "$R"
}

# The same console, with the sheet written verbatim: a case about where a rule
# sits cannot have the harness put it inside a layer.
sheet_verbatim() { # <line>...
	fresh_repo "$R"
	mkdir -p "$R/$SHEETS" "$R/ui/chuggy-ui/app/styles"
	printf '%s\n' '@layer tokens { :root { --ink-1: light-dark(#151a17, #eef2ee); } }' > "$R/$TOKENS"
	printf '%s\n' "$@" > "$R/$SHEETS/Pill.css"
	git -C "$R" add -A
	run_in "$R"
}

# --- Clause 1: the values a sheet may state ----------------------------------

sheet_saying '.pill { color: #b3261e; }'
check "a hex is a finding" 1 "$RC" "#b3261e — a raw colour"

sheet_saying '.pill { background: rgb(20 30 20); }'
check "a colour function is a finding" 1 "$RC" "rgb() — a raw colour"

sheet_saying '.pill { background: oklch(0.7 0.1 150); }'
check "a colour function of the newer family is a finding" 1 "$RC" "oklch() — a raw colour"

sheet_saying '.pill { color: white; }'
check "a colour English has a name for is a finding" 1 "$RC" "white — a raw colour"

# THE ROSTER IS THE WHOLE CSS LIST, not the dozen names anyone would think of
# first. A gate whose header says "a colour English has a name for" and whose
# roster stops at the primaries reads as working while the rest get through.
sheet_saying '.pill { color: lavender; }' '.pill-mark { background: peru; }' \
	'.pill-emphasis { border-color: rebeccapurple; }'
check "a colour outside the obvious names is a finding too" 1 "$RC" "lavender — a raw colour"
check "and so is each of the others in the same sheet" 1 "$RC" "rebeccapurple — a raw colour"

sheet_saying '.pill { padding: 0.75rem; }'
check "a rem is a finding" 1 "$RC" "0.75rem — a raw length"

sheet_saying '.pill { padding: 12px; }'
check "a px that is not a hairline is a finding" 1 "$RC" "12px — a raw length"

# A SIGN IS PART OF A LENGTH. Reading `-` as an identifier character is how a
# negative margin walks past a gate that catches every positive one.
sheet_saying '.pill { margin-left: -8px; }'
check "a negative px is a finding" 1 "$RC" "-8px — a raw length"

sheet_saying '.pill { margin-top: -1.5rem; }'
check "a negative rem is a finding" 1 "$RC" "-1.5rem — a raw length"

sheet_saying '.pill { margin-bottom: -1px; }'
check "a negative hairline is not the hairline" 1 "$RC" "-1px — a raw length"

# A ZERO IS A ZERO IN ANY UNIT, and the header says so: a reader who writes
# `margin: 0px` expecting it to pass is reading the rule correctly.
sheet_saying '.pill { margin: 0px; padding: 0rem; top: -0px; }'
check "a zero is exempt whatever unit it is written in" 0 "$RC" "0 finding(s)"

sheet_saying '@media (min-width: 52em) { .pill { padding: 0; } }'
check "a width no token names is a finding" 1 "$RC" "52em — a fourth breakpoint"

# --- Clause 1: the shapes it must stay silent on -----------------------------

sheet_saying '.pill { white-space: nowrap; border: 1px solid currentColor; }' \
	'.pill-mark { width: 0.5em; height: 0.85em; border-radius: 50%; }' \
	'.pill-quiet { padding: 0; background: transparent; color: inherit; }'
check "a property name, a hairline, a zero and a ratio are silent" 0 "$RC" "0 finding(s)"

# `tan` is a colour and a trigonometric function, and the bracket is what
# tells them apart.
sheet_saying '.pill { rotate: calc(1rad * tan(0.5)); }'
check "a function whose name is a colour is silent" 0 "$RC" "0 finding(s)"

sheet_saying '.pill { color: var(--ink-1); padding: var(--space-2); }' \
	'@media (min-width: 60em) { .pill { padding: 0; } }'
check "a token and a named width are silent" 0 "$RC" "0 finding(s)"

sheet_saying '/* the wall is drawn in #b3261e until a token names it */' \
	'.pill { color: var(--ink-1); }'
check "a colour named in a comment is prose" 0 "$RC" "0 finding(s)"

# A comment that runs across lines takes its whole body with it.
sheet_saying '/* red, and' 'still 12px of comment */' '.pill { color: var(--ink-1); }'
check "a comment carries to the line after it" 0 "$RC" "0 finding(s)"

# --- Clause 2: where a rule sits ---------------------------------------------

sheet_verbatim '@layer ui {' '  .pill {' '    color: var(--ink-1);' '  }' '}'
check "a sheet whose rules are inside its layer is clean" 0 "$RC" "0 finding(s)"

# The defect the clause exists for: the layer closes early and the rules after
# it beat every layered rule in the console.
sheet_verbatim '@layer ui {' '  .pill {' '    color: var(--ink-1);' '  }' '}' \
	'' '.pill-inline.pill-live {' '  color: var(--ink-2);' '}'
check "a rule after the layer closes is a finding" 1 "$RC" ".pill-inline.pill-live — a rule outside the layer"

sheet_verbatim '.pill {' '  color: var(--ink-1);' '}'
check "a sheet with no layer at all is a finding" 1 "$RC" ".pill — a rule outside the layer"

# A media query at the top level is unlayered too, and reads as ordinary CSS.
sheet_verbatim '@media (min-width: 60em) {' '  .pill {' '    padding: 0;' '  }' '}'
check "an at-rule that is not a layer is a finding" 1 "$RC" "@media (min-width: 60em) — a rule outside the layer"

# THE ALLOWLIST IS PINNED BY CASE, NOT BY READING. Every at-rule below wraps
# rules, so a fifth name added to the allowlist takes a whole block outside
# every layer — and a suite whose only negative was the media query would let
# that through.
sheet_verbatim '@supports (display: grid) {' '  .pill {' '    padding: 0;' '  }' '}'
check "a supports block outside a layer is a finding" 1 "$RC" "@supports (display: grid) — a rule outside the layer"

sheet_verbatim '@container (min-width: 60em) {' '  .pill {' '    padding: 0;' '  }' '}'
check "a container query outside a layer is a finding" 1 "$RC" "@container (min-width: 60em) — a rule outside the layer"

sheet_verbatim '@keyframes pill-pulse {' '  0% {' '    opacity: 1;' '  }' '}'
check "keyframes outside a layer is a finding" 1 "$RC" "@keyframes pill-pulse — a rule outside the layer"

sheet_verbatim '@font-face {' '  font-family: Chuggy;' '}'
check "a font face outside a layer is a finding" 1 "$RC" "@font-face — a rule outside the layer"

# The at-rules that may lead a sheet, and the statement that orders the layers.
sheet_verbatim '@charset "utf-8";' '@layer tokens, base, ui, page;' \
	'@layer ui {' '  .pill {' '    color: var(--ink-1);' '  }' '}'
check "a charset and a layer statement may lead a sheet" 0 "$RC" "0 finding(s)"

# --- Scope -------------------------------------------------------------------

# THE SUCCESS LINE REPORTS WHAT THE RUN READ. The fixture has the token file
# and one sheet, and both are in the corpus.
sheet_saying '.pill { color: var(--ink-1); }'
check "the clean line counts the sheets it read" 0 "$RC" "across 2 sheet(s)"

# The definition site states colours and lengths; that is what it is for, and
# clause 2 still reads it.
sheet_saying '.pill { color: var(--ink-1); }'
check "the token file's own values are not judged" 0 "$RC" "0 finding(s)"

fresh_repo "$R"
mkdir -p "$R/$SHEETS" "$R/ui/chuggy-ui/app/styles"
printf '%s\n' '.leaked { color: #151a17; }' > "$R/$TOKENS"
printf '%s\n' '@layer ui { .pill { color: var(--ink-1); } }' > "$R/$SHEETS/Pill.css"
git -C "$R" add -A
run_in "$R"
check "the token file's rules must still be in a layer" 1 "$RC" ".leaked — a rule outside the layer"

# The sheet the console drew before the design system is being deleted rather
# than tokenised, and is out of both clauses for exactly as long as it exists.
fresh_repo "$R"
mkdir -p "$R/$SHEETS" "$R/ui/chuggy-ui/app/styles"
printf '%s\n' '@layer tokens { :root { --ink-1: light-dark(#151a17, #eef2ee); } }' > "$R/$TOKENS"
printf '%s\n' '.badge { color: #e3b341; padding: 0.15rem; }' > "$R/ui/chuggy-ui/app/styles.css"
printf '%s\n' '@layer ui { .pill { color: var(--ink-1); } }' > "$R/$SHEETS/Pill.css"
git -C "$R" add -A
run_in "$R"
check "the pre-system sheet is out of the corpus" 0 "$RC" "across 2 sheet(s)"

# --- Could not run -----------------------------------------------------------

# No definition site is not a clean tree: the rule has nothing to point at.
fresh_repo "$R"
mkdir -p "$R/$SHEETS"
printf '%s\n' '@layer ui { .pill { color: var(--ink-1); } }' > "$R/$SHEETS/Pill.css"
git -C "$R" add -A
run_in "$R"
check "no token file exits 2, not 0" 2 "$RC" "no definition site"

# Naming a file scans it wherever it lives, which is what keeps the exemption
# from being a place to hide a colour.
fresh_repo "$R"
mkdir -p "$R/ui/chuggy-ui/app/styles"
printf '%s\n' '@layer tokens { :root { --ink-1: light-dark(#151a17, #eef2ee); } }' > "$R/$TOKENS"
printf '%s\n' '.badge { color: #e3b341; }' > "$R/ui/chuggy-ui/app/styles.css"
git -C "$R" add -A
run_in "$R" ui/chuggy-ui/app/styles.css
check "a named file is scanned wherever it lives" 1 "$RC" "#e3b341 — a raw colour"

run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

done_ "check-console-sheets.test.sh"
