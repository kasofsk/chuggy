#!/bin/sh
# Shell test for check-duplication.sh.
#
# The cases that matter are the refusals. A clone is easy to detect and the tool
# does it; what this suite pins is that a run which measured nothing — no local jscpd,
# no verdict, or a verdict over an empty scan — reports could-not-run.
#
# Run:  .chug/tasks/check-duplication.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_suite.sh"
SUT="$HERE/check-duplication.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

R="$WORK/repo"
BIN="$WORK/bin"
mkdir -p "$BIN"
for t in git mktemp grep sed rm awk; do ln -sf "$(command -v "$t")" "$BIN/$t"; done

# The stub prints with `%b` so a case can hand it a whole report; printf rather
# than cat because the restricted PATH below has no coreutils.
stub_repo() { # <jscpd exit> <jscpd stdout>
	fresh_repo "$R"
	mkdir -p "$R/node_modules/.bin"
	printf '#!/bin/sh\nprintf "%%b\\n" "%s"\nexit %s\n' "$2" "$1" \
		> "$R/node_modules/.bin/jscpd"
	chmod +x "$R/node_modules/.bin/jscpd"
	printf 'placeholder\n' > "$R/README.md"
	git -C "$R" add -A
}

run_in_repo() {
	set +e
	(cd "$R" && PATH="$BIN" "$SUT") > "$OUT" 2>&1
	RC=$?
	set -e
}

stub_repo 0 "Found 0 clones.\nTotal:            7      420     3600      0"
run_in_repo
check "no clones exits 0" 0 "$RC" "no clones (7 files)"

# A gate that only says no teaches people to disable it, so the finding names
# the escape hatch.
stub_repo 1 "Found 2 clones."
run_in_repo
check "clones exit 1" 1 "$RC" "clones found"
check "the finding names the ignore directive" 1 "$RC" "jscpd:ignore-start"

# THE LOAD-BEARING CASES: a run that measured nothing. Calling any of these
# either "clean" or "duplication" would be equally wrong.
stub_repo 1 "npm ERR! network request failed"
run_in_repo
check "no verdict in the output exits 2, not 1" 2 "$RC" "produced no verdict"

stub_repo 0 "some unrelated chatter"
run_in_repo
check "a silent success exits 2, not 0" 2 "$RC" "produced no verdict"

# The shape a mis-scoped ignorePattern takes: a real verdict, over nothing.
stub_repo 0 "Found 0 clones.\nTotal:            0        0        0      0"
run_in_repo
check "a verdict over an empty scan exits 2, not 0" 2 "$RC" "the scan measured nothing"

stub_repo 0 "Found 0 clones.\nnothing that parses as a table"
run_in_repo
check "an unreadable table exits 2, not 0" 2 "$RC" "the scan measured nothing"

fresh_repo "$R"
printf 'placeholder\n' > "$R/README.md"
git -C "$R" add -A
run_in_repo
check "no local jscpd exits 2" 2 "$RC" "no local jscpd"

# --- The ignore list, against the real tool ----------------------------------
#
# A stub ignores whatever the stub was told to ignore, so the scope needs the
# real jscpd and this repo's own `.jscpd.json` rather than an invented one: a
# pattern misspelled, or one the matcher reads differently than its author did,
# reads exactly like a pattern that works.
#
# It is a pair because the first half is the control. Scanned with no config the
# nested copy IS a clone, and without that an ignore list excluding the whole
# tree would pass. The count on the clean line is asserted off the same run, for
# the same reason: excluding the copy and excluding everything both print "no
# clones", and only the figure beside it says which happened.
#
# The parts are distinct from each other and each clears jscpd's token floor,
# which is what a file must do to be analyzed at all. The nested checkout is a
# plain directory rather than a real `git worktree` — jscpd reads the filesystem
# and never asks git, so the copy is the whole of what it sees.

nested_repo() { # <dir> <parts>
	fresh_repo "$1"
	mkdir -p "$1/.chug/tasks" "$1/.claude/worktrees/w/.chug/tasks" \
		"$1/node_modules/.bin"
	ln -s "$ROOT/node_modules/.bin/jscpd" "$1/node_modules/.bin/jscpd"
	p=1
	while [ "$p" -le "$2" ]; do
		i=0
		{
			printf '%s\n' '#!/bin/sh'
			while [ "$i" -lt 40 ]; do
				printf 'printf "%%s\\n" "harness %s, step %s"\n' "$p" "$i"
				i=$((i + 1))
			done
		} > "$1/.chug/tasks/thing$p.sh"
		cp "$1/.chug/tasks/thing$p.sh" \
			"$1/.claude/worktrees/w/.chug/tasks/thing$p.sh"
		p=$((p + 1))
	done
	# Untracked in the parent, which is what a checkout under it actually is.
	git -C "$1" add .chug
}

# The ambient PATH, unlike the stub cases: the real tool has to be reachable.
run_unstubbed() { # <dir>
	set +e
	(cd "$1" && "$SUT") > "$OUT" 2>&1
	RC=$?
	set -e
}

N="$WORK/nested"
nested_repo "$N" 3
run_unstubbed "$N"
check "the control: a nested copy is a clone when nothing excludes it" 1 "$RC" "clones found"

cp "$ROOT/.jscpd.json" "$N/.jscpd.json"
run_unstubbed "$N"
check "this tree's ignore list excludes a nested checkout" 0 "$RC" "no clones"
check "the clean line counts the scan, not the directory" 0 "$RC" "no clones (3 files)"

set +e
(cd "$WORK" && "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-duplication.test.sh"
