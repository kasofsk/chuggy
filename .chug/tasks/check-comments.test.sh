#!/bin/sh
# Shell test for check-comments.sh.
#
# THE NEGATIVE CASES ARE THE POINT OF THIS SUITE, on check-figures.test.sh's
# argument and for a sharper reason: this gate rejects a shape every other file
# in this tree is written in. A source file that may carry only `/** */` needs
# its exemptions proved silent one at a time, or the first legitimate directive
# to arrive gets the gate switched off in the sequencer.
#
# So each allowed thing gets a case: the module header at any length, a
# two-sentence doc comment, every directive kind the gate allows, and a string
# literal containing what looks like a comment.
#
# Fixtures are built with printf rather than a heredoc, for the reason
# check-figures.test.sh states — except that here the hazard is inverted. This
# suite is shell, not TypeScript, so it is outside the gate's own corpus and
# cannot reject itself; printf is kept for the readability of seeing each
# fixture line as its own argument.
#
# Run:  .chug/tasks/check-comments.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-comments.sh"
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

# A source file whose first block is a module header, then whatever the case is
# testing. Every case gets the header, because the header's exemption is what
# every other judgement is relative to.
source_saying() { # <line>...
	fresh_repo "$R"
	{
		printf '%s\n' '/**'
		printf '%s\n' ' * A module header. It states what this module accepts and emits.'
		printf '%s\n' ' */'
		printf '%s\n' "$@"
	} > "$R/a.ts"
	git -C "$R" add -A
	run_in "$R"
}

# --- What is rejected --------------------------------------------------------

# 1. A line comment is the commonest form of the thing being banned.
source_saying 'export const x = 1' '// a note to the next reader'
check "a line comment is a finding" 1 "$RC" "a line comment"

# 2. Rust doc syntax renders in no TypeScript tool, so it is an ordinary
#    comment here rather than a third kind with rules of its own.
source_saying '/// rust outer doc'
check "/// is an ordinary comment" 1 "$RC" "a line comment"

source_saying '//! rust inner doc'
check "//! is an ordinary comment" 1 "$RC" "a line comment"

# 3. A block comment that is not a doc comment is prose no tool surfaces.
source_saying '/* a plain block */' 'export const x = 1'
check "a non-doc block is a finding" 1 "$RC" "a block comment that is not a doc comment"

# 4. The cap. Three sentences is the first count over it.
source_saying '/** One. Two. Three. */' 'export const x = 1'
check "three sentences is over the cap" 1 "$RC" "3 sentences; the cap is two"

# 5. @ts-ignore cannot outlive the problem it names, because nothing tells it
#    when the problem is gone.
source_saying '// @ts-ignore' 'export const x = 1'
check "@ts-ignore is rejected outright" 1 "$RC" "use @ts-expect-error"

# 6. Its replacement has to say what it expected, or it is @ts-ignore spelled
#    differently.
source_saying '// @ts-expect-error nope' 'export const x = 1'
check "@ts-expect-error needs a description" 1 "$RC" "needs a description"

# 7. A jscpd directive without its reason is a duplication exemption nobody can
#    review.
source_saying '// jscpd:ignore-start' 'export const x = 1'
check "a bare jscpd directive is a finding" 1 "$RC" "states its reason"

# 8. The sealed rules. A rule with a documented way round it enforces nothing,
#    and these three kinds are the ones this tree states as house rules.
source_saying '// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check' 'export const x = 1'
check "an exhaustiveness rule is not suppressible" 1 "$RC" "not suppressible"

source_saying '// eslint-disable-next-line no-restricted-globals' 'export const x = 1'
check "a purity rule is not suppressible" 1 "$RC" "not suppressible"

source_saying '// eslint-disable-next-line no-restricted-imports' 'export const x = 1'
check "a boundary rule is not suppressible" 1 "$RC" "not suppressible"

# 9. A disable naming nothing disables everything.
source_saying '// eslint-disable-next-line' 'export const x = 1'
check "a disable must name its rule" 1 "$RC" "a line comment"

# --- What is allowed ---------------------------------------------------------

