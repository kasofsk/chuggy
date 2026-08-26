#!/bin/sh
# Shell test for check-console.sh.
#
# The fixtures are throwaway consoles whose scripts are shell one-liners, so
# what is under test is the gate's treatment of a verdict rather than any real
# toolchain: that a script's failure, a script nobody declared and a console
# nobody installed stay three different answers.
#
# THE LINE THAT SAYS THERE IS NOTHING TO RUN BELONGS TO ONE CASE. It is the
# only reading under which a green gate has run no command, so a case with a
# console present refuses it as well as asserting what replaced it — otherwise
# a gate that silently stopped finding consoles would read exactly like a tree
# that has none.
#
# THE FIGURE IN THE CLEAN LINE IS ASSERTED AGAINST A FIXTURE THIS SUITE SIZED,
# and against two consoles as well as one, because a count that is really the
# length of the script list passes the single-console case.
#
# Run:  .chug/tasks/check-console.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-console.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

R="$WORK/repo"
BIN="$WORK/bin"

fixture() {
	rm -rf "$R"
	mkdir -p "$R"
	git -C "$R" init -q -b main
	git -C "$R" config user.email t@example.com
	git -C "$R" config user.name t
}

# `node_modules` is a directory rather than an install: the gate asks whether
# the packages are there, and the fixture scripts need none.
console() { # <name> <package.json body>
	mkdir -p "$R/ui/$1/node_modules"
	printf '%s\n' "$2" > "$R/ui/$1/package.json"
}

WHOLE='{ "name": "c", "version": "0.0.0", "private": true, "scripts": {
	"typecheck": "true", "lint": "true", "test": "true", "build": "true" } }'

seal() {
	git -C "$R" add -A
	OUT="$WORK/.out"
	set +e
	(cd "$R" && "$SUT") >"$OUT" 2>&1
	RC=$?
	set -e
}

# The gate reads git rather than the filesystem, so a stub that answers one
# question and not the next is how each way it can fail is reached. An empty
# argument leaves the listing unanswered.
stub_git() { # <ls-files answer>
	rm -rf "$BIN"
	mkdir -p "$BIN"
	{
		printf '#!/bin/sh\n'
		printf 'if [ "$1" = rev-parse ]; then printf %s %s\n' '%s\\n' "$R"
		printf '\texit 0\nfi\n'
		[ -z "$1" ] || printf 'if [ "$1" = ls-files ]; then echo %s\n\texit 0\nfi\n' "$1"
		printf 'exit 1\n'
	} > "$BIN/git"
	chmod +x "$BIN/git"
}

# `check` asserts what a run printed; this asserts what it must not, which is
# the only way to say a line belongs to one case alone.
refute() { # <name> <must-not-contain>
	if grep -qF "$2" "$OUT"; then
		echo "FAIL - $1: output was not to contain: $2"
		echo "----- output -----"; cat "$OUT"; echo "------------------"
		fail=$((fail + 1))
	else
		echo "ok   - $1"
		pass=$((pass + 1))
	fi
}

# --- The gate's own contract -------------------------------------------------

OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

# A tree with no console that builds is clean and says what it did instead of
# counting nothing.
fixture
mkdir -p "$R/ui/console/app"
printf '%s\n' 'export const decide = () => 1' > "$R/ui/console/app/decide.js"
seal
check "a console with no manifest is not this gate's" 0 "$RC" "nothing to run"

# --- A console that builds ---------------------------------------------------

fixture
console built "$WHOLE"
seal
check "a console whose every script passes is clean" 0 "$RC" "script(s) clean"
check "the clean line counts the scripts this console ran" 0 "$RC" "4 script(s) clean across 1 built console(s)"
refute "and does not also say there was nothing to run" "nothing to run"

fixture
console built "$WHOLE"
console other "$WHOLE"
seal
check "the count is the run's, not the script list's" 0 "$RC" "8 script(s) clean across 2 built console(s)"

# A package inside a console is not a second console. Git's pathspec `*` crosses
# a separator, so a gate that took the list as given would run a library's
# manifest as a console, find none of the scripts in it, and tally a console
# that is not there.
fixture
console built "$WHOLE"
mkdir -p "$R/ui/built/packages/shared"
printf '%s\n' '{ "name": "shared", "version": "0.0.0", "private": true }' \
	> "$R/ui/built/packages/shared/package.json"
seal
check "a manifest nested inside a console is not a second console" 0 "$RC" "4 script(s) clean across 1 built console(s)"

# --- A finding ---------------------------------------------------------------

fixture
console built '{ "name": "c", "version": "0.0.0", "private": true, "scripts": {
	"typecheck": "true", "lint": "echo boom; exit 1", "test": "true",
	"build": "true" } }'
seal
check "a script that fails is a finding" 1 "$RC" "npm run lint\` failed"
check "the failing run's own output is shown" 1 "$RC" "boom"
check "the finding line counts what it found" 1 "$RC" "1 finding(s) across 1 built console(s)"

# A script nobody declared is a finding and not a skip: the gate cannot report
# a verdict it never asked for.
fixture
console built '{ "name": "c", "version": "0.0.0", "private": true, "scripts": {
	"typecheck": "true", "lint": "true", "test": "true" } }'
seal
check "a script the manifest omits is a finding" 1 "$RC" "declares no \`build\` script"

fixture
console built 'not json at all'
seal
check "a manifest that is not JSON is a finding" 1 "$RC" "not readable as JSON"

# --- Could not run -----------------------------------------------------------

# Packages absent is not a console that passes, and the remedy names the
# directory it has to be run in.
fixture
console built "$WHOLE"
rmdir "$R/ui/built/node_modules"
seal
check "a console with no packages installed exits 2, not 0" 2 "$RC" "has no installed packages"
check "the remedy names the directory" 2 "$RC" "npm ci --prefix ui/built"
refute "and no console is reported clean" "script(s) clean"

# A listing that failed leaves the same empty list a tree with no built console
# leaves, and the gate would then report on a tree it could not read.
fixture
console built "$WHOLE"
git -C "$R" add -A
stub_git ""
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$BIN:$PATH" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a listing that fails exits 2, not 0" 2 "$RC" "could not list what is tracked"
refute "and is not reported as a tree with no console" "nothing to run"

# PATH is replaced, not prefixed, so the real npm is out of reach. `git` and
# `node` are stubbed only so far as the gate needs them to get this far.
fixture
console built "$WHOLE"
git -C "$R" add -A
stub_git ui/built/package.json
printf '#!/bin/sh\nexit 0\n' > "$BIN/node"
chmod +x "$BIN/node"
OUT="$WORK/.out"
set +e
(cd "$R" && PATH="$BIN" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no npm on PATH exits 2, not 0" 2 "$RC" "no npm, so no console can be built"

done_ "check-console.test.sh"
