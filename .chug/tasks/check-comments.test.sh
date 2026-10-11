#!/bin/sh
# Shell test for check-comments.sh.
#
# THE NEGATIVE CASES ARE THE POINT OF THIS SUITE. This gate rejects a shape
# every other file in this tree is written in, so each allowed thing gets a
# case proving it stays silent: the module header at any length, a two-sentence
# doc comment, every directive kind the gate allows, and a string literal
# containing what looks like a comment.
#
# A COMPONENT FILE GETS A CASE FOR EACH WAY MARKUP ONCE HID WHAT FOLLOWED IT,
# and each control after markup stands beside a violation the gate reports: a
# fixture the gate reads nothing of would pass the control too.
#
# Run:  .chug/tasks/check-comments.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-comments.sh"
ROOT="$(cd "$HERE/../.." && pwd)"
trap 'rm -rf "$WORK"' EXIT

R="$WORK/repo"

run_in() { # <dir> [<file>...]
	_dir="$1"
	shift
	OUT="$WORK/.out"
	set +e
	(cd "$_dir" && "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

# node_modules is symlinked rather than installed: the parser must be the one
# this tree pins, and an install per case would put this suite outside the
# sequencer per-suite cap.
tooled_repo() { # <dir>
	fresh_repo "$1"
	ln -s "$ROOT/node_modules" "$1/node_modules"
	printf '%s\n' node_modules >> "$1/.git/info/exclude"
}

# A source file whose first block is a module header, then whatever the case is
# testing. Every case gets the header: its exemption is what every other
# judgement is relative to.
source_saying() { # <line>...
	tooled_repo "$R"
	{
		printf '%s\n' '/**'
		printf '%s\n' ' * A module header. It states what this module accepts and emits.'
		printf '%s\n' ' */'
		printf '%s\n' "$@"
	} > "$R/a.ts"
	git -C "$R" add -A
	run_in "$R"
}

# The same, as a component.
component_saying() { # <line>...
	tooled_repo "$R"
	{
		printf '%s\n' '/** A component header. */'
		printf '%s\n' "$@"
	} > "$R/a.tsx"
	git -C "$R" add -A
	run_in "$R"
}

# --- What is rejected --------------------------------------------------------

source_saying 'export const x = 1' '// a note to the next reader'
check "a line comment is a finding" 1 "$RC" "a line comment"

# Rust doc syntax renders in no TypeScript tool.
source_saying '/// rust outer doc'
check "/// is an ordinary comment" 1 "$RC" "a line comment"

source_saying '//! rust inner doc'
check "//! is an ordinary comment" 1 "$RC" "a line comment"

source_saying '/* a plain block */' 'export const x = 1'
check "a non-doc block is a finding" 1 "$RC" "a block comment that is not a doc comment"

# Three sentences is the first count over the cap.
source_saying '/** One. Two. Three. */' 'export const x = 1'
check "three sentences is over the cap" 1 "$RC" "3 sentences; the cap is two"

source_saying '// @ts-ignore' 'export const x = 1'
check "@ts-ignore is rejected outright" 1 "$RC" "use @ts-expect-error"

# @ts-expect-error has to say what it expected, or it is @ts-ignore spelled
# differently.
source_saying '// @ts-expect-error nope' 'export const x = 1'
check "@ts-expect-error needs a description" 1 "$RC" "needs a description"

# A jscpd directive without its reason is an exemption nobody can review.
source_saying '// jscpd:ignore-start' 'export const x = 1'
check "a bare jscpd directive is a finding" 1 "$RC" "states its reason"

# The sealed rules: a rule with a documented way round it enforces nothing.
source_saying '// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check' 'export const x = 1'
check "an exhaustiveness rule is not suppressible" 1 "$RC" "not suppressible"

source_saying '// eslint-disable-next-line no-restricted-globals' 'export const x = 1'
check "a purity rule is not suppressible" 1 "$RC" "not suppressible"

source_saying '// eslint-disable-next-line no-restricted-imports' 'export const x = 1'
check "a boundary rule is not suppressible" 1 "$RC" "not suppressible"

# A disable naming nothing disables everything.
source_saying '// eslint-disable-next-line' 'export const x = 1'
check "a disable must name its rule" 1 "$RC" "a line comment"

# --- What is allowed ---------------------------------------------------------

# The module header carries no cap, and is bounded by being one block per file.
tooled_repo "$R"
{
	printf '%s\n' '/**'
	printf '%s\n' ' * One. Two. Three. Four. Five. Six. Seven sentences of contract.'
	printf '%s\n' ' */'
	printf '%s\n' 'export const x = 1'
} > "$R/a.ts"
git -C "$R" add -A
run_in "$R"
check "the module header is exempt from the cap" 0 "$RC" "0 finding(s)"

# The exemption is the FIRST block only.
tooled_repo "$R"
{
	printf '%s\n' '/**'
	printf '%s\n' ' * One. Two. Three. Four. Five sentences of contract.'
	printf '%s\n' ' */'
	printf '%s\n' 'export const x = 1'
	printf '%s\n' '/** One. Two. Three. */'
	printf '%s\n' 'export const y = 2'
} > "$R/a.ts"
git -C "$R" add -A
run_in "$R"
check "only the first block is exempt" 1 "$RC" "3 sentences; the cap is two"

# At the cap, not over it.
source_saying '/** One sentence. And a second. */' 'export const x = 1'
check "two sentences is at the cap" 0 "$RC" "0 finding(s)"

source_saying '/** A single sentence. */' 'export const x = 1'
check "one sentence is under the cap" 0 "$RC" "0 finding(s)"

# Code in backticks is not prose, so a dotted expression inside one does not
# read as a run of sentences.
source_saying '/** Returns `a.b.c.d` unchanged. */' 'export const x = 1'
check "backticked code is not sentence terminators" 0 "$RC" "0 finding(s)"

# Each allowed directive, one case each.
source_saying '// @ts-expect-error the fixture is deliberately ill-typed' 'export const x = 1'
check "@ts-expect-error with a description is allowed" 0 "$RC" "0 finding(s)"

source_saying '// prettier-ignore' 'export const x = 1'
check "prettier-ignore is allowed" 0 "$RC" "0 finding(s)"

source_saying '// jscpd:ignore-start the two encoders match by contract' 'export const x = 1' '// jscpd:ignore-end and here it resumes'
check "a jscpd directive with a reason is allowed" 0 "$RC" "0 finding(s)"

source_saying '// eslint-disable-next-line no-console' 'export const x = 1'
check "an unsealed rule may be disabled" 0 "$RC" "0 finding(s)"

# A directive is one line. The wrapped half is where an explanation grows that
# no tool reads.
source_saying '// prettier-ignore' '// because the table below is aligned by hand' 'export const x = 1'
check "a wrapped directive line is an ordinary comment" 1 "$RC" "a line comment"

# A string is not a comment.
source_saying 'export const u = "https://example.test/x"'
check "a string containing // is not a comment" 0 "$RC" "0 finding(s)"

source_saying 'export const u = `a template with /* inside`'
check "a template literal is not a comment" 0 "$RC" "0 finding(s)"

# --- Could not run -----------------------------------------------------------

# An empty corpus must not be the way this gate passes.
tooled_repo "$R"
printf '%s\n' 'x' > "$R/readme.md"
git -C "$R" add -A
run_in "$R"
check "an empty corpus exits 2, not 0" 2 "$RC" "the glob matched nothing"

run_in "$WORK"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

# Without the pinned parser there is no verdict, and saying so is not a pass.
fresh_repo "$R"
printf '%s\n' '/** A header. */' 'export const x = 1' > "$R/a.ts"
git -C "$R" add -A
run_in "$R"
check "a checkout without the toolchain exits 2, not 0" 2 "$RC" "npm ci"

# A path with a space in it survives.
tooled_repo "$R"
mkdir -p "$R/a dir"
{
	printf '%s\n' '/** A header. */'
	printf '%s\n' '// a note'
} > "$R/a dir/b.ts"
git -C "$R" add -A
run_in "$R"
check "a path with a space is scanned" 1 "$RC" "a line comment"

# A REGEX LITERAL IS NOT A COMMENT, and a corpus of TypeScript is full of
# patterns that match a comment marker.
source_saying 'export const isDoc = /^\s*\/\/\//;'
check "a regex matching a comment marker is not a comment" 0 "$RC" "0 finding(s)"

source_saying 'export const found = "x".match(/a\/\/b/);'
check "a regex passed as an argument is not a comment" 0 "$RC" "0 finding(s)"

source_saying 'export const cls = /[/]/;'
check "a slash inside a character class does not end the pattern" 0 "$RC" "0 finding(s)"

# Division is not a regex, so a comment after one is still a comment.
source_saying 'export const half = 10 / 2;' '// a note'
check "a comment after a division is still a comment" 1 "$RC" "a line comment"

# A component file is TypeScript in every way this rule is about, and the
# extension is the only thing separating it from a file the corpus already
# reads.
tooled_repo "$R"
{
	printf '%s\n' '/** A header. */'
	printf '%s\n' '// a note in a component'
	printf '%s\n' 'export const view = null;'
} > "$R/a.tsx"
git -C "$R" add -A
run_in "$R"
check "a component file is in the corpus too" 1 "$RC" "a line comment"

# And it is a corpus of its own: a tree with components and no other
# TypeScript is scanned rather than reported as having nothing to read.
check "a tree of components alone is not an empty corpus" 1 "$RC" "1 finding(s)"

# --- After markup ------------------------------------------------------------

# A comment after markup is judged exactly as one before it.
component_saying 'export const a = <a>x</a>;' '// a note'
check "a line comment after a closing tag is a finding" 1 "$RC" "a.tsx:3: a line comment"

component_saying 'export const b = (x: string) => <Row value={x} />;' '/* a plain block */'
check "a block after a self-closing tag ending in {x} is a finding" 1 "$RC" "a.tsx:3: a block comment that is not a doc comment"

component_saying 'export const c = <Row value="x" />;' '/** One. Two. Three. */' 'export const d = 1;'
check "a doc comment after a self-closing tag ending in a string is capped" 1 "$RC" "a.tsx:3: a doc comment of 3 sentences"

# Prettier puts the `/>` of a wrapped element on a line of its own.
component_saying 'export const e = (' '  <Row' '    value="x"' '  />' ');' '// jscpd:ignore-end'
check "a directive after a lone /> still needs its reason" 1 "$RC" "a.tsx:7: a jscpd directive states its reason"

# JSX text is not code: an apostrophe, a backtick or a slash in it opens
# nothing.
component_saying "export const f = <p>don't {/* x */}</p>;"
check "a block after an apostrophe in JSX text is a finding" 1 "$RC" "a.tsx:2: a block comment that is not a doc comment"

component_saying 'export const g = <p>a ` b {/* x */}</p>;'
check "a block after a backtick in JSX text is a finding" 1 "$RC" "a.tsx:2: a block comment that is not a doc comment"

component_saying 'export const h = <p>/etc {/* x */}</p>;'
check "a block after a slash in JSX text is a finding" 1 "$RC" "a.tsx:2: a block comment that is not a doc comment"

# The controls, each beside a finding so the gate is seen reading past them.
component_saying 'export const a = <a>x</a>;' 'export const u = "https://example.test/x";' '// a note'
check "after markup, a string holding // is not a comment" 1 "$RC" "1 finding(s)"
check "after markup, the comment past the string is still read" 1 "$RC" "a.tsx:4: a line comment"

component_saying 'export const a = <a>x</a>;' 'export const r = "x".match(/a\/\/b/);' '// a note'
check "after markup, a regex matching slashes is not a comment" 1 "$RC" "1 finding(s)"
check "after markup, the comment past the regex is still read" 1 "$RC" "a.tsx:4: a line comment"

# A regex that begins its line has nothing before it to say it is one.
source_saying 'export const two =' '  /\/\//.test("a//b");' '// a note'
check "a regex beginning its line is not a comment" 1 "$RC" "1 finding(s)"
check "and the comment after it is read" 1 "$RC" "a.ts:6: a line comment"

done_ "check-comments.test.sh"
