#!/bin/sh
# Move the rig to the commit this checkout is at. Without an option: gate it,
# build the images it changed, publish them to the rig's registry, and open the
# chuggy-fabric pull request that selects them. Under `--merge`: land the pull
# request that stands for HEAD and watch Flux roll it out.
#
# THE RIG FOLLOWS chuggy-fabric, NOT THIS REPOSITORY. Flux reconciles the
# fabric's application manifests, which name every image by registry digest
# and carry the source commit it was built from. Merging here deploys nothing;
# a release is a fabric commit that moves those digests, and this script is the
# whole of the path from a commit on main to that fabric commit.
#
# WHAT IS RELEASED IS HEAD, AND HEAD MUST BE ON MAIN. The tag is the short
# commit, which `deploy/rig/images/build-and-import.sh` refuses to derive from
# a dirty tree; and a commit main does not have is one the configuration
# importer, which tracks main, will never see. So a dirty tree and a HEAD off
# `origin/main` are both refused before anything is built.
#
# ONLY WHAT MOVED IS REBUILT. The fabric's manifests say which commit is live,
# and each image is rebuilt when a path its Dockerfile copies changed between
# that commit and HEAD. The realtime console is built by `images/chuggy-ui/`,
# which installs and bundles inside the image, so what it serves is a function
# of the commit and not of whichever Node and `node_modules` the host had; it
# is published under the `web` repository the fabric's consistency check
# requires of both consoles. An image that did not move keeps its digest, so
# its Deployment is not restarted for a release that changed nothing it
# serves. The worker image is not this script's — the fabric's own build
# system makes it and a separate change admits it — so a change under
# `images/worker/` is reported and not acted on.
#
# THE DIGEST IS READ BACK FROM THE REGISTRY, never taken from the build or the
# push: what a manifest names is what the registry answers for the tag, and a
# push whose status said nothing was wrong can still have left the previous
# build at the reference. A read-back that answers no well-formed digest is a
# finding, and nothing is edited on its strength.
#
# THE SOURCE COMMIT MOVES ON EVERY MANIFEST, changed image or not, and the
# migrate Job is renamed after it: the fabric's consistency check requires one
# source commit across the release and a Job named for it, and that check is
# run over the edited tree before anything is committed. An annotation is
# Deployment metadata, so a manifest whose digest did not move restarts
# nothing.
#
# `--merge` IS WHERE THE CLUSTER CHANGES, and it is a separate run so that a
# reviewer can read the pull request in between. It refuses while an attempt
# is live, because a rollout restarts the worker plane and drops a running
# attempt's heartbeats. When the release carries a migration it takes a dump
# first, into the directory the caller names — a ledger that has moved forward
# is not walked back by reverting the fabric commit, and the dump is the only
# way below it. Then it merges, asks Flux for the source and the applications
# through the annotation the flux client itself writes, waits for the migrate
# Job and every rollout, and requires each Deployment to run the image its
# manifest names.
#
# Usage:
#   deploy/rig/deploy-to-gtr.sh            gate, build, publish, open the PR
#   deploy/rig/deploy-to-gtr.sh --merge    merge HEAD's PR, reconcile, verify
#
# Env:
#   CHUG_RIG_SSH          the ssh destination of the k3s node. Required: the
#                         import and the push run on the node, and there is no
#                         node to guess.
#   CHUG_RIG_CONTEXT      kubectl context, default chuggy-fabric
#   CHUG_RIG_NAMESPACE    namespace holding the control plane, default chuggy
#   CHUG_RIG_DATABASE     the database the migrate Job moves, default chuggy
#   CHUG_RIG_ARCHIVE      where a pre-merge dump is kept. Required by --merge
#                         when the release carries a migration; no default.
#   CHUG_FABRIC_REPO      the fabric repository, default gdoteof/chuggy-fabric
#   CHUG_RELEASE_GATE     0 skips the full gate, and the pull request says so
#   CHUG_RELEASE_WAIT_SECS  how long --merge waits on each of Flux, the
#                         migrate Job and a rollout
#
# Exits 0 clean, 1 when something did not land, 2 when it could not run. Two
# is not a pass.
set -eu
export LC_ALL=C