# 10. The module header carries no cap: it is the one place length is the job,
#     and it is bounded by being one block per file.
fresh_repo "$R"
{
	printf '%s\n' '/**'
	printf '%s\n' ' * One. Two. Three. Four. Five. Six. Seven sentences of contract.'
	printf '%s\n' ' */'
	printf '%s\n' 'export const x = 1'
} > "$R/a.ts"
git -C "$R" add -A
run_in "$R"
check "the module header is exempt from the cap" 0 "$RC" "0 finding(s)"

# 11. The exemption is the FIRST block only. A file whose second block runs
#     long is the case the exemption would otherwise swallow.
fresh_repo "$R"
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

# 12. At the cap, not over it.
source_saying '/** One sentence. And a second. */' 'export const x = 1'
check "two sentences is at the cap" 0 "$RC" "0 finding(s)"

source_saying '/** A single sentence. */' 'export const x = 1'
check "one sentence is under the cap" 0 "$RC" "0 finding(s)"

# 13. Code in backticks is not prose, so a dotted expression inside one does
#     not read as a run of sentences.
source_saying '/** Returns `a.b.c.d` unchanged. */' 'export const x = 1'
check "backticked code is not sentence terminators" 0 "$RC" "0 finding(s)"

# 14. Each allowed directive, one case each.
source_saying '// @ts-expect-error the fixture is deliberately ill-typed' 'export const x = 1'
check "@ts-expect-error with a description is allowed" 0 "$RC" "0 finding(s)"

source_saying '// prettier-ignore' 'export const x = 1'
check "prettier-ignore is allowed" 0 "$RC" "0 finding(s)"

source_saying '// jscpd:ignore-start the two encoders match by contract' 'export const x = 1' '// jscpd:ignore-end and here it resumes'
check "a jscpd directive with a reason is allowed" 0 "$RC" "0 finding(s)"

source_saying '// eslint-disable-next-line no-console' 'export const x = 1'
check "an unsealed rule may be disabled" 0 "$RC" "0 finding(s)"

# 15. A directive is one line. The wrapped half is where an explanation grows
#     that no tool reads.
source_saying '// prettier-ignore' '// because the table below is aligned by hand' 'export const x = 1'
check "a wrapped directive line is an ordinary comment" 1 "$RC" "a line comment"

# 16. A string is not a comment. Getting this wrong would make the gate
#     unusable on any file that builds a URL.
source_saying 'export const u = "https://example.test/x"'
check "a string containing // is not a comment" 0 "$RC" "0 finding(s)"

source_saying 'export const u = `a template with /* inside`'
check "a template literal is not a comment" 0 "$RC" "0 finding(s)"

# --- Could not run -----------------------------------------------------------

# 17. An empty corpus is the failure mode a glob-driven gate has, and it must
#     not be the way this gate passes.
fresh_repo "$R"
printf '%s\n' 'x' > "$R/readme.md"
git -C "$R" add -A
run_in "$R"
check "an empty corpus exits 2, not 0" 2 "$RC" "the glob matched nothing"

run_in "$WORK"
check "outside a git checkout exits 2, not 0" 2 "$RC" "not a git checkout"

# 18. A path with a space in it survives, which is what check-shell-quoting.sh
#     exists to keep true of every gate here.
fresh_repo "$R"
mkdir -p "$R/a dir"
{
	printf '%s\n' '/** A header. */'
	printf '%s\n' '// a note'
} > "$R/a dir/b.ts"
git -C "$R" add -A
run_in "$R"
check "a path with a space is scanned" 1 "$RC" "a line comment"

# 19. A REGEX LITERAL IS NOT A COMMENT. This is the case that found the bug:
#     a gate whose own corpus is full of patterns matching comment markers
#     reads every one of them as the thing it is looking for.
source_saying 'export const isDoc = /^\s*\/\/\//;'
check "a regex matching a comment marker is not a comment" 0 "$RC" "0 finding(s)"

source_saying 'export const found = "x".match(/a\/\/b/);'
check "a regex passed as an argument is not a comment" 0 "$RC" "0 finding(s)"

source_saying 'export const cls = /[/]/;'
check "a slash inside a character class does not end the pattern" 0 "$RC" "0 finding(s)"

# 20. Division is not a regex, so a comment after one is still a comment. Get
#     this wrong and the exemption swallows the rest of the file.
source_saying 'export const half = 10 / 2;' '// a note'
check "a comment after a division is still a comment" 1 "$RC" "a line comment"


done_ "check-comments.test.sh"
