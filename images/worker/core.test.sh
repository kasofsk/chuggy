#!/bin/sh
# Shell test for core.sh, against a repository this suite builds: its main
# holds a commit with no lock, then one whose lock installs no contract, then
# two releases, then a release on a zod the image does not install; a branch off
# main holds a commit nobody merged, and a tag names a release by an object that
# is not a commit.
# The script runs from a copy beside a `core.json` and a Dockerfile of the
# suite's own, so the tree's pin is never moved.
#
# EACH REFUSAL HAS A MIRROR. A guard that refuses everything reads exactly like
# one that works, so an ancestor of main that is not its tip is fetched and
# bumped to as well.
#
# Run:  images/worker/core.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../.chug/tasks/_suite.sh"

CORE="$WORK/core.git"
SCRIPT="$WORK/worker/core.sh"
PIN="$WORK/worker/core.json"
FETCHED="$WORK/fetched"
mkdir -p "$WORK/worker"
cp "$HERE/core.sh" "$SCRIPT"
printf 'ARG ZOD_VERSION=4.5.4\n' >"$WORK/worker/Dockerfile"

commit_lock() { # <release, or nothing for a lock without the contract> <zod> <message>
	if [ -n "$1" ]; then
		printf '{ "packages": { "node_modules/@chuggy/worker-contract": { "version": "%s" }, "node_modules/zod": { "version": "%s" } } }\n' "$1" "$2"
	else
		printf '{ "packages": { "node_modules/zod": { "version": "%s" } } }\n' "$2"
	fi >"$CORE/package-lock.json"
	git -C "$CORE" add -A
	git -C "$CORE" commit -qm "$3"
	git -C "$CORE" rev-parse HEAD
}

fresh_repo "$CORE"
printf 'the core, before it had a lock\n' >"$CORE/README"
git -C "$CORE" add -A
git -C "$CORE" commit -qm "no lock yet"
LOCKLESS="$(git -C "$CORE" rev-parse HEAD)"
UNRELEASED="$(commit_lock "" 4.5.4 "no contract yet")"
FIRST="$(commit_lock 1.0.0 4.5.4 "the first release")"
LATEST="$(commit_lock 1.2.0 4.5.4 "a later release")"
ZOD_MOVED="$(commit_lock 1.3.0 4.6.0 "a release on a later zod")"
git -C "$CORE" checkout -q -b unmerged "$FIRST"
UNMERGED="$(commit_lock 1.1.0 4.5.4 "never merged")"
git -C "$CORE" checkout -q main
git -C "$CORE" tag -a -m "the first release" first "$FIRST"
TAG="$(git -C "$CORE" rev-parse first)"
ABSENT=0123456789abcdef0123456789abcdef01234567

pin() { # <commit> <release>
	printf '{\n  "commit": "%s",\n  "contractRelease": "%s"\n}\n' "$1" "$2"
}

run() { # <args>...
	set +e
	CHUG_WORKER_CORE_REPOSITORY="${REPOSITORY:-$CORE}" sh "$SCRIPT" "$@" >"$OUT" 2>&1
	RC=$?
	set -e
}

fetch_at() { # <commit>
	rm -rf "$FETCHED"
	pin "$1" 1.0.0 >"$PIN"
	run fetch "$FETCHED"
}

# Byte for byte, because the file is committed in the formatter's shape.
pinned() { # <commit> <release>
	pin "$1" "$2" >"$WORK/expected"
	if cmp -s "$WORK/expected" "$PIN"; then
		echo "pinned $1 $2"
	else
		diff "$WORK/expected" "$PIN" || true
	fi >"$OUT"
}

# --- fetch -------------------------------------------------------------------

fetch_at "$FIRST"
check "an ancestor of main is fetched" 0 "$RC" "$FIRST checked out"
git -C "$FETCHED" rev-parse HEAD >"$OUT"
cat "$FETCHED/package-lock.json" >>"$OUT"
check "the checkout is the pinned commit" 0 0 "$FIRST"
check "and holds that commit's tree" 0 0 '"version": "1.0.0"'

run fetch "$FETCHED"
check "a directory that exists is refused" 1 "$RC" "already exists"

fetch_at "$UNMERGED"
check "a commit on a branch main does not contain is refused" 1 "$RC" "is not on the main of"

fetch_at "$ABSENT"
check "a commit the repository does not have is refused" 1 "$RC" "is not a commit"

fetch_at "$TAG"
check "an object that peels to a commit is refused, since the checkout is not it" 1 "$RC" \
	"the checkout is $FIRST, not $TAG"

rm -rf "$FETCHED"
pin "$FIRST" 1.0.0 >"$PIN"
REPOSITORY="$WORK/nowhere"
run fetch "$FETCHED"
unset REPOSITORY
check "a repository that does not answer is a could-not-run" 2 "$RC" "could not run — could not fetch main"

for name in main "$(printf '%s' "$FIRST" | cut -c1-12)" "$(printf '%s' "$FIRST" | tr a-f A-F)"; do
	fetch_at "$name"
	check "a pin that is not a full commit id is refused: $name" 1 "$RC" "is not a full commit id"
done

run fetch
check "fetch without a directory is a usage error" 2 "$RC" "usage:"

# --- bump --------------------------------------------------------------------

pin "$FIRST" 1.0.0 >"$PIN"
run bump "$LATEST"
check "a bump forward along main reports the release its lock installs" 0 "$RC" "contract 1.2.0"
pinned "$LATEST" 1.2.0
check "and writes both into the pin" 0 0 "pinned $LATEST 1.2.0"

run bump "$FIRST"
check "a bump back to an ancestor of main is written" 0 "$RC" "contract 1.0.0"

for refused in "$UNMERGED:is not on the main of" "$ABSENT:is not a commit" \
	"$LOCKLESS:has no lock" "$UNRELEASED:installs no contract release" \
	"main:is not a full commit id" \
	"$ZOD_MOVED:installs zod 4.6.0 and the image installs 4.5.4"; do
	run bump "${refused%%:*}"
	check "a bump is refused: ${refused#*:}" 1 "$RC" "${refused#*:}"
	pinned "$FIRST" 1.0.0
	check "and the pin is left as it was" 0 0 "pinned $FIRST 1.0.0"
done

printf 'FROM scratch\n' >"$WORK/worker/Dockerfile"
run bump "$LATEST"
check "a Dockerfile that pins no zod is a could-not-run" 2 "$RC" "pins no ZOD_VERSION"
pinned "$FIRST" 1.0.0
check "and the pin is left as it was" 0 0 "pinned $FIRST 1.0.0"

done_ "core.test.sh"
