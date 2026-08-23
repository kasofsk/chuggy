#!/bin/sh
# Shell test for build-and-import.sh, over what it names and no more: the
# arguments it will and will not accept, the tag it derives and what it refuses
# to derive one from, the build argument the web image cannot be built without,
# and the read-back that stands between an import's exit status and the claim
# that the node holds the image.
#
# WHY IT IS A SUITE AND NOT A RIG RUN. Every refusal here is one whose absence
# reads as agreement: a dirty tree tagged with a commit it is not built from, an
# empty archive imported successfully because importing nothing succeeds, a
# reference the node never took. A rig run says these hold on the day it is run
# and costs a cluster; a suite stops the shape coming back and costs the same as
# every other suite `.chug/tasks/ci.sh` discovers.
#
# NOTHING HERE BUILDS OR REACHES A CLUSTER. `docker`, `k3s`, `sudo` and `ssh`
# are stubs on PATH that log every invocation, and the subject is a throwaway
# repository with empty Dockerfiles in it, so a stub that was missed would build
# nothing and import it nowhere.
#
# THE MIRROR CASES MATTER AS MUCH. A guard that refuses everything is the same
# defect wearing the other face, so each refusal has a case where the thing
# being checked is there and the run goes on.
#
# Run:  ./deploy/rig/images/build-and-import.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../../.chug/tasks/_suite.sh"
SUT="$HERE/build-and-import.sh"

BIN="$WORK/bin"
NOBIN="$WORK/nobin"
REPO="$WORK/repo"
LOG="$WORK/calls.log"
PRESENT="$WORK/present"
mkdir -p "$BIN" "$NOBIN"

# The one PATH with no builder on it. Only what the script reaches before it
# looks for one goes here: the shell it re-enters and the git it asks for the
# checkout's root.
ln -s "$(command -v git)" "$NOBIN/git"
ln -s "$(command -v sh)" "$NOBIN/sh"

cat > "$BIN/docker" << 'STUB'
#!/bin/sh
set -u
{
	printf '%s' "$*" | tr '\n' ' '
	printf '\n'
} >> "$CHUG_STUB_LOG"
case "${1:-}" in
build) exit "${CHUG_STUB_BUILD_RC:-0}" ;;
save)
	out=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-o)
			out="${2:-}"
			shift
			;;
		esac
		shift
	done
	[ -n "$out" ] || exit 1
	if [ "${CHUG_STUB_EMPTY_SAVE:-0}" = "1" ]; then
		: > "$out"
	else
		printf 'an archive\n' > "$out"
	fi
	;;
esac
exit 0
STUB

cat > "$BIN/k3s" << 'STUB'
#!/bin/sh
set -u
{
	printf '%s' "$*" | tr '\n' ' '
	printf '\n'
} >> "$CHUG_STUB_LOG"
case " $* " in
*' images import '*)
	cat > /dev/null
	exit "${CHUG_STUB_IMPORT_RC:-0}"
	;;
*' images ls '*) cat "$CHUG_STUB_PRESENT" ;;
esac
exit 0
STUB

# `sudo` and `ssh` are transparent: each records that it was reached and then
# runs what it was handed, so a case can say which of them stood in the way
# without any of them deciding anything.
cat > "$BIN/sudo" << 'STUB'
#!/bin/sh
set -u
printf 'sudo %s\n' "$*" >> "$CHUG_STUB_LOG"
exec "$@"
STUB

cat > "$BIN/ssh" << 'STUB'
#!/bin/sh
set -u
printf 'ssh to %s\n' "$1" >> "$CHUG_STUB_LOG"
shift
exec "$@"
STUB

chmod +x "$BIN/docker" "$BIN/k3s" "$BIN/sudo" "$BIN/ssh"

fresh_repo "$REPO"
mkdir -p "$REPO/images/api" "$REPO/images/web" "$REPO/deploy/rig/images" "$REPO/site"
: > "$REPO/images/api/Dockerfile"
: > "$REPO/images/web/Dockerfile"
: > "$REPO/site/index.html"
cp "$SUT" "$REPO/deploy/rig/images/build-and-import.sh"
git -C "$REPO" add -A
git -C "$REPO" commit -qm fixture
HEAD_TAG="$(git -C "$REPO" rev-parse --short HEAD)"

fresh_case() {
	: > "$LOG"
	: > "$PRESENT"
	rm -f "$REPO/dirt"
	unset CHUG_IMAGE_TAG CHUG_WEB_SITE CHUG_RIG_SSH
	unset CHUG_STUB_BUILD_RC CHUG_STUB_EMPTY_SAVE CHUG_STUB_IMPORT_RC
}

run() { # <argument...>
	OUT="$WORK/.out"
	set +e
	(
		cd "$REPO" || exit 2
		PATH="$BIN:$PATH" CHUG_STUB_LOG="$LOG" CHUG_STUB_PRESENT="$PRESENT" \
			sh "$REPO/deploy/rig/images/build-and-import.sh" "$@"
	) > "$OUT" 2>&1
	RC=$?
	set -e
	printf 'tools reached: %s\n' "$(wc -l < "$LOG" | tr -d ' ')" >> "$OUT"
	printf 'builds attempted: %s\n' "$(grep -c '^build ' "$LOG" || true)" >> "$OUT"
	printf 'saves attempted: %s\n' "$(grep -c '^save ' "$LOG" || true)" >> "$OUT"
	printf 'imports attempted: %s\n' "$(grep -c '^ctr .*images import' "$LOG" || true)" >> "$OUT"
	echo "--- the calls, in order" >> "$OUT"
	cat "$LOG" >> "$OUT"
}