say() { printf 'deploy-to-gtr: %s\n' "$*"; }
refuse() {
	printf 'deploy-to-gtr: LINTER ERROR — %s\n' "$*" >&2
	exit 2
}
fail() {
	printf 'deploy-to-gtr: FAILED — %s\n' "$*" >&2
	exit 1
}
# A step's own protocol is kept: one is a finding, anything else could not run.
leave_as() { # <status> <what>
	if [ "$1" -eq 1 ]; then fail "$2"; else refuse "$2"; fi
}

merge=0
for argument in "$@"; do
	case "$argument" in
	--merge) merge=1 ;;
	*) refuse "unknown argument $argument; the only option is --merge" ;;
	esac
done

for tool in git docker ssh kubectl gh python3; do
	command -v "$tool" >/dev/null 2>&1 || refuse "no \`$tool\` on PATH, so nothing was released"
done
[ -n "${CHUG_RIG_SSH:-}" ] || refuse "CHUG_RIG_SSH must name the ssh destination of the k3s node"

node="$CHUG_RIG_SSH"
context="${CHUG_RIG_CONTEXT:-chuggy-fabric}"
namespace="${CHUG_RIG_NAMESPACE:-chuggy}"
database="${CHUG_RIG_DATABASE:-chuggy}"
fabric_repo="${CHUG_FABRIC_REPO:-gdoteof/chuggy-fabric}"
wait_secs="${CHUG_RELEASE_WAIT_SECS:-600}"
registry_prefix=registry.chuggy.internal/chuggy

kube() { kubectl --context "$context" "$@"; }
sql() { # <statement>
	kube -n "$namespace" exec postgres-0 -- psql -U postgres -d "$database" -Atc "$1"
}

# What a manifest carries, read by the same shapes the fabric's consistency
# check reads, and nothing when the line is not there — so every caller has to
# say what an absence means.
manifest_source_commit() { # <manifest>
	sed -n 's|^[[:space:]]*fabric\.chuggy\.dev/source-commit:[[:space:]]*"\{0,1\}\([0-9a-f]\{7,40\}\)"\{0,1\}[[:space:]]*$|\1|p' "$apps/$1" | head -n 1
}
manifest_image() { # <manifest>
	sed -n "s|^[[:space:]]*image: \($registry_prefix/[^[:space:]]*@sha256:[0-9a-f]*\)[[:space:]]*\$|\1|p" "$apps/$1" | head -n 1
}
manifest_job() {
	sed -n 's|^[[:space:]]*name: \(chuggy-migrate-[a-z0-9-]*\)[[:space:]]*$|\1|p' "$apps/chuggy-migrate.yaml" | head -n 1
}

# --- the commit ---------------------------------------------------------------

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || refuse "not a git checkout, so there is no commit to release"
cd "$root" || exit 2
[ -x deploy/rig/images/build-and-import.sh ] || refuse "deploy/rig/images/build-and-import.sh is not here to build with"
[ -z "$(git status --porcelain)" ] || refuse "the working tree is dirty; commit first, because the tag names HEAD"
git fetch --quiet origin main || refuse "origin/main could not be fetched, so whether HEAD is on main is unknown"
git merge-base --is-ancestor HEAD origin/main || refuse "HEAD is not on origin/main; the rig follows main, so release a commit main has"
tag="$(git rev-parse --short HEAD)"
commit="$(git rev-parse HEAD)"
branch="release/chuggy-$tag"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- what is live ---------------------------------------------------------------

fabric="$work/fabric"
apps="$fabric/cluster/apps"
say "cloning $fabric_repo"
gh repo clone "$fabric_repo" "$fabric" -- --quiet >/dev/null 2>&1 || refuse "$fabric_repo could not be cloned, so what is live is unknown"

deployed="$(manifest_source_commit chuggy-api.yaml)"
[ -n "$deployed" ] || refuse "the fabric's api manifest names no source commit, so what is live is unknown"
git cat-file -e "$deployed^{commit}" 2>/dev/null || refuse "the live commit $deployed is not in this checkout, so what changed since it cannot be read"
if [ "$(git rev-parse "$deployed^{commit}")" = "$commit" ]; then
	say "the rig is already at $tag; nothing to release"
	exit 0
fi
if git merge-base --is-ancestor "$deployed" HEAD; then
	say "releasing $tag over $deployed"
