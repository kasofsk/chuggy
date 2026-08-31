#!/bin/sh
# Shell test for check-console-tokens.sh.
#
# THE NEGATIVE CASES ARE HALF OF IT. This gate reads every sheet of the console
# for two shapes that legitimate CSS is also full of — a word that begins a
# property name, a length in a unit that is a ratio — so each allowed shape
# gets a case proving the gate stays silent on it. A gate that also rejected
# `white-space` would be turned off within a week.
#
# Each fixture carries the token file, because a tree without one is a
# could-not-run rather than a clean tree, and the case would pass for the wrong
# reason.
#
# Run:  .chug/tasks/check-console-tokens.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-console-tokens.sh"
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

# A console with its token file and one primitive sheet saying what the case
# is about.
sheet_saying() { # <line>...
	fresh_repo "$R"
	mkdir -p "$R/$SHEETS" "$R/ui/chuggy-ui/app/styles"
	printf '%s\n' ':root { --ink-1: light-dark(#151a17, #eef2ee); --space-2: 0.5rem; }' \
		> "$R/$TOKENS"
	{
		printf '%s\n' '@layer ui {'
		printf '  %s\n' "$@"
		printf '%s\n' '}'
	} > "$R/$SHEETS/Pill.css"
	git -C "$R" add -A
	run_in "$R"
}

# --- The shapes it must catch ------------------------------------------------

sheet_saying '.pill { color: #b3261e; }'
check "a hex is a finding" 1 "$RC" "#b3261e — a raw colour"

sheet_saying '.pill { background: rgb(20 30 20); }'
check "a colour function is a finding" 1 "$RC" "rgb() — a raw colour"

sheet_saying '.pill { background: oklch(0.7 0.1 150); }'
check "a colour function of the newer family is a finding" 1 "$RC" "oklch() — a raw colour"

sheet_saying '.pill { color: white; }'
check "a colour English has a name for is a finding" 1 "$RC" "white — a raw colour"

sheet_saying '.pill { padding: 0.75rem; }'
check "a rem is a finding" 1 "$RC" "0.75rem — a raw length"

sheet_saying '.pill { padding: 12px; }'
check "a px that is not a hairline is a finding" 1 "$RC" "12px — a raw length"

sheet_saying '@media (min-width: 52em) { .pill { padding: 0; } }'
check "a width no token names is a finding" 1 "$RC" "52em — a fourth breakpoint"

# --- The shapes it must stay silent on ---------------------------------------

sheet_saying '.pill { white-space: nowrap; border: 1px solid currentColor; }' \
	'.pill-mark { width: 0.5em; height: 0.85em; border-radius: 50%; }' \
	'.pill-quiet { padding: 0; background: transparent; color: inherit; }'
check "a property name, a hairline, a zero and a ratio are silent" 0 "$RC" "0 finding(s)"

sheet_saying '.pill { color: var(--ink-1); padding: var(--space-2); }' \
	'@media (min-width: 60em) { .pill { padding: 0; } }'
check "a token and a named width are silent" 0 "$RC" "0 finding(s)"

sheet_saying '/* the wall is drawn in #b3261e until a token names it */' \
	'.pill { color: var(--ink-1); }'
check "a colour named in a comment is prose" 0 "$RC" "0 finding(s)"

# A comment that runs across lines takes its whole body with it.
sheet_saying '/* red, and' 'still 12px of comment */' '.pill { color: var(--ink-1); }'
check "a comment carries to the line after it" 0 "$RC" "0 finding(s)"

# --- Scope -------------------------------------------------------------------

# THE SUCCESS LINE REPORTS WHAT THE RUN READ. The fixture has the token file
# and one sheet, and only the second of them is in the corpus.
sheet_saying '.pill { color: var(--ink-1); }'
check "the clean line counts the sheets it read" 0 "$RC" "across 1 sheet(s)"

# The definition site states colours and lengths; that is what it is for.
sheet_saying '.pill { color: var(--ink-1); }'
check "the token file is out of the corpus" 0 "$RC" "0 finding(s)"
run_in "$R" "$TOKENS"
check "naming the token file scans it anyway" 1 "$RC" "a raw colour"

# The sheet the console drew before the design system is being deleted rather
# than tokenised, and is named in the gate for exactly as long as it exists.
fresh_repo "$R"
mkdir -p "$R/$SHEETS" "$R/ui/chuggy-ui/app/styles"
printf '%s\n' ':root { --ink-1: light-dark(#151a17, #eef2ee); }' > "$R/$TOKENS"
printf '%s\n' '.badge { color: #e3b341; padding: 0.15rem; }' > "$R/ui/chuggy-ui/app/styles.css"
printf '%s\n' '.pill { color: var(--ink-1); }' > "$R/$SHEETS/Pill.css"
git -C "$R" add -A
run_in "$R"
check "the pre-system sheet is out of the corpus" 0 "$RC" "across 1 sheet(s)"

# --- Could not run -----------------------------------------------------------

# No definition site is not a clean tree: the rule has nothing to point at.
fresh_repo "$R"
mkdir -p "$R/$SHEETS"
printf '%s\n' '.pill { color: var(--ink-1); }' > "$R/$SHEETS/Pill.css"
git -C "$R" add -A
run_in "$R"
check "no token file exits 2, not 0" 2 "$RC" "no definition site"

# A corpus of nothing but the two exemptions is not a clean tree either.
fresh_repo "$R"
mkdir -p "$R/ui/chuggy-ui/app/styles"
printf '%s\n' ':root { --ink-1: light-dark(#151a17, #eef2ee); }' > "$R/$TOKENS"
printf '%s\n' '.badge { color: #e3b341; }' > "$R/ui/chuggy-ui/app/styles.css"
git -C "$R" add -A
run_in "$R"
check "a corpus of only the exemptions exits 2, not 0" 2 "$RC" "the glob matched nothing"

run_in "$BARE"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

done_ "check-console-tokens.test.sh"
