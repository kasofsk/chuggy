#!/bin/sh
# Build the images under `images/` and put them where the rig's kubelet will
# find them. The rig has no registry, and on a single-node k3s it does not need
# one: the kubelet reads the node's own containerd, and an archive imported
# there is an image already present, which `imagePullPolicy: IfNotPresent`
# never tries to fetch.
#
# THE TAG NAMES A COMMIT AND MUST NOT LIE ABOUT ONE. A build context is the
# working tree, not HEAD, so a tag derived from HEAD over a dirty tree names a
# commit the image is not built from — and the manifests in chuggy-fabric
# reference these images by that tag. So a dirty tree is refused, and
# `CHUG_IMAGE_TAG` is how a build says out loud that it is naming something
# else.
#
# THE READ-BACK IS THE VERDICT, not the import's exit status. `docker save` and
# the import are two commands with a file between them rather than a pipeline,
# because a pipeline's status is its last command's and an import handed
# nothing succeeds at importing nothing. Then the node is asked which
# references it holds, because that — and not either status — is what the
# kubelet will consult.
#
# WHAT IT DOES NOT DO. It deploys nothing: the Deployments, Services and probes
# live in chuggy-fabric and reference these tags. It removes no earlier tag
# from the node either, so a rollback target stays where it was until someone
# takes it away. `deploy/rig/images/README.md` is the procedure and says what
# each half is and is not evidence of.
#
# Usage:
#   deploy/rig/images/build-and-import.sh api
#   deploy/rig/images/build-and-import.sh api web
#
# Env:
#   CHUG_IMAGE_TAG      the tag to build and import. Default: the short commit
#                       of HEAD, refused when the working tree is dirty.
#   CHUG_IMAGE_PREFIX   the repository prefix. Default `chuggy.invalid`, which
#                       is a name no resolver will ever answer, so an image
#                       missing from the node fails loudly instead of pulling
#                       whatever stands at that name on Docker Hub.
#   CHUG_WEB_SITE       the repository-relative directory whose contents become
#                       the web image's document root. Required by `web`, and
#                       it has no default: this serves what it is pointed at.
#   CHUG_RIG_SSH        the ssh destination of the k3s node. Unset, the import
#                       runs against this host's own containerd.
#
# Exits 0 clean, 1 when a build or an import did not land, 2 when it could not
# run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "build-and-import: LINTER ERROR — not a git checkout, so there is no commit to tag with" >&2
	exit 2
fi
cd "$root" || exit 2

if [ "$#" -eq 0 ]; then
	echo "build-and-import: LINTER ERROR — name at least one image; each is a directory under images/"
	exit 2
fi

for name in "$@"; do
	if [ ! -f "images/$name/Dockerfile" ]; then
		echo "build-and-import: LINTER ERROR — images/$name/Dockerfile is not there, so $name is not an image this tree builds"
		exit 2
	fi
	if [ "$name" = "web" ]; then
		if [ -z "${CHUG_WEB_SITE:-}" ]; then
			echo "build-and-import: LINTER ERROR — CHUG_WEB_SITE must name the directory whose contents the web image serves"
			exit 2
		fi
		if [ ! -d "$CHUG_WEB_SITE" ]; then
			echo "build-and-import: LINTER ERROR — CHUG_WEB_SITE names $CHUG_WEB_SITE, which is not a directory in this checkout"
			exit 2
		fi
	fi
done

command -v docker >/dev/null 2>&1 || {
	echo "build-and-import: LINTER ERROR — no \`docker\` on PATH, so nothing was built"
	exit 2
}

tag="${CHUG_IMAGE_TAG:-}"
if [ -z "$tag" ]; then
	if [ -n "$(git status --porcelain)" ]; then
		echo "build-and-import: LINTER ERROR — the working tree is dirty, so a tag taken from HEAD would name a commit these images are not built from"
		echo "build-and-import:                Commit, or set CHUG_IMAGE_TAG to a name that claims nothing about a commit."
		exit 2
	fi
	tag="$(git rev-parse --short HEAD)"
fi
prefix="${CHUG_IMAGE_PREFIX:-chuggy.invalid}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The node, whether it is this host or one reached over ssh. Every word passed
# here is a fixed one from this script, so joining them for the remote shell
# changes nothing.
on_node() { # <command-word>...
	if [ -n "${CHUG_RIG_SSH:-}" ]; then
		ssh "$CHUG_RIG_SSH" "$@"
	else
		"$@"
	fi
}

failed=0

for name in "$@"; do
	reference="$prefix/$name:$tag"
	archive="$work/$name.tar"
	echo "--- $reference"

	set +e
	if [ "$name" = "web" ]; then
		docker build -f "images/$name/Dockerfile" --build-arg "site=$CHUG_WEB_SITE" -t "$reference" .
	else
		docker build -f "images/$name/Dockerfile" -t "$reference" .
	fi
	built=$?
	set -e
	if [ "$built" -ne 0 ]; then
		echo "build-and-import: FAILED — $reference did not build"
		failed=$((failed + 1))
		continue
	fi

	set +e
	docker save -o "$archive" "$reference"
	saved=$?
	set -e
	if [ "$saved" -ne 0 ] || [ ! -s "$archive" ]; then
		echo "build-and-import: FAILED — $reference produced no archive, so there is nothing to import"
		failed=$((failed + 1))
		continue
	fi

	set +e
	on_node sudo k3s ctr --namespace k8s.io images import - <"$archive"
	set -e

	set +e
	present="$(on_node sudo k3s ctr --namespace k8s.io images ls -q)"
	set -e
	if printf '%s\n' "$present" | grep -Fqx "$reference"; then
		echo "build-and-import: the node holds $reference"
	else
		echo "build-and-import: FAILED — the node does not list $reference, whatever the import said"
		failed=$((failed + 1))
	fi
done

if [ "$failed" -gt 0 ]; then
	echo "build-and-import: $failed image(s) did not reach the node"
	exit 1
fi
echo "build-and-import: every image named on this run is on the node at tag $tag"