else
	say "releasing $tag, which is not ahead of the live $deployed: this moves the rig back"
fi

changed="$(git diff --name-only "$deployed" HEAD -- src/adapters/postgres/schema/migrations)" || refuse "the migrations since $deployed could not be read"
migrations="$(printf '%s\n' "$changed" | grep -v '/index\.ts$' | grep . || true)"

if [ "$merge" -eq 1 ]; then
	# ============================================================================
	# --merge: the pull request that stands for HEAD is landed and rolled out.
	# ============================================================================
	pr_url="$(gh pr list -R "$fabric_repo" --head "$branch" --state open --json url --jq '.[].url')"
	[ -n "$pr_url" ] || refuse "no open pull request stands for $branch; run without --merge first"
	pr_number="${pr_url##*/}"
	git -C "$fabric" fetch -q origin "refs/heads/$branch:refs/heads/$branch" || refuse "$branch could not be fetched from $fabric_repo"
	git -C "$fabric" checkout -q "$branch"
	[ "$(manifest_source_commit chuggy-api.yaml)" = "$tag" ] || refuse "$branch does not select $tag, so it is not HEAD's release"
	job="$(manifest_job)"
	[ -n "$job" ] || refuse "chuggy-migrate.yaml names no Job"

	# A live attempt is a worker pod or a session pod, and those are the only
	# pods in the namespace the scheduler stamps with these labels; anything
	# else there has no heartbeat for a rollout to drop. A selector is
	# conjunctive, so each label is asked for on its own.
	newline='
