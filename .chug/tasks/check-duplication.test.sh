#!/bin/sh
# Shell test for check-duplication.sh.
#
# The cases that matter are the refusals. A clone is easy to detect and the
# tool does it; what this suite pins is that a run which measured NOTHING —
# no jscpd, no verdict in the output, no files in the report — reports
# could-not-run rather than "clean", because a fetch failure looking like a
# pass is the way this gate stops being one.
#
# THE STUBS EMIT A REAL REPORT, COLOUR CODES AND ALL, and that is the case this
# file was missing. Every stub here used to print one bare clones line, so the
# gate's parse of the report table was driven by nothing — and the parse was
# wrong: it ran into a colour escape and reported the escape's digits as the
# file count, identically on every tree and every host. A suite whose fixtures
# are tidier than the tool's real output tests the gate against a world that
# does not exist.
#
# Run:  .chug/tasks/check-duplication.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-duplication.sh"

R="$WORK/repo"
# Everything the gate reaches for EXCEPT npx, so the no-tool-at-all case has a
# fallback that genuinely cannot resolve.
BIN="$WORK/bin"
tools_only "$BIN" git mktemp grep sed tail rm cat

esc="$(printf '\033')"

stub_repo() { # <jscpd exit> <jscpd stdout>
	_rc="$1"
	shift
	fresh_repo "$R"
	mkdir -p "$R/node_modules/.bin"
	printf '%s\n' "$@" > "$R/report"
	# The gate cds to the repo root before running the tool, so the stub reads
	# its canned report by a path relative to that — the restricted PATH below
	# carries no `dirname` to resolve anything cleverer.
	printf '#!/bin/sh\ncat report\nexit %s\n' "$_rc" > "$R/node_modules/.bin/jscpd"
	chmod +x "$R/node_modules/.bin/jscpd"
	printf 'placeholder\n' > "$R/README.md"
	git -C "$R" add -A
}

# The console reporter's real shape: a summary line, a coloured table whose
# header carries the escape the old parse tripped over, a per-format row and a
# Total row, then the verdict. The box-drawing characters are written as pipes
# — the gate reads the digits, never the frame.
colored_report() { # <files-analyzed>
	cat <<REPORT
${esc}[90mNo duplicates found.${esc}[39m
${esc}[90m|${esc}[39m${esc}[31m Format     ${esc}[39m${esc}[90m|${esc}[39m${esc}[31m Files analyzed ${esc}[39m${esc}[90m|${esc}[39m${esc}[31m Total lines ${esc}[39m${esc}[90m|${esc}[39m
${esc}[90m|${esc}[39m bash       ${esc}[90m|${esc}[39m $1              ${esc}[90m|${esc}[39m 4175        ${esc}[90m|${esc}[39m
${esc}[90m|${esc}[39m ${esc}[1mTotal:${esc}[22m     ${esc}[90m|${esc}[39m $1              ${esc}[90m|${esc}[39m 4175        ${esc}[90m|${esc}[39m
${esc}[90mFound 0 clones.${esc}[39m
REPORT
}

run_in_repo() {
	set +e
	(cd "$R" && PATH="$BIN" "$SUT") > "$OUT" 2>&1
	RC=$?
	set -e
}

# 1. A clean verdict is clean, and the file count comes from the Total row.
#    The second assertion is the one the old scrape fails: it read the colour
#    escape that follows the table header and printed the escape's digits, so a
#    fixture without the colour codes would let it stay green.
stub_repo 0 "$(colored_report 7)"
run_in_repo
check "no clones exits 0" 0 "$RC" "no clones"
check "the file count is read from the Total row" 0 "$RC" "no clones (7 files)"

# 2. A clone is a finding, and the remedy names the escape hatch — a gate that
#    only says no teaches people to disable it.
stub_repo 1 "Found 2 clones."
run_in_repo
check "clones exit 1" 1 "$RC" "clones found"
check "the finding names the ignore directive" 1 "$RC" "jscpd:ignore-start"

# 3. THE LOAD-BEARING CASE: a run that produced no verdict measured nothing.
#    A network failure exits non-zero with no findings, and calling that either
#    "clean" or "duplication" would be equally wrong.
stub_repo 1 "npm ERR! network request failed"
run_in_repo
check "no verdict in the output exits 2, not 1" 2 "$RC" "produced no verdict"

# 4. And the same when the tool exits ZERO having said nothing — the shape a
#    silent pass would take.
stub_repo 0 "some unrelated chatter"
run_in_repo
check "a silent success exits 2, not 0" 2 "$RC" "produced no verdict"

# 5. A report that analyzed nothing is a could-not-run. An `ignorePattern` that
#    has narrowed the corpus to nothing says "no clones" perfectly truthfully
#    and means nothing by it — which is the one reading this gate must refuse.
stub_repo 0 "$(colored_report 0)"
run_in_repo
check "a report over no files exits 2, not 0" 2 "$RC" "analyzed no files"

# 6. And a report with no Total row at all: the verdict is there, the evidence
#    it was measured over anything is not.
stub_repo 0 "No duplicates found." "Found 0 clones."
run_in_repo
check "a report with no Total row exits 2, not 0" 2 "$RC" "no Total row"

# 7. No jscpd and no npx at all -> could not run.
fresh_repo "$R"
printf 'placeholder\n' > "$R/README.md"
git -C "$R" add -A
run_in_repo
check "no jscpd and no npx exits 2" 2 "$RC" "no jscpd and no npx"

# 8. Outside a git checkout -> could not run.
set +e
(cd "$WORK" && "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-duplication.test.sh"
