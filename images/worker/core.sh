#!/bin/sh
# The worker core: kasofsk/chuggy-common at the commit `core.json` pins,
# refused unless that commit is on the core's main. The image's `core` stage
# fetches it here, and `scripts/session-resume-drill.sh` fetches it here too.
#
# A BUMP IS NOT A BUILD. `just bump-worker-core` moves the pin through the
# same refusals as a fetch, and refuses a lock that installs no contract release
# or a zod other than the Dockerfile's `ZOD_VERSION`. The lock's asset URL and
# digest, the asset's bytes against them, the core's suites on the image's Node
# and the probes are held by the build alone, so a pin written here can still be
# one the build refuses.
#
# THE PIN IS A COMMIT, AND MAIN IS READ ONLY TO REFUSE. A commit id is the hash
# of what it names, so the checkout is held to it; main is fetched whole, and a
# commit it does not contain is work nobody merged there. No branch's name ever
# selects what is checked out.
#
# Usage:
#   images/worker/core.sh fetch <dir>     the pinned core, checked out into <dir>
#   images/worker/core.sh bump <commit>   `core.json` moved to <commit>, with the
#                                         contract release its lock installs
#
# Env:
#   CHUG_WORKER_CORE_REPOSITORY   where the core is fetched from; chuggy-common
#                                 unless a suite names a fixture
#
# Exits 0 done, 1 refused, 2 when it could not run: a usage error, or a
# repository, a file or a tool that did not answer.
set -eu
export LC_ALL=C

here="$(cd "$(dirname "$0")" && pwd)"
pin="$here/core.json"
repository="${CHUG_WORKER_CORE_REPOSITORY:-https://github.com/kasofsk/chuggy-common}"

refuse() {
	echo "core: $*" >&2
	exit 1
}

broken() {
	echo "core: could not run — $*" >&2
	exit 2
}

usage() {
	echo "usage: $0 fetch <dir> | bump <commit>" >&2
	exit 2
}

# The commit checked out into a directory that does not exist yet.
core_fetch() { # <dir> <commit>
	dir="$1"
	commit="$2"
	printf '%s\n' "$commit" | grep -Eqx '[0-9a-f]{40}' ||
		refuse "$commit is not a full commit id"
	[ ! -e "$dir" ] || refuse "$dir already exists"
	git init --quiet "$dir" || broken "could not create $dir"
	git -C "$dir" fetch --quiet --no-tags "$repository" "+refs/heads/main:refs/remotes/core/main" ||
		broken "could not fetch main from $repository"
	git -C "$dir" fetch --quiet --no-tags "$repository" "$commit" ||
		refuse "$commit is not a commit $repository serves"
	git -C "$dir" -c advice.detachedHead=false checkout --quiet --detach FETCH_HEAD ||
		broken "could not check out $commit"
	head="$(git -C "$dir" rev-parse HEAD)" || broken "could not read the checkout's commit"
	[ "$head" = "$commit" ] || refuse "the checkout is $head, not $commit"
	ancestor=0
	git -C "$dir" merge-base --is-ancestor "$commit" refs/remotes/core/main || ancestor=$?
	case "$ancestor" in
	0) ;;
	1) refuse "$commit is not on the main of $repository" ;;
	*) broken "could not compare $commit with main" ;;
	esac
}

core_bump() { # <commit>
	zod_image="$(sed -n 's/^ARG ZOD_VERSION=//p' "$here/Dockerfile")" ||
		broken "could not read $here/Dockerfile"
	[ -n "$zod_image" ] || broken "$here/Dockerfile pins no ZOD_VERSION"
	work="$(mktemp -d)" || broken "could not make a directory to fetch into"
	trap 'rm -rf "$work"' EXIT
	core_fetch "$work/core" "$1"
	lock="$work/core/package-lock.json"
	[ -f "$lock" ] || refuse "the core at $1 has no lock"
	locked="$(node -p '
		const packages = require(process.argv[1]).packages ?? {};
		`${packages["node_modules/@chuggy/worker-contract"]?.version} ${packages["node_modules/zod"]?.version}`;
	' "$lock")" || broken "could not read the lock at $1"
	release="${locked% *}"
	zod="${locked#* }"
	printf '%s\n' "$release" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+' ||
		refuse "the lock at $1 installs no contract release"
	[ "$zod" = "$zod_image" ] ||
		refuse "the lock at $1 installs zod $zod and the image installs $zod_image"
	printf '{\n  "commit": "%s",\n  "contractRelease": "%s"\n}\n' "$1" "$release" >"$pin" ||
		broken "could not write $pin"
	echo "core: $1, contract $release; the worker image needs a build and a rollout"
}

case "${1:-}" in
fetch)
	[ "$#" -eq 2 ] || usage
	commit="$(node -p 'require(process.argv[1]).commit' "$pin")" || broken "could not read $pin"
	core_fetch "$2" "$commit"
	echo "core: $commit checked out into $2"
	;;
bump)
	[ "$#" -eq 2 ] || usage
	core_bump "$2"
	;;
*) usage ;;
esac