'
	live_pods=""
	for label in chuggy.dev/worker chuggy.dev/session; do
		labelled_pods="$(kube -n chuggy-work get pods -l "$label=true" -o name 2>/dev/null)" || refuse "the work namespace could not be read, so whether an attempt is live is unknown"
		# An answer of nothing adds nothing, so an empty gathering stays empty
		# and the test below is a test of what was found.
		[ -n "$labelled_pods" ] || continue
		live_pods="${live_pods:+$live_pods$newline}$labelled_pods"
	done
	[ -z "$live_pods" ] || fail "an attempt is live in chuggy-work; a rollout would drop its heartbeats"
	live_rows="$(sql 'select count(*) from execution where terminal_at is null' 2>/dev/null || true)"
	printf '%s' "$live_rows" | grep -Eqx '[0-9]+' || refuse "the live execution count could not be read, so whether an attempt is live is unknown"
	[ "$live_rows" -eq 0 ] || fail "$live_rows execution(s) are live; a rollout would drop their heartbeats"

	if [ -n "$migrations" ]; then
		[ -n "${CHUG_RIG_ARCHIVE:-}" ] || refuse "this release carries a migration and CHUG_RIG_ARCHIVE names nowhere to keep the dump that is the only way back below it"
		[ -d "$CHUG_RIG_ARCHIVE" ] || refuse "CHUG_RIG_ARCHIVE names $CHUG_RIG_ARCHIVE, which is not a directory"
		dump="$CHUG_RIG_ARCHIVE/chuggy-pre-$tag.dump"
		globals="$CHUG_RIG_ARCHIVE/chuggy-pre-$tag-globals.sql"
		kube -n "$namespace" exec postgres-0 -- pg_dump -U postgres -Fc "$database" >"$dump" || refuse "the pre-merge dump did not complete"
		[ "$(dd if="$dump" bs=5 count=1 2>/dev/null)" = "PGDMP" ] || refuse "$dump is not a PostgreSQL archive, so there is no way back below the migration"
		kube -n "$namespace" exec postgres-0 -- pg_dumpall -U postgres --globals-only >"$globals" || refuse "the pre-merge globals dump did not complete"
		[ -s "$globals" ] || refuse "$globals is empty"
		say "dump at $dump"
	fi

	gh pr merge "$pr_number" -R "$fabric_repo" --merge --delete-branch --admin || fail "pull request $pr_number did not merge"
	merged="$(gh pr view "$pr_number" -R "$fabric_repo" --json mergeCommit --jq '.mergeCommit.oid')"
	printf '%s' "$merged" | grep -Eqx '[0-9a-f]{40}' || refuse "the merge commit of pull request $pr_number could not be read"
	say "merged as $merged"

	# The flux client's `reconcile --with-source` is this annotation on the
	# source, a wait for its artifact, and the same annotation on the
	# Kustomization.
	wait_for() { # <what> <command...>  the command prints where it is, which must reach the merge
		what="$1"
		shift
		waited=0
		until "$@" 2>/dev/null | grep -Fq "$merged"; do
			[ "$waited" -lt "$wait_secs" ] || fail "$what did not reach $merged within ${wait_secs}s"
			sleep 5
			waited=$((waited + 5))
		done
	}
	source_name="$(kube -n flux-system get kustomization apps -o jsonpath='{.spec.sourceRef.name}' 2>/dev/null || true)"
	[ -n "$source_name" ] || refuse "the apps Kustomization names no source, so there is nothing to reconcile"
	stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	kube -n flux-system annotate --overwrite "gitrepository/$source_name" "reconcile.fluxcd.io/requestedAt=$stamp" >/dev/null || refuse "the source could not be asked to reconcile"
	wait_for "the fabric source" kube -n flux-system get "gitrepository/$source_name" -o jsonpath='{.status.artifact.revision}'
	kube -n flux-system annotate --overwrite kustomization/apps "reconcile.fluxcd.io/requestedAt=$stamp" >/dev/null || refuse "the apps Kustomization could not be asked to reconcile"
	wait_for "the apps Kustomization" kube -n flux-system get kustomization apps -o jsonpath='{.status.lastAppliedRevision}'

	kube -n "$namespace" wait --for=condition=complete "job/$job" "--timeout=${wait_secs}s" >/dev/null \
		|| fail "$job did not complete; read its log before anything else"

	# Every Deployment in the namespace, held to the image its own manifest
	# names — the manifest is the release, so the cluster is compared with it
	# rather than with this run's memory of what moved.
	deployments="$(kube -n "$namespace" get deployments -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
	[ -n "$deployments" ] || refuse "no Deployment could be read in $namespace"
	wrong=0
	while read -r name; do
		[ -n "$name" ] || continue
		[ -f "$apps/$name.yaml" ] || continue
		expected="$(manifest_image "$name.yaml")"
		[ -n "$expected" ] || continue
		kube -n "$namespace" rollout status "deployment/$name" "--timeout=${wait_secs}s" >/dev/null || fail "$name did not roll out"
		running="$(kube -n "$namespace" get "deployment/$name" -o jsonpath='{.spec.template.spec.containers[*].image}')"
		if ! printf '%s\n' "$running" | tr ' ' '\n' | grep -Fqx "$expected"; then
			say "FAILED — $name runs $running, not $expected"
			wrong=$((wrong + 1))
		fi
	done <<-DEPLOYMENTS
		$deployments
	DEPLOYMENTS
	[ "$wrong" -eq 0 ] || fail "$wrong Deployment(s) are not on the release"

	ledger="$(sql 'select max(version) from schema_migration' 2>/dev/null || true)"
	say "the rig is at $tag; ledger at ${ledger:-unknown}"
	exit 0
fi

# ================================================================================
# The release: gate, build, publish, select, and open the pull request.
# ================================================================================

# --- what must answer before anything slow runs -----------------------------------
# The gate and the builds take minutes; the node, the registry and the push
# identity are each a second to ask, and a release that cannot be pushed is
# refused here rather than after all of that. The push is rehearsed dry: git
# reaches the remote as the identity the real push will use, and the remote's
# refusal is quoted as it was given.

ssh "$node" true >/dev/null 2>&1 || refuse "$node does not answer over ssh, so nothing could be imported or pushed"
registry_ip="$(kube -n chuggy-registry get service registry -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)"
[ -n "$registry_ip" ] || refuse "the registry Service could not be read through context $context, so there is nowhere to push"
if ! git -C "$fabric" push --dry-run -q origin "HEAD:refs/heads/$branch" 2>"$work/push-check"; then
	refuse "$fabric_repo refuses a push to $branch from this identity; git said: $(grep -v '^$' "$work/push-check" | head -n 1)"
fi

