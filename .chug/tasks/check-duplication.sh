#!/bin/sh
# Copy-paste detection at threshold 0: no clone of the size `.jscpd.json` sets,
# anywhere, ever.
#
# WHY ZERO AND NOT A BUDGET. A duplication allowance is an allowance somebody
# spends, and the second copy of anything is where the two start disagreeing.
# Zero is the only threshold that needs no argument at each violation.
#
# TESTS ARE IN SCOPE, deliberately. The usual argument for excluding them — "a
# test should read top to bottom as the scenario it is" — is a good one, and it
# protects a test's SCENARIO. What the suites here were actually sharing was
# HARNESS: a `check` helper, a temp dir, a trap, two counters, growing with
# every gate. That is what `_suite.sh` is, and extracting it cost no case its
# readability. Where a genuine scenario must repeat, mark the region with
# `jscpd:ignore-start` and a reason on the directive line rather than widening
# the ignore list.
#
# A NESTED CHECKOUT IS NOT A CLONE, and `**/.claude/worktrees/**` in the ignore
# list is what says so. This repo's own tooling puts a git worktree there, and a
# worktree is a second copy of the tree at a different commit: scanned, every
# file pairs against its own copy and the gate reports each pair as duplication.
# A verdict whose only remedy is deleting the checkout somebody is working in is
# a verdict nobody can act on, and a gate that is red for a reason nobody can
# act on is a gate that gets bypassed.
#
# THE ENTRY IS THAT PATH AND NOT `.claude/` ENTIRE, which is where this list
# parts company with `.prettierignore`. The formatter skips the whole directory
# because a harness config is not this tree's file to format, and that argument
# does not reach here: a TRACKED file under `.claude/` is this tree's own, and a
# clone of it is a finding like any other. Excluding the directory would exempt
# code nobody has written yet, against a failure nobody can name. What is out of
# scope is the copy, not the address.
#
# `.jscpd.json` is JSON and carries no comments, so its ignore list is argued
# here or nowhere.
#
# THE VERSION IS PINNED EXACTLY, never `@5`. jscpd v5 is a Rust rewrite of v4
# with different config semantics, and 5.0.4 -> 5.0.5 changed how ignorePattern
# matches — a floating major silently changes what the gate can see. A local
# binary wins over anything on PATH, because a verdict that depends on which
# copy happens to be installed is not a verdict.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run — and a fetch failure
# must never read as "no duplication", which is why the output is checked for a
# verdict rather than the exit code being trusted alone.
set -eu
export LC_ALL=C

JSCPD_VERSION="5.0.5"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-duplication: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

if [ -x ./node_modules/.bin/jscpd ]; then
	RUN="./node_modules/.bin/jscpd"
elif command -v npx > /dev/null 2>&1; then
	RUN="npx --yes jscpd@$JSCPD_VERSION"
else
	echo "check-duplication: LINTER ERROR — no jscpd and no npx to fetch one"
	exit 2
fi

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

set +e
# shellcheck disable=SC2086
$RUN --min-lines 10 --min-tokens 80 --threshold 0 --reporters console . > "$out" 2>&1
rc=$?
set -e

# A run that produced no verdict did not measure anything — a network failure
# exits non-zero with no findings, and reporting that as duplication would be
# as wrong as reporting it as clean.
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

# THE COUNT SAYS THE RUN MEASURED SOMETHING, which is the only reason a clean
# line carries a figure at all: "no clones" over an empty scan and "no clones"
# over the tree read identically without it, and an ignore list that matched
# everything is a way this gate stops being one. So the figure is asserted —
# `check-duplication.test.sh` scans a fixture of a known size and requires this
# line to report it. It went unasserted once and printed the same wrong number
# for every tree it ever saw, which is the shape the standing commitment names:
# a success line believed once and never checked again.
#
# THE ESCAPES COME OFF FIRST. The console reporter colours its output
# unconditionally — not being a TTY makes no difference, and neither does
# NO_COLOR — so a pattern that skips non-digits to reach a number reaches the
# digits inside the colour escape instead, and reports those. The figure is in
# the `Total:` row: the header carries the column labels and no value, and the
# colon is what separates that row from the `Total lines` and `Total tokens`
# labels beside it. It counts what jscpd analyzed rather than what is on disk —
# a file under the token floor is neither — and an unreadable table prints as
# unknown rather than as a number nothing stands behind.
scanned="$(awk '{ gsub(/\033\[[0-9;]*m/, "") }
/Total:/ { sub(/^[^0-9]*/, ""); sub(/[^0-9].*$/, ""); print; exit }' "$out")"
echo "check-duplication: no clones (${scanned:-?} files)"
