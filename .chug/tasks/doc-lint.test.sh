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
EMPTY="$(mktemp -d)"
trap 'rm -rf "$WORK" "$BARE" "$EMPTY"' EXIT

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

# A repo with commits and no markdown in them. Whole-tree mode DISCOVERED this
# corpus, so an empty result is a glob that matched nothing rather than a tree
# with nothing wrong with it — and the argument case above proves the two are
# still told apart, because there the caller named the files.
fresh_repo "$EMPTY"
printf 'placeholder\n' > "$EMPTY/README.txt"
git -C "$EMPTY" add -A
OUT="$EMPTY/.out"
set +e
(cd "$EMPTY" && "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "an empty discovered corpus exits 2, not 0" 2 "$RC" "the glob matched nothing"

# A FILTER THAT FAILED IS NOT A FILTER THAT MATCHED NOTHING. The blank-line
# filter's status used to be discarded, so a grep that could not run at all
# emptied the file list and the gate reported the whole corpus as absent — over
# a tree that is full of markdown, as $WORK is here.
BIN="$WORK/brokenbin"
tools_only "$BIN" git awk
printf '#!/bin/sh\nexit 2\n' > "$BIN/grep"
chmod +x "$BIN/grep"
OUT="$WORK/.out"
set +e
(cd "$WORK" && env PATH="$BIN" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a failed filter exits 2, not 0" 2 "$RC" "the file-list filter failed"

# NO AWK IS A BROKEN GATE, NOT A PASS. Every check here is an awk program, and
# without the guard the shell exits on the missing command with a status this
# gate's header does not claim.
#
# The PATH holds the rest of what the gate reaches for so the fixture is a
# degraded host rather than an empty one, but that is honesty and not
# discrimination: the awk guard sits above every other line in the gate, so an
# empty PATH would produce the same verdict — which means this case cannot
# notice `tools_only` handing it a broken link either. `_suite.sh` says what
# that costs.
NOAWK="$WORK/noawk"
tools_only "$NOAWK" git grep dirname
OUT="$WORK/.out"
set +e
(cd "$WORK" && env PATH="$NOAWK" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "no awk exits 2, not 127" 2 "$RC" "no \`awk\` on PATH"

# THE DISCOVERY COMMAND ITSELF FAILING is its own refusal, distinct from the
# glob coming back empty: one is a tree with no markdown in it and the other is
# a question that was never answered. The stub git answers `rev-parse` so the
# gate gets as far as reading the corpus, and refuses `ls-files`.
BADGIT="$WORK/badgit"
tools_only "$BADGIT" grep
printf '#!/bin/sh\ncase "$1" in ls-files) exit 3 ;; esac\nexec %s "$@"\n' \
	"$(command -v git)" > "$BADGIT/git"
chmod +x "$BADGIT/git"
OUT="$WORK/.out"
set +e
(cd "$WORK" && env PATH="$BADGIT:$PATH" "$SUT") >"$OUT" 2>&1
RC=$?
set -e
check "a failed git ls-files exits 2, not 0" 2 "$RC" "\`git ls-files\` failed"

done_ "doc-lint.test.sh"