moved() { # <path>...
	! git diff --quiet "$deployed" HEAD -- "$@"
}
api_moved=0
ui_moved=0
web_moved=0
if moved src images/api package.json package-lock.json; then api_moved=1; fi
if moved ui/chuggy-ui src/contract scripts/console-policy.ts scripts/check-console-policy.ts images/chuggy-ui images/web/nginx.conf package.json package-lock.json; then ui_moved=1; fi
if moved ui/console images/web; then web_moved=1; fi
if moved images/worker; then
	say "WARNING — images/worker changed since $deployed; the worker is built and admitted by the fabric, not here, and this release does not move it"
fi

# --- the gate -------------------------------------------------------------------

if [ "${CHUG_RELEASE_GATE:-1}" = "0" ]; then
	gate="skipped by CHUG_RELEASE_GATE=0"
	say "gate $gate; this release carries no verdict of its own"
else
	say "gating $tag with every gate"
	set +e
	CHUG_CI_FULL=1 ./.chug/tasks/ci.sh
	gated=$?
	set -e
	[ "$gated" -eq 0 ] || leave_as "$gated" "the gate did not pass $tag, so it is not released"
	gate="clean"
fi

# --- the images -----------------------------------------------------------------

# The builder's own variables are handed to it here and nowhere earlier: the
# gate runs first, and its suites for the builder read the same names.
build() { # <image> [env...]
	image="$1"
	shift
	set +e
	env CHUG_IMAGE_PREFIX="$registry_prefix" CHUG_RIG_SSH="$node" "$@" deploy/rig/images/build-and-import.sh "$image"
	built=$?
	set -e
	[ "$built" -eq 0 ] || leave_as "$built" "$image did not reach the node"
}
if [ "$api_moved" -eq 1 ]; then
	say "building api:$tag"
	build api "CHUG_IMAGE_TAG=$tag"
fi
if [ "$ui_moved" -eq 1 ]; then
	say "building chuggy-ui:$tag"
	build chuggy-ui "CHUG_IMAGE_TAG=$tag"
fi
if [ "$web_moved" -eq 1 ]; then
	say "building web:$tag"
	build web "CHUG_IMAGE_TAG=$tag" CHUG_WEB_SITE=ui/console
fi

# --- the registry ---------------------------------------------------------------

# The node's containerd is the client: the imported image is tagged with the
# Service address and pushed there, because the logical registry name resolves
# for pulls alone. The digest is then what the registry answers for the tag.
publish() { # <image> <repository> <tag>
	source="$registry_prefix/$1:$tag"
	alias="$registry_ip:5000/chuggy/$2:$3"
	ssh "$node" sudo k3s ctr --namespace k8s.io images tag --force "$source" "$alias" >/dev/null || fail "$source could not be tagged for the registry"
	ssh "$node" sudo k3s ctr --namespace k8s.io images push --plain-http "$alias" >/dev/null || fail "$source did not push"
	headers="$(ssh "$node" curl -sI -H Accept:application/vnd.oci.image.manifest.v1+json "http://$registry_ip:5000/v2/chuggy/$2/manifests/$3" || true)"
	digest="$(printf '%s\n' "$headers" | tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" { print $2 }')"
	printf '%s' "$digest" | grep -Eqx 'sha256:[0-9a-f]{64}' || fail "the registry answered no digest for $2:$3, so nothing can be selected"
	say "$2:$3 is $digest"
}
api_digest=""
ui_digest=""
web_digest=""
if [ "$api_moved" -eq 1 ]; then publish api api "$tag"; api_digest="$digest"; fi
if [ "$ui_moved" -eq 1 ]; then publish chuggy-ui web "chuggy-ui-$tag"; ui_digest="$digest"; fi
if [ "$web_moved" -eq 1 ]; then publish web web "$tag"; web_digest="$digest"; fi

# --- the manifests --------------------------------------------------------------

api_manifests="chuggy-api.yaml chuggy-configuration-importer.yaml chuggy-finalizer.yaml chuggy-migrate.yaml chuggy-scheduler.yaml chuggy-selector.yaml chuggy-ticket-service.yaml chuggy-worker-plane.yaml"
console_manifests="chuggy-ui.yaml chuggy-web.yaml"

