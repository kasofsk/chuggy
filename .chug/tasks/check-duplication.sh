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
# THE VERSION IS PINNED EXACTLY, never `@5`. jscpd v5 is a Rust rewrite of v4
# with different config semantics, and 5.0.4 -> 5.0.5 changed how ignorePattern
# matches — a floating major silently changes what the gate can see. A local
# binary wins over anything on PATH, because a verdict that depends on which
# copy happens to be installed is not a verdict.
#
# THE FILE COUNT IS READ FROM THE REPORT'S TOTAL ROW, and the escape codes are
# stripped before anything is parsed. The count used to be scraped from the
# table header with a regex that ran into a colour escape and stopped there, so
# it reported the escape's own digits: the same number on every tree, on every
# host, whatever was scanned. It looked like a measurement and was a constant.
# A count of zero, or one this gate cannot parse, is now a could-not-run under
# the same policy as a missing verdict below — a corpus an `ignorePattern` edit
# has collapsed to nothing reports "no clones" truthfully and means nothing by
# it, and that is precisely the reading this gate must not offer.
#
# WHAT IT CANNOT SEE. The detector has a floor — the `--min-lines` and
# `--min-tokens` arguments below — and a clone shorter than that floor is
# invisible to it however many times it is pasted. A short shared helper
# duplicated across every suite is exactly that shape: `_suite.sh` exists
# because a reviewer noticed one, not because this gate did, and the next one
# will be caught the same way. Nor does it see a clone that has been edited
# apart since it was pasted, which is the state every clone reaches eventually
# and the reason the threshold is zero rather than a budget.
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

raw="$(mktemp)"
out="$(mktemp)"
trap 'rm -f "$raw" "$out"' EXIT

set +e
# shellcheck disable=SC2086
$RUN --min-lines 10 --min-tokens 80 --threshold 0 --reporters console . > "$raw" 2>&1
rc=$?
set -e

# The console reporter colours its table whether or not a human is watching,
# and every parse below reads the plain text. The escape is spelled with printf
# rather than written into the pattern, because the `\x` form is a GNU sed
# extension and the machine this runs on ships the other sed.
esc="$(printf '\033')"
sed "s/${esc}\[[0-9;]*m//g" "$raw" > "$out"

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

# The Total row, which the per-format rows above it sum into. A verdict of
# "clean" over a corpus this gate cannot show it read is no verdict at all.
scanned="$(sed -n 's/.*Total:[^0-9]*\([0-9][0-9]*\).*/\1/p' "$out" | tail -1)"
if [ -z "$scanned" ]; then
	echo "check-duplication: LINTER ERROR — no Total row in the report, so the"
	echo "    number of files scanned is unknown and \"no clones\" claims nothing:"
	sed 's/^/    /' "$out"
	exit 2
fi
if [ "$scanned" -eq 0 ]; then
	echo "check-duplication: LINTER ERROR — jscpd analyzed no files. Check the"
	echo "    \`ignorePattern\` in .jscpd.json: a corpus narrowed to nothing"
	echo "    reports no clones and has measured none."
	exit 2
fi

echo "check-duplication: no clones ($scanned files)"
