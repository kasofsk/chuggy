#!/bin/sh
# Shell test for check-duplication.sh.
#
# The cases that matter are the refusals. A clone is easy to detect and the
# tool does it; what this suite pins is that a run which measured NOTHING —
# no jscpd, no verdict in the output — reports could-not-run rather than
# "clean", because a fetch failure looking like a pass is the way this gate
# stops being one.
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

stub_repo() { # <jscpd exit> <jscpd stdout>
	fresh_repo "$R"
	mkdir -p "$R/node_modules/.bin"
	# printf, not cat: the restricted PATH below has no coreutils, and a stub
	# that needs them would fail for a reason unrelated to the gate.
	printf '#!/bin/sh\nprintf "%%s\\n" "%s"\nexit %s\n' "$2" "$1" \
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

# 1. A clean verdict is clean.
stub_repo 0 "Found 0 clones."
run_in_repo
check "no clones exits 0" 0 "$RC" "no clones"

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

# 5. No jscpd and no npx at all -> could not run.
fresh_repo "$R"
printf 'placeholder\n' > "$R/README.md"
git -C "$R" add -A
run_in_repo
check "no jscpd and no npx exits 2" 2 "$RC" "no jscpd and no npx"

# --- The ignore list, against the real tool ----------------------------------
#
# The cases above stub jscpd, which is right for the gate's own contract and
# useless for its scope: what a stub ignores is whatever the stub was told to
# ignore. `.jscpd.json` is a configuration, and a configuration demonstrates
# nothing about itself — a pattern misspelled, or one the tool's own matcher
# reads differently than its author did, reads exactly like a pattern that
# works. So the pair below runs the real jscpd, and the fixture COPIES this
# repo's config rather than inventing one, on check-source.test.sh's argument:
# an invented config passes while this tree's is broken.
#
# It is a pair because the first half is the control. Scanned with no config the
# nested copy IS a clone, which is what makes the second half mean something —
# without it, an ignore list that excluded the whole tree would pass.
#
# THE COUNT ON THE CLEAN LINE IS ASSERTED HERE, off the same run, because it is
# what tells those two apart: excluding the copy and excluding everything both
# print "no clones", and only the figure beside it says which happened. The
# fixture is built to a size this case knows and the parent holds half of it,
# so an expression reading a directory rather than the scan gets the wrong
# answer as surely as one reading the wrong cell. That figure went unasserted
# once and printed the digits inside the reporter's colour escape for every
# tree it ever saw, while the verdict beside it stayed right.
#
# The parts are distinct from each other and each clears jscpd's token floor,
# which is what a file must do to be analyzed at all: a short one is not
# counted, and a fixture of short files is a fixture of a size the tool
# disagrees with.
#
# The nested checkout is a plain directory rather than a real `git worktree`.
# jscpd reads the filesystem and never asks git, so the copy is the whole of
# what it sees, and a suite that had to add a worktree would have to remove one.
# The gate itself runs before the suites and fetches jscpd if it must, so this
# is a cached tool by the time it is reached.

nested_repo() { # <dir> <parts>
	fresh_repo "$1"
	mkdir -p "$1/.chug/tasks" "$1/.claude/worktrees/w/.chug/tasks"
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

# 6. Outside a git checkout -> could not run.
set +e
(cd "$WORK" && "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-duplication.test.sh"