rewrite() { # <manifest> <sed expression>
	[ -f "$apps/$1" ] || refuse "the fabric has no $1 to edit"
	sed "$2" "$apps/$1" >"$work/edited"
	mv "$work/edited" "$apps/$1"
}
image_line() { # <repository> <digest>
	printf 's|^\\([[:space:]]*image: %s/%s@\\)sha256:[0-9a-f]*[[:space:]]*$|\\1%s|' "$registry_prefix" "$1" "$2"
}
for manifest in $api_manifests $console_manifests; do
	rewrite "$manifest" "s|^\\([[:space:]]*fabric\\.chuggy\\.dev/source-commit:[[:space:]]*\\).*\$|\\1$tag|"
done
rewrite chuggy-migrate.yaml "s|^\\([[:space:]]*name: chuggy-migrate-\\)[a-z0-9-]*\$|\\1$tag-registry|"
if [ -n "$api_digest" ]; then
	for manifest in $api_manifests; do
		rewrite "$manifest" "$(image_line api "$api_digest")"
		[ "$(manifest_image "$manifest")" = "$registry_prefix/api@$api_digest" ] || fail "$manifest does not carry the api digest after the edit"
	done
fi
if [ -n "$ui_digest" ]; then
	rewrite chuggy-ui.yaml "$(image_line web "$ui_digest")"
	[ "$(manifest_image chuggy-ui.yaml)" = "$registry_prefix/web@$ui_digest" ] || fail "chuggy-ui.yaml does not carry the console digest after the edit"
fi
if [ -n "$web_digest" ]; then
	rewrite chuggy-web.yaml "$(image_line web "$web_digest")"
	[ "$(manifest_image chuggy-web.yaml)" = "$registry_prefix/web@$web_digest" ] || fail "chuggy-web.yaml does not carry the old console digest after the edit"
fi
git -C "$fabric" diff --quiet && fail "the edit changed no manifest, so there is no release to commit"
python3 "$fabric/scripts/check-release-consistency" "$apps" || fail "the fabric's consistency check refuses the edited manifests"
kube kustomize "$apps" >/dev/null || fail "the edited manifests do not render"

# --- the fabric change ----------------------------------------------------------

{
	printf 'release: chuggy %s\n\n' "$tag"
	printf 'The rig moves from %s to %s, which carries:\n\n' "$deployed" "$tag"
	git log --format='  %h %s' "$deployed..HEAD"
	printf '\n'
	if [ -n "$api_digest" ]; then printf 'api: %s\n' "$api_digest"; else printf 'api: unchanged\n'; fi
	if [ -n "$ui_digest" ]; then printf 'web (chuggy-ui): %s\n' "$ui_digest"; else printf 'web (chuggy-ui): unchanged\n'; fi
	if [ -n "$web_digest" ]; then printf 'web (console): %s\n' "$web_digest"; else printf 'web (console): unchanged\n'; fi
	if [ -n "$migrations" ]; then
		printf '\nMigrations the Job applies, below which the only way back is a restore:\n'
		printf '%s\n' "$migrations" | sed 's|^.*/|  |'
	else
		printf '\nNo migration: the migrate Job is a no-op.\n'
	fi
	printf '\nGate at %s: %s.\n' "$tag" "$gate"
} >"$work/message"

git -C "$fabric" checkout -q -b "$branch"
git -C "$fabric" add cluster/apps
git -C "$fabric" commit -q -F "$work/message" || fail "the fabric change did not commit"

remote_ref="$(git -C "$fabric" ls-remote origin "refs/heads/$branch")"
existing="${remote_ref%%[[:space:]]*}"
if [ -n "$existing" ]; then
	git -C "$fabric" push -q "--force-with-lease=refs/heads/$branch:$existing" origin "HEAD:refs/heads/$branch" || fail "$branch was not pushed over what stood there"
else
	git -C "$fabric" push -q origin "HEAD:refs/heads/$branch" || fail "$branch was not pushed"
fi

sed -n '3,$p' "$work/message" >"$work/body"
pr_url="$(gh pr list -R "$fabric_repo" --head "$branch" --state open --json url --jq '.[].url')"
if [ -z "$pr_url" ]; then
	pr_url="$(gh pr create -R "$fabric_repo" --base main --head "$branch" --title "release: chuggy $tag" --body-file "$work/body")"
fi
[ -n "$pr_url" ] || fail "no pull request stands for $branch"
say "pull request $pr_url"
say "not merged. Review it, then land it and roll it out with:"
say "  CHUG_RIG_SSH=$node deploy/rig/deploy-to-gtr.sh --merge"
