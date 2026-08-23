#!/bin/sh
# Copy-paste detection at threshold 0: no clone of the size `.jscpd.json` sets,
# anywhere, ever. Tests are in scope. Where a genuine scenario must repeat, mark
# the region with `jscpd:ignore-start` and a reason on that line.
#
# A SCAN THAT MEASURED NOTHING IS A COULD-NOT-RUN. Two shapes: no verdict in the
# output, and a verdict over an empty scan. A fetch failure produces the first
# and a mis-scoped `ignorePattern` the second, and "no clones" over nothing
# reads exactly like "no clones" over the tree.
#
# `.jscpd.json` is JSON and carries no comments, so its ignore list is stated
# here. `**/.claude/worktrees/**` is there because a git worktree is a second
# copy of the tree: scanned, every file pairs against its own copy. The entry is
# that path and not `.claude/` entire — a tracked file under `.claude/` is this
# tree's own, and a clone of it is a finding like any other.
#
# `**/src/generated/**` is there because nobody edits it. This rule exists so a
# reader who finds two copies of a thing has one place to change it; over
# emitted output there is one place already — the emitter — and the repetition
# is the emitter saying the same thing about several types. The emitter itself
# is NOT exempt, and a clone inside it is a finding like any other, which is
# where a reader who wants the repetition gone would have to go anyway.
#
# The version is pinned exactly in package.json: config semantics move within
# the major, `ignorePattern` matching among them.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-duplication: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if [ ! -x ./node_modules/.bin/jscpd ]; then
	echo "check-duplication: LINTER ERROR — no local jscpd. Install with \`npm ci\`."
	exit 2
fi
RUN="./node_modules/.bin/jscpd"

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

set +e
# shellcheck disable=SC2086
$RUN --min-lines 10 --min-tokens 80 --threshold 0 --reporters console . > "$out" 2>&1
rc=$?
set -e

if ! grep -qE "Found [0-9]+ clones|No duplicates found" "$out"; then
	echo "check-duplication: LINTER ERROR — jscpd produced no verdict (rc=$rc):"
	sed 's/^/    /' "$out"
	exit 2
fi

if [ "$rc" -ne 0 ]; then
	sed 's/^/    /' "$out"
	echo "check-duplication: clones found. Extract the shared part, or mark the"
	echo "    region with \`jscpd:ignore-start\` AND a reason on that line."
	exit 1
fi

# What jscpd analyzed, off its own table. The console reporter colours its
# output unconditionally, so the escapes come off before anything reads for
# digits; the colon is what separates the `Total:` row from the `Total lines`
# and `Total tokens` labels beside it. A table this cannot read is a scan whose
# size is unknown, which is the could-not-run above rather than a figure.
scanned="$(awk '{ gsub(/\033\[[0-9;]*m/, "") }
/Total:/ { sub(/^[^0-9]*/, ""); sub(/[^0-9].*$/, ""); print; exit }' "$out")"
if [ -z "$scanned" ] || [ "$scanned" -eq 0 ]; then
	echo "check-duplication: LINTER ERROR — the scan measured nothing; check"
	echo "    \`.jscpd.json\`'s ignorePattern and that the corpus is where it looked:"
	sed 's/^/    /' "$out"
	exit 2
fi
echo "check-duplication: no clones ($scanned files)"
