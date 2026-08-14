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

R="$WORK/repo"
BIN="$WORK/bin"
mkdir -p "$BIN"
for t in git mktemp grep sed rm; do ln -sf "$(command -v "$t")" "$BIN/$t"; done

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

# 6. Outside a git checkout -> could not run.
set +e
(cd "$WORK" && "$SUT") > "$OUT" 2>&1
RC=$?
set -e
check "outside a git checkout exits 2, not 0" 2 "$RC" "LINTER ERROR"

done_ "check-duplication.test.sh"