untouched="tools reached: 0"

# --- the arguments, refused while refusing is still free ---------------------

fresh_case
run
check "no image named is refused" 2 "$RC" "name at least one image"
check "no image named reaches no tool" 2 "$RC" "$untouched"

fresh_case
run scheduler
check "an image with no Dockerfile is refused" 2 "$RC" "is not an image this tree builds"
check "an unbuildable name reaches no tool" 2 "$RC" "$untouched"

# --- the web image's document root, which has no default ---------------------

fresh_case
run web
check "web without a site is refused" 2 "$RC" "CHUG_WEB_SITE must name"
check "web without a site reaches no tool" 2 "$RC" "$untouched"

fresh_case
export CHUG_WEB_SITE=nowhere
run web
check "web with a site that is not there is refused" 2 "$RC" "not a directory in this checkout"
check "web with an absent site reaches no tool" 2 "$RC" "$untouched"

# The mirror: the directory is there, so the build runs and carries it.
fresh_case
export CHUG_IMAGE_TAG=fixed
export CHUG_WEB_SITE=site
printf 'chuggy.invalid/web:fixed\n' > "$PRESENT"
run web
check "web builds with the site it was given" 0 "$RC" "build-arg site=site"
check "the web build is tagged for the node" 0 "$RC" "chuggy.invalid/web:fixed"

# The refusal is per named image and comes before any of them is built, so a run
# that names a buildable image alongside an unbuildable one builds neither.
fresh_case
run api web
check "an unsatisfiable image refuses the whole run" 2 "$RC" "CHUG_WEB_SITE must name"
check "an unsatisfiable image leaves its neighbour unbuilt" 2 "$RC" "$untouched"

# --- the tag, which the manifests will reference -----------------------------

fresh_case
printf 'dirt\n' > "$REPO/dirt"
run api
check "a dirty tree refuses to derive a tag" 2 "$RC" "the working tree is dirty"
check "a dirty tree reaches no tool" 2 "$RC" "$untouched"

fresh_case
printf 'dirt\n' > "$REPO/dirt"
export CHUG_IMAGE_TAG=named
printf 'chuggy.invalid/api:named\n' > "$PRESENT"
run api
check "a dirty tree builds under a tag that claims no commit" 0 "$RC" "chuggy.invalid/api:named"

fresh_case
printf '%s\n' "chuggy.invalid/api:$HEAD_TAG" > "$PRESENT"
run api
check "a clean tree derives the tag from HEAD" 0 "$RC" "chuggy.invalid/api:$HEAD_TAG"

fresh_case
export CHUG_IMAGE_PREFIX=example.test
printf 'example.test/api:%s\n' "$HEAD_TAG" > "$PRESENT"
run api
check "the prefix is the caller's to change" 0 "$RC" "example.test/api:$HEAD_TAG"
unset CHUG_IMAGE_PREFIX

# --- what stands between a status and the claim that the node holds it -------

fresh_case
export CHUG_STUB_BUILD_RC=1
run api
check "a build that failed is a finding" 1 "$RC" "did not build"
check "a build that failed is not saved" 1 "$RC" "saves attempted: 0"

# An import handed nothing succeeds at importing nothing, so the archive is
# weighed before it is offered to the node.
fresh_case
export CHUG_STUB_EMPTY_SAVE=1
run api
check "an empty archive is a finding" 1 "$RC" "produced no archive"
check "an empty archive is never imported" 1 "$RC" "imports attempted: 0"

# The import said nothing was wrong and the node lists nothing. The status is
# not the verdict; the read-back is.
fresh_case
export CHUG_IMAGE_TAG=fixed
run api
check "an import the node did not take is a finding" 1 "$RC" "the node does not list"
check "an import that took nothing was still attempted" 1 "$RC" "imports attempted: 1"

fresh_case
export CHUG_IMAGE_TAG=fixed
printf 'chuggy.invalid/api:fixed\n' > "$PRESENT"
run api
check "an import the node took is clean" 0 "$RC" "the node holds chuggy.invalid/api:fixed"

# A near miss rather than a miss: the node holds the repository under another
# tag, which a substring search would have accepted.
fresh_case
export CHUG_IMAGE_TAG=fixed
printf 'chuggy.invalid/api:fixed-1\n' > "$PRESENT"
run api
check "a different tag on the same repository is not a match" 1 "$RC" "the node does not list"

# --- where the node is -------------------------------------------------------

fresh_case
export CHUG_IMAGE_TAG=fixed
printf 'chuggy.invalid/api:fixed\n' > "$PRESENT"
run api
check "with no ssh destination the import is this host's" 0 "$RC" "sudo k3s ctr --namespace k8s.io images import -"

fresh_case
export CHUG_IMAGE_TAG=fixed
export CHUG_RIG_SSH=nobody@no-such-host
printf 'chuggy.invalid/api:fixed\n' > "$PRESENT"
run api
check "an ssh destination is where the import goes" 0 "$RC" "ssh to nobody@no-such-host"

# --- the tool that has to be there -------------------------------------------

fresh_case
OUT="$WORK/.out"
set +e
(
	cd "$REPO" || exit 2
	PATH="$NOBIN" CHUG_STUB_LOG="$LOG" CHUG_STUB_PRESENT="$PRESENT" \
		sh "$REPO/deploy/rig/images/build-and-import.sh" api
) > "$OUT" 2>&1
RC=$?
set -e
check "no builder on PATH could not run" 2 "$RC" "no \`docker\` on PATH"

done_ "build-and-import.test.sh"
