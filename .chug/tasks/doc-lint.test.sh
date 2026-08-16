#!/bin/sh
# Shell test for doc-lint.sh — no network, no toolchain.
#
# Every case breaks exactly one rule and asserts the named finding, because a
# suite that only ever runs the clean path proves the script exits 0, not that
# it can say no. The clean cases sit beside them as the controls.
#
# $WORK is a real git checkout: doc-lint.sh resolves the repo root and works
# from there, so rule 3 (which matches on the *repo-relative* path) can only be
# exercised by a harness that gives it a repo. The non-git case is its own
# fixture and asserts the could-not-run verdict.
#
# Run:  .chug/tasks/doc-lint.test.sh   (exits 0 if all cases pass)
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/doc-lint.sh"
BARE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE"' EXIT

git -C "$WORK" init -q -b main
git -C "$WORK" config user.email t@example.com
git -C "$WORK" config user.name t

run() { # <repo-relative arg>... — run from $WORK so the repo root is $WORK
	OUT="$WORK/.out"
	set +e
	(cd "$WORK" && "$SUT" "$@") >"$OUT" 2>&1
	RC=$?
	set -e
}

mkdir -p "$WORK/docs/design" "$WORK/docs/reference"
# Named to satisfy rule 3 itself: a fixture that violates a rule under test
# would make the whole-tree case pass for the wrong reason.
printf '# Sibling\n\nContent.\n' > "$WORK/docs/design/000-sibling.md"

# --- Controls: the clean paths ----------------------------------------------

cat > "$WORK/docs/design/001-good.md" <<'EOF'
# Good design

See [the sibling](000-sibling.md) for context.

```sh
echo "fenced hashes are ignored: #notaheading"
```
EOF
run docs/design/001-good.md
check "clean doc passes" 0 "$RC" "0 error(s)"

# The fence body above contains a line a naive heading check would flag. That
# it passed is the proof fences are skipped; assert it as its own case so a
# regression in the fence tracking cannot hide behind the case above.
run docs/design/001-good.md
check "fenced content is not linted" 0 "$RC" "0 error(s)"

printf '# Trailing   \n\nBody.\n' > "$WORK/docs/reference/trailing.md"
run docs/reference/trailing.md
check "trailing whitespace warns, does not fail" 0 "$RC" "warn"

printf 'not markdown\n' > "$WORK/docs/reference/notes.txt"
run docs/reference/notes.txt
check "a non-markdown argument is skipped" 0 "$RC" "nothing to lint"

# A doc can be selected and not be there — deleted and not yet committed, or
# named by a caller. The tally has to count what was read, or a run that linted
# nothing reports the same line as a run that linted the file.
run docs/design/001-good.md docs/design/002-deleted.md
check "the tally counts the docs that were read" 0 "$RC" "across 1 file(s)"

# --- Rule 1: well-formedness -------------------------------------------------

printf '#Heading with no space\n\nBody.\n' > "$WORK/docs/reference/nospace.md"
run docs/reference/nospace.md
check "heading without a space fails" 1 "$RC" "heading needs a space after #"

printf '# Open\n\n```sh\necho unclosed\n' > "$WORK/docs/reference/unclosed.md"
run docs/reference/unclosed.md
check "unclosed fence fails" 1 "$RC" "unclosed code fence"

# --- Rule 2: links resolve ---------------------------------------------------

printf '# Broken\n\n[gone](./does-not-exist.md)\n' > "$WORK/docs/reference/broken.md"
run docs/reference/broken.md
check "broken relative link fails and names the target" 1 "$RC" "does-not-exist.md"

printf '# External\n\n[site](https://example.com) and [mail](mailto:a@b.c)\n' \
	> "$WORK/docs/reference/external.md"
run docs/reference/external.md
check "external and mailto links are skipped" 0 "$RC" "0 error(s)"

printf '# Anchor\n\n[up](#anchor-only)\n' > "$WORK/docs/reference/anchor.md"
run docs/reference/anchor.md
check "anchor-only link is skipped" 0 "$RC" "0 error(s)"

# --- Rule 3: design filenames ------------------------------------------------

printf '# Bad\n\nBody.\n' > "$WORK/docs/design/no-leading-digits.md"
run docs/design/no-leading-digits.md
check "design filename without a seq fails" 1 "$RC" "{seq}-{slug}.md"

# The load-bearing locale case: under a collating locale an `a-z` range also
# spans uppercase, and this rule would quietly stop rejecting it. LC_ALL=C and
# the enumerated character class are what keep this red.
printf '# Bad\n\nBody.\n' > "$WORK/docs/design/002-Uppercase.md"
run docs/design/002-Uppercase.md
check "design filename with an uppercase slug fails" 1 "$RC" "{seq}-{slug}.md"

mkdir -p "$WORK/docs/design/nested"
printf '# Nested\n\nBody.\n' > "$WORK/docs/design/nested/Anything.md"
run docs/design/nested/Anything.md
check "a nested subdirectory is not a design doc" 0 "$RC" "0 error(s)"

# A design doc named correctly must not be flagged — the control that keeps the
# two cases above from passing for the wrong reason.
run docs/design/001-good.md
check "well-named design doc passes rule 3" 0 "$RC" "0 error(s)"

# --- Whole-tree mode ---------------------------------------------------------

git -C "$WORK" add -A
run
check "whole-tree mode lints every tracked doc" 1 "$RC" "unclosed code fence"

# --- --emit-links judges nothing ---------------------------------------------

OUT="$WORK/.out"
set +e
(cd "$WORK" && "$SUT" --emit-links docs/design/001-good.md) >"$OUT" 2>&1
RC=$?
set -e
check "--emit-links normalizes to a repo-relative path" 0 "$RC" "docs/design/000-sibling.md"

set +e
(cd "$WORK" && "$SUT" --emit-links docs/reference/broken.md) >"$OUT" 2>&1
RC=$?
set -e
check "--emit-links does not judge a dangling target" 0 "$RC" "does-not-exist.md"

# --- Could not run is not a pass ---------------------------------------------

OUT="$BARE/.out"
set +e
(cd "$BARE" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "doc-lint.test.sh"
