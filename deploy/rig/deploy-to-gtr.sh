#!/bin/sh
# Move the rig to the commit this checkout is at. Without an option: gate it,
# build the images it changed, publish them to the rig's registry, and open the
# chuggy-fabric pull request that selects them. Under `--merge`: land the pull
# request that stands for HEAD and watch Flux roll it out.
#
# THE RIG FOLLOWS chuggy-fabric, NOT THIS REPOSITORY. Flux reconciles the
# fabric's manifests, which name every image by registry digest and carry the
# source commit it was built from. Merging here deploys nothing; a release is
# a fabric commit that moves those digests, and this script is the whole of
# the path from a commit on main to that fabric commit.
#
# A RELEASE IS TWO DIRECTORIES OF THE FABRIC: the migrate Job under
# `cluster/chuggy-migrate` and, under `cluster/chuggy`, the services that run
# the release's images. The manifests edited there are all a release commits.
# No other layout is released to: a fabric that does not keep the Job and the
# api where a release has them is refused before anything is read from it.
#
# THE FABRIC'S MANIFESTS SAY WHAT IS LIVE ONLY ONCE FLUX HAS APPLIED THEM, and
# everything decided here is decided from them: which commit is live, whether
# there is anything to release, and whether a release carries a migration. A
# release whose migrate Job failed leaves the fabric's main naming a commit no
# service runs. So before anything is decided the rig is asked. The source
# must hold the fabric's main as it was cloned, and each layer that applies a
# release, `chuggy-migrate` and `chuggy`, must not be suspended, must have
# applied what the source holds, and must not read as failing. Where that is
# not so this could not run, and says which layer, what it has applied and
# where the source is. The way on is the fabric's: Flux finishes a release
# that is in flight, and one that is held is reverted there.
#
# WHAT IS RELEASED IS HEAD, AND HEAD MUST BE ON MAIN. The tag is the short
# commit, which `deploy/rig/images/build-and-import.sh` refuses to derive from
# a dirty tree; and a commit main does not have is one the configuration
# importer, which tracks main, will never see. So a dirty tree and a HEAD off
# `origin/main` are both refused before anything is built.
#
# ONLY WHAT MOVED IS REBUILT. The fabric's manifests say which commit is live,
# and each image is rebuilt when a path its Dockerfile copies changed between
# that commit and HEAD. The console is built by `images/chuggy-ui/`, which
# installs and bundles inside the image, so what it serves is a function of the
# commit and not of whichever Node and `node_modules` the host had; it is
# published under the `web` repository the fabric's consistency check requires
# of it. An image that did not move keeps its digest, so
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
# THAT CHECK KEEPS ITS OWN PROTOCOL, WHICH IS NOT THIS SCRIPT'S. It exits 3 to
# refuse the manifests it read, and 1 when it could not read them at all. So 3
# is the finding here and every other non-zero answer is a could-not-run: a
# check that reached no verdict has not said the release is consistent, and
# releasing on it would be believing a control that never ran.
#
# `--merge` IS WHERE THE CLUSTER CHANGES, and it is a separate run so that a
# reviewer can read the pull request in between. A release carries a migration
# when anything under the migrations directory changed, whatever its name: the
# list there is what the Job applies. When it does, the landing takes a dump
# first, into the directory the caller names — a ledger that has moved forward
# is not walked back by reverting the fabric commit, and a dump is the only
# way below it. The Job takes a dump of its own before it migrates and keeps
# it in the cluster; the landing's is the copy outside it. Then it merges,
# waits for the rollout as the fabric orders it, and holds the cluster to the
# manifests: the migrate Job complete, and each Deployment on the image its
# manifest names.
#
# THE FABRIC ORDERS THE ROLLOUT, AND A LANDING WAITS ON EACH LAYER OF IT. Flux
# applies a fabric commit in layers, a Kustomization each: `apps`, then
# `chuggy-migrate`, which applies the migrate Job, then `chuggy`, which
# applies the services. Each waits for what it applied to be healthy, and
# each after the first applies a commit only once the layer before it is
# Ready at that same commit. Once the source has the merge, a landing waits
# for each layer in that order to have applied it. `apps` applies what a
# release runs on and no part of one, and it is waited for all the same: a
# release it holds is one Flux has not started, with no migrate Job made and
# no service applied until `apps` is healthy at the merge.
#
# A LAYER HAS THE MERGE WHEN WHAT IT APPLIED CONTAINS IT: the merge, or a
# commit of the fabric's main that descends from it. That main may gain one
# while a release rolls out, and a layer whose dependency was still busy when
# the source fetched it applies that commit and never the merge by itself.
# Which it is, is decided by ancestry in this run's clone of the fabric, which
# fetches the main for a commit it has not got. A revision it still has not
# got contains nothing: it is waited on like any other, and the finding of a
# wait that runs out on one says so.
#
# EACH WAIT IS CAPPED BY ITSELF, AND THERE IS NO TOTAL. A cap ends a wait on
# something that hangs, so a layer that is slow has the whole of its own and
# is charged nothing for the layer before it. One that does not get there is
# the one the finding names, with what it applies, so a release held by what
# it runs on is not said to be a service's doing.
#
# THE SOURCE IS ASKED TO RECONCILE AND NO LAYER IS. The source fetches on an
# interval, and asking has it fetch the merge now. A layer needs no asking:
# kustomize-controller queues every Kustomization that reads a source when the
# source's revision moves, and one whose dependency has not yet applied that
# revision puts itself off and asks again until it has. A request to such a
# layer is put off the same way, and starts nothing the merge had not.
#
# A MIGRATION THAT FAILED IS NOT WAITED OUT AS IF IT WERE SLOW. When the Job
# fails, `chuggy-migrate` has attempted a revision that contains the merge and
# reads not Ready, for the reason `HealthCheckFailed` and with the Job named
# as `Failed` in the message; `chuggy` then applies nothing, so every service
# is left on the release before it. A landing reads that at each asking while
# that layer is the one it waits on, and ends on it as a finding that says how
# to read the logs of whichever of the Job's containers failed.
# While `apps` has not applied the merge that layer has attempted nothing of
# it, and once the layer has applied it the Job is complete. The same reason
# over a Job the message does not call `Failed` is the layer's own wait run
# out on a Job still running, and the landing goes on waiting.
#
# A RELEASE GOES OUT OVER LIVE ATTEMPTS, because nothing it restarts is owned by
# one: an attempt in a pod keeps its lease through the worker plane, and that
# plane is rolled with the old pod serving until the new one is ready. A landing
# refuses while an attempt is live only where that does not hold, and live
# there is a worker or session pod, an execution that has not ended, or an
# attempt row that has not ended. A release that carries a migration has a
# plane serving on a schema that is not its image's for the length of the roll,
# and a plane checks no schema when it starts. A release that moves the rig
# back, or whose commit states an earlier worker contract than the live commit
# does, brings a plane that refuses a pod of the later contract; a commit that
# does not state its contract is taken to. And a worker plane that does not
# state a rolling update with none unavailable, or that states no replica, may
# leave a moment with no plane serving, which is the one thing a live attempt
# needs of a release. That is read from the tree the merge will produce, the
# release branch merged into the fabric's main as it stands, and there only
# from the `spec` of the Deployment named chuggy-worker-plane in the manifest
# of that name; a branch that does not merge cleanly could not be read. The
# forge is asked to merge only the branch head that was read. What the fabric's
# main gains between that reading and the merge is not read.
#
# WHAT BECAME OF THEM IS SAID ONLY AS FAR AS A ROW SAYS IT. Any other landing
# says how many attempts are live, and once the rollout is done asks after
# each. One that ended is counted by how it ended. One that still runs is
# vouched for only once its lease has been written since the rollout, which is
# its pod or its runner reaching a plane the release left serving, and the
# landing waits for that. One still being placed, which no pool holds and
# nothing has written, is not waited for and is counted apart, unless its
# lease has already run out: that one is about to be ended, and is waited for
# with those not heard from. An attempt the database records as lost is a
# finding, and one still running that was not heard from is a could-not-run,
# each said after everything else a landing does: the release stands, and no
# row says the rollout was the cause.
#
# WHAT NOTHING HERE HOLDS. How the pool plane rolls, through which an attempt a
# runner holds keeps its lease. A patch elsewhere in the fabric that restates
# the worker plane's strategy. A second Deployment of the plane's name in its
# manifest, written in a form this does not take for a Deployment.
#
# `--console` IS BOTH PHASES IN ONE RUN, for a release in which only the
# console moved. Every other manifest then takes an annotation and no
# new image, so nothing that carries a heartbeat restarts and the live-attempt
# refusal is not consulted; and the pull request is opened, merged and rolled
# out without a pause, because a diff that is digests and annotations is read
# mechanically and not reviewed. A change that also moves the api is refused
# under it and goes the long way, and a migration is under `src/`, so it moves
# the api. So is a release that moves the rig back.
#
# THE GATE IS THE GATES THE CHANGE SINCE THE LIVE COMMIT AFFECTS. Each commit
# in that range was gated against main when it merged; what a release adds is
# their sum against what the rig runs. Which gates that sum reaches is the
# runner's selection over the range, and the selection is trusted for it: a
# gate it does not select is not run, and the pull request says the release was
# gated by what changed and not that every gate passed. A range that selects no
# gate and no suite has gated nothing, which the runner is asked to answer as a
# could-not-run. A release that moves the rig back has no change ahead of the
# live commit to select by, so it runs every gate, and `CHUG_RELEASE_GATE=full`
# asks for every gate of any release.
#
# Usage:
#   deploy/rig/deploy-to-gtr.sh            gate, build, publish, open the PR
#   deploy/rig/deploy-to-gtr.sh --merge    merge HEAD's PR, reconcile, verify
#   deploy/rig/deploy-to-gtr.sh --console  a console-only release, both phases
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
#   CHUG_RELEASE_GATE     0 skips the gate, and the pull request says so;
#                         full runs every gate; unset or empty runs the gates
#                         the change affects. Any other value is refused.
#   CHUG_RELEASE_WAIT_SECS  the cap on each wait of a landing, default 600:
#                         on the fabric's source, on each of its layers in
#                         turn, on the migrate Job and on each Deployment's
#                         rollout. Each has the whole of it; there is no total.
#   CHUG_RELEASE_HEARD_SECS  how long a landing waits to hear from an attempt
#                         that still runs once the rollout is done. The default
#                         is two of the worker core's heartbeat intervals
#                         (`heartbeatIntervalMilliseconds` in its `lease.mjs`)
#                         and a margin, so a pod is heard from though the
#                         rollout cost it a beat.
#
# Exits 0 clean. 1 is a finding: something did not land, or the release landed
# and an attempt live at its merge is recorded lost. 2 is a could-not-run.
# Before the merge that is nothing released. After it the release is merged,
# and a step of its rollout, or what became of an attempt live at its merge,
# could not be read or vouched for. Two is not a pass.
set -eu
export LC_ALL=C

# What a landing that stops short still owes, said with whatever stops it.
unasked=""
say() { printf 'deploy-to-gtr: %s\n' "$*"; }
refuse() {
	printf 'deploy-to-gtr: LINTER ERROR — %s%s\n' "$*" "$unasked" >&2
	exit 2
}
fail() {
	printf 'deploy-to-gtr: FAILED — %s%s\n' "$*" "$unasked" >&2
	exit 1
}
# A step's own protocol is kept: one is a finding, anything else could not run.
leave_as() { # <status> <what>
	if [ "$1" -eq 1 ]; then fail "$2"; else refuse "$2"; fi
}

merge=0
console=0
for argument in "$@"; do
	case "$argument" in
	--merge) merge=1 ;;
	--console) console=1 ;;
	*) refuse "unknown argument $argument; the options are --merge and --console" ;;
	esac
done
[ "$merge" -eq 0 ] || [ "$console" -eq 0 ] || refuse "--console lands its own release; it takes no --merge"
case "${CHUG_RELEASE_GATE:-}" in
"" | 0 | full) ;;
*) refuse "CHUG_RELEASE_GATE is \`$CHUG_RELEASE_GATE\`, and it takes 0, full or nothing" ;;
esac
heard_secs="${CHUG_RELEASE_HEARD_SECS:-150}"
case "$heard_secs" in
"" | *[!0-9]*) refuse "CHUG_RELEASE_HEARD_SECS is \`$heard_secs\`, which is not a whole number of seconds" ;;
# More digits than every shell's arithmetic holds is a comparison that errors,
# and so a wait that never ends.
??????????*) refuse "CHUG_RELEASE_HEARD_SECS is \`$heard_secs\`, which is more seconds than a landing can count" ;;
esac

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
# say what an absence means. A manifest is named as that check names it, by
# its path under the fabric's `cluster/`.
manifest_source_commit() { # <manifest>
	sed -n 's|^[[:space:]]*fabric\.chuggy\.dev/source-commit:[[:space:]]*"\{0,1\}\([0-9a-f]\{7,40\}\)"\{0,1\}[[:space:]]*$|\1|p' "$cluster/$1" | head -n 1
}
manifest_image() { # <manifest>
	sed -n "s|^[[:space:]]*image: \($registry_prefix/[^[:space:]]*@sha256:[0-9a-f]*\)[[:space:]]*\$|\1|p" "$cluster/$1" | head -n 1
}
manifest_job() {
	sed -n 's|^[[:space:]]*name: \(chuggy-migrate-[a-z0-9-]*\)[[:space:]]*$|\1|p' "$cluster/chuggy-migrate/chuggy-migrate.yaml" | head -n 1
}
# `rolling` when the Deployment named chuggy-worker-plane states, as its own
# `spec.strategy`, a rolling update with none unavailable, and states no
# `spec.replicas` but a count above none; nothing otherwise. The manifest is
# read as the block YAML the fabric writes, a document at a time and each line
# under the lines it is indented beneath, and only the exact lines are an
# answer. That Deployment in no document or in more than one, a key on the way
# to the answer stated twice, and a line on that way or in the strategy that
# this does not recognise are each nothing.
worker_plane_rolls() {
	awk '
		function fresh() {
			kinds = 0; deployment = 0; names = 0; named = 0; specs = 0; strategies = 0
			types = 0; rolling = 0; bounds = 0; unavailables = 0; none = 0; odd = 0; depth = 0
		}
		function closed() {
			if (deployment && named) {
				found++
				if (kinds == 1 && names == 1 && specs == 1 && strategies == 1 && types == 1 && rolling &&
					bounds == 1 && unavailables == 1 && none && !odd) stated++
			}
			fresh()
		}
		function keyof(text) {
			sub(/:.*$/, "", text)
			return text
		}
		function bound(entry) {
			if (keyof(entry) == "maxUnavailable") {
				unavailables++
				if (entry == "maxUnavailable: 0") none = 1
			} else if (entry !~ /^maxSurge: [0-9]+%?$/) odd = 1
		}
		BEGIN { fresh() }
		{ sub(/\r$/, "") }
		/^---([ \t]|$)/ { closed(); next }
		{
			sub(/(^|[ \t])#.*$/, "")
			sub(/[ \t]+$/, "")
			if ($0 == "") next
			match($0, /^ */)
			indent = RLENGTH
			line = substr($0, indent + 1)
			while (depth > 0 && at[depth] >= indent) depth--
			under = ""
			for (i = 1; i <= depth; i++) under = under held[i] "/"
			depth++
			at[depth] = indent
			held[depth] = line
			key = keyof(line)
			if ((under == "" || under == "metadata:/" || under == "spec:/") && line !~ /^[A-Za-z]+:( |$)/) odd = 1
			if (under == "") {
				if (key == "kind") { kinds++; if (line == "kind: Deployment") deployment = 1 }
				if (key == "spec") specs++
			} else if (under == "metadata:/") {
				if (key == "name") { names++; if (line == "name: chuggy-worker-plane") named = 1 }
			} else if (under == "spec:/") {
				if (key == "strategy") strategies++
				if (key == "replicas" && line !~ /^replicas: [1-9][0-9]*$/) odd = 1
			} else if (under == "spec:/strategy:/") {
				if (key == "type") {
					types++
					if (line == "type: RollingUpdate") rolling = 1
				} else if (key == "rollingUpdate") {
					bounds++
					if (line ~ /^rollingUpdate: \{.*\}$/) {
						sub(/^rollingUpdate: \{[ \t]*/, "", line)
						sub(/[ \t]*\}$/, "", line)
						parts = split(line, part, /[ \t]*,[ \t]*/)
						for (i = 1; i <= parts; i++) bound(part[i])
					}
				} else odd = 1
			} else if (under == "spec:/strategy:/rollingUpdate:/") {
				bound(line)
			} else if (index(under, "spec:/strategy:/") == 1) odd = 1
		}
		END {
			closed()
			if (found == 1 && stated) print "rolling"
		}
	' "$cluster/chuggy/chuggy-worker-plane.yaml" 2>/dev/null || true
}
# The worker contract a commit states, as the one file that carries it does:
# the major and minor of its release, which are the version a plane serves and
# a pod names. A commit states one where it says so once.
contract_at() { # <commit>
	git show "$1:src/contract/workerContract.ts" 2>/dev/null \
		| sed -n 's/^export const workerContractRelease = "\([0-9]\{1,9\}\.[0-9]\{1,9\}\)\.[0-9]\{1,9\}";$/\1/p'
}
stated() { # <what a commit states>
	case "$1" in "" | *[!0-9.]*) return 1 ;; esac
}
# Whether a lease has been written since it was read. One is whole
# microseconds, or something else where the row has none.
renewed() { # <lease then> <lease now>
	case "$2" in "" | *[!0-9]*) return 1 ;; esac
	[ "$2" != "$1" ]
}

# Whether a revision of the fabric's main contains another, each as Flux
# writes one or as a bare commit: it is that commit or descends from it. The
# clone decides it, as the header argues, and one it cannot decide is not one
# that contains.
contains() { # <revision> <revision>
	this="${1##*:}"
	that="${2##*:}"
	{ git -C "$fabric" cat-file -e "$this^{commit}" && git -C "$fabric" cat-file -e "$that^{commit}"; } 2>/dev/null \
		|| git -C "$fabric" fetch -q origin refs/heads/main 2>/dev/null || return 1
	git -C "$fabric" merge-base --is-ancestor "$that" "$this" 2>/dev/null
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
cluster="$fabric/cluster"
say "cloning $fabric_repo"
gh repo clone "$fabric_repo" "$fabric" -- --quiet >/dev/null 2>&1 || refuse "$fabric_repo could not be cloned, so what is live is unknown"
for kept in chuggy-migrate/chuggy-migrate.yaml chuggy/chuggy-api.yaml; do
	[ -f "$cluster/$kept" ] || refuse "$fabric_repo has no cluster/$kept: a release is the migrate Job under cluster/chuggy-migrate and the services under cluster/chuggy, and a fabric laid out any other way is not released to"
done

# Whether Flux has applied those manifests, which the header argues, asked
# before anything is decided from them. Ready is Unknown for the length of
# every reconciliation, one over a revision already applied among them, so a
# layer reads as failing only where it is neither that nor True.
fabric_main="$(git -C "$fabric" rev-parse --verify HEAD)" || refuse "the main of $fabric_repo could not be read out of its clone"
source_name="$(kube -n flux-system get kustomization chuggy -o jsonpath='{.spec.sourceRef.name}' 2>/dev/null || true)"
[ -n "$source_name" ] || refuse "the chuggy Kustomization answered no source through context $context, so whether Flux has applied the fabric's manifests is unknown"
source_at="$(kube -n flux-system get "gitrepository/$source_name" -o jsonpath='{.status.artifact.revision}' 2>/dev/null || true)"
not_live="so the fabric's manifests do not say what is live, and nothing is decided from them"
contains "$source_at" "$fabric_main" || refuse "the fabric source is at ${source_at:-no revision} and has not fetched $fabric_main, the main of $fabric_repo, $not_live"
for layer in chuggy-migrate chuggy; do
	state="$(kube -n flux-system get kustomization "$layer" -o jsonpath='{.status.lastAppliedRevision}|{.status.conditions[?(@.type=="Ready")].status}|{.spec.suspend}' 2>/dev/null)" \
		|| refuse "the $layer Kustomization could not be read through context $context, so whether Flux has applied the fabric's manifests is unknown"
	has="${state%%|*}"
	state="${state#*|}"
	if [ "${state#*|}" = true ]; then
		held="is suspended"
	elif ! contains "$has" "$source_at"; then
		held="has not applied what the fabric source holds"
	else
		case "${state%%|*}" in True | Unknown) held="" ;; *) held="is not Ready" ;; esac
	fi
	[ -z "$held" ] || refuse "the $layer Kustomization $held: it has applied ${has:-no revision} and the source is at $source_at, $not_live"
done

deployed="$(manifest_source_commit chuggy/chuggy-api.yaml)"
[ -n "$deployed" ] || refuse "the fabric's api manifest names no source commit, so what is live is unknown"
git cat-file -e "$deployed^{commit}" 2>/dev/null || refuse "the live commit $deployed is not in this checkout, so what changed since it cannot be read"
if [ "$(git rev-parse "$deployed^{commit}")" = "$commit" ]; then
	say "the rig is already at $tag; nothing to release"
	exit 0
fi
back=0
if git merge-base --is-ancestor "$deployed" HEAD; then
	say "releasing $tag over $deployed"
else
	back=1
	say "releasing $tag, which is not ahead of the live $deployed: this moves the rig back"
	# The gate runner diffs from the merge base, which is HEAD itself here, so
	# there would be nothing to gate over and a clean verdict about nothing.
	[ "$console" -eq 0 ] || refuse "--console gates the change since $deployed, and HEAD has none; run without --console"
fi

# Every path that changed under the migrations directory, and no name is set
# aside: the list there is what the Job applies, and a migration may be a
# directory's index.
migrations="$(git diff --name-only "$deployed" HEAD -- src/adapters/postgres/schema/migrations)" || refuse "the migrations since $deployed could not be read"
contract_live="$(contract_at "$deployed")"
contract_head="$(contract_at HEAD)"

# ================================================================================
# Landing: the pull request that stands for HEAD is merged and rolled out.
# ================================================================================
land() { # <pull request url>
	pr_number="${1##*/}"
	git -C "$fabric" fetch -q origin "refs/heads/$branch" || refuse "$branch could not be fetched from $fabric_repo"
	git -C "$fabric" checkout -q --detach FETCH_HEAD || refuse "$branch could not be checked out of $fabric_repo"
	read_head="$(git -C "$fabric" rev-parse HEAD)" || refuse "the head of $branch could not be read"
	[ "$(manifest_source_commit chuggy/chuggy-api.yaml)" = "$tag" ] || refuse "$branch does not select $tag, so it is not HEAD's release"
	# From here the tree is what the merge will produce: the branch merged into
	# the fabric's main as it stands, which is what the cluster is given. The
	# trial answers a conflict with a status of its own, and any other failure
	# is a git that could not make the merge, as one without the option cannot.
	git -C "$fabric" fetch -q origin refs/heads/main || refuse "the main of $fabric_repo could not be fetched, so what the merge would land is unknown"
	landing="$(git -C "$fabric" merge-tree --write-tree FETCH_HEAD HEAD 2>/dev/null)" || {
		[ "$?" -eq 1 ] || refuse "this git could not merge $branch into the main of $fabric_repo to read what would land, which takes a git that has \`merge-tree --write-tree\`"
		refuse "$branch could not be merged cleanly into the main of $fabric_repo here, so what would land is unknown"
	}
	git -C "$fabric" read-tree -u --reset "$landing" || refuse "what merging $branch would land could not be read"
	job="$(manifest_job)"
	[ -n "$job" ] || refuse "chuggy-migrate.yaml names no Job"

	# Whether this release may go out over a live attempt, which the header
	# argues case by case. A console release restarts nothing an attempt
	# reaches, so it asks after none.
	unsafe=""
	if [ "$console" -eq 0 ]; then
		if [ -n "$migrations" ]; then
			unsafe="this release carries a migration, across which a plane serves on a schema that is not its own"
		elif [ "$back" -eq 1 ]; then
			unsafe="this release moves the rig back, to a plane that refuses a pod of a later contract"
		elif ! stated "$contract_live" || ! stated "$contract_head"; then
			unsafe="the worker contract is not stated once at each of $deployed and $tag, so whether this release's plane refuses a live pod is unknown"
		elif [ "${contract_head%.*}" -lt "${contract_live%.*}" ] || { [ "${contract_head%.*}" -eq "${contract_live%.*}" ] && [ "${contract_head#*.}" -lt "${contract_live#*.}" ]; }; then
			unsafe="this release states worker contract $contract_head where the live commit states $contract_live, so its plane refuses a pod of the later one"
		else
			[ -f "$cluster/chuggy/chuggy-worker-plane.yaml" ] || refuse "merging $branch lands no chuggy-worker-plane.yaml, so whether a plane serves throughout the roll is unknown"
			if [ "$(worker_plane_rolls)" != "rolling" ]; then
				unsafe="the worker plane that merging $branch lands does not state a rolling update with none unavailable, or states no replica, so a moment with no plane serving is not ruled out"
			fi
		fi
	fi
	# What is live: every attempt of work or of a session that has not ended,
	# each as the kind and the identity its row is asked after by once the
	# rollout is done. An identity is the scheduler's own making, so an answer
	# that is not a kind and such an identity on each line is one this cannot
	# ask after, and nothing is merged on it.
	live=""
	live_count=0
	newline='
'
	if [ "$console" -eq 0 ]; then
		live="$(sql "select 'work ' || attempt from execution_attempt where ended_at is null union all select 'session ' || attempt from session_attempt where ended_at is null" 2>/dev/null)" || refuse "the live attempts could not be read, so what the release would go out over is unknown"
		if [ -n "$live" ]; then
			if printf '%s\n' "$live" | grep -Evq '^(work|session) [A-Za-z0-9._-]+$'; then
				refuse "the live attempts were not answered as a kind and an identity each, so what the release would go out over is unknown"
			fi
			live_count="$(printf '%s\n' "$live" | grep -c .)"
		fi
	fi
	if [ -n "$unsafe" ]; then
		# A release that asks goes out over nothing live. Live is a worker pod
		# or a session pod, which are the only pods in the namespace the
		# scheduler stamps with these labels; a selector is conjunctive, so
		# each label is asked for on its own. It is an execution that has not
		# ended. And it is an attempt row that has not ended, which is all
		# there is of a session a runner holds: it has no pod here and no
		# execution.
		live_pods=""
		for label in chuggy.dev/worker chuggy.dev/session; do
			labelled_pods="$(kube -n chuggy-work get pods -l "$label=true" -o name 2>/dev/null)" || refuse "the work namespace could not be read, so whether an attempt is live is unknown"
			# An answer of nothing adds nothing, so an empty gathering stays empty
			# and the test below is a test of what was found.
			[ -n "$labelled_pods" ] || continue
			live_pods="${live_pods:+$live_pods$newline}$labelled_pods"
		done
		[ -z "$live_pods" ] || fail "an attempt is live in chuggy-work, and $unsafe"
		live_rows="$(sql 'select count(*) from execution where terminal_at is null' 2>/dev/null || true)"
		printf '%s' "$live_rows" | grep -Eqx '[0-9]+' || refuse "the live execution count could not be read, so whether an attempt is live is unknown"
		[ "$live_rows" -eq 0 ] || fail "$live_rows execution(s) are live, and $unsafe"
		[ "$live_count" -eq 0 ] || fail "$live_count attempt(s) are live, and $unsafe"
	elif [ "$live_count" -gt 0 ]; then
		say "$live_count attempt(s) are live, and the release goes out over them"
	fi

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

	# Only the branch head that was read above is merged: the forge refuses one
	# that has moved since.
	gh pr merge "$pr_number" -R "$fabric_repo" --merge --delete-branch --admin --match-head-commit "$read_head" || fail "pull request $pr_number did not merge"
	[ "$live_count" -eq 0 ] || unasked="; the $live_count attempt(s) live at the merge were not asked after"
	merged="$(gh pr view "$pr_number" -R "$fabric_repo" --json mergeCommit --jq '.mergeCommit.oid' || true)"
	printf '%s' "$merged" | grep -Eqx '[0-9a-f]{40}' || refuse "the merge commit of pull request $pr_number could not be read"
	say "merged as $merged"

	# A wait is for the revision the command reads to contain the merge. Each
	# wait is capped by itself, and one that runs out is the finding it was
	# given and what was last read, said apart where the clone has no such
	# commit. Between askings the check may end the landing.
	wait_for() { # <the finding> <check> <command...>
		finding="$1"
		unless="$2"
		shift 2
		waited=0
		while :; do
			reads="$("$@" 2>/dev/null || true)"
			! contains "$reads" "$merged" || break
			"$unless"
			if [ "$waited" -ge "$wait_secs" ]; then
				[ -n "$reads" ] || fail "$finding; it answered no revision"
				git -C "$fabric" cat-file -e "${reads##*:}^{commit}" 2>/dev/null || fail "$finding; it is at $reads, which the main of $fabric_repo was not found to hold"
				fail "$finding; it is at $reads"
			fi
			sleep 5
			waited=$((waited + 5))
		done
	}
	applied() { # <layer>  the revision its Kustomization last applied
		kube -n flux-system get kustomization "$1" -o jsonpath='{.status.lastAppliedRevision}'
	}
	# A migrate Job that failed, as kustomize-controller says it of the layer
	# that applies the Job: the revision that layer attempted, the reason of
	# its Ready condition, and a message naming what its health check found
	# failed. The header argues each term. The logs it names are every
	# container's, an init container's among them, and a container that never
	# started is an error kubectl is told not to stop at.
	unless_migration_failed() {
		said="$(kube -n flux-system get kustomization chuggy-migrate -o jsonpath='{.status.lastAttemptedRevision} {.status.conditions[?(@.type=="Ready")].reason} {.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || true)"
		case "${said#* }" in
		"HealthCheckFailed "*"Job/$namespace/$job status: 'Failed'"*) ;;
		*) return 0 ;;
		esac
		contains "${said%% *}" "$merged" || return 0
		fail "$job failed, so Flux applied no service of $tag and each is left on the release before it; \`kubectl --context $context -n $namespace logs job/$job --all-containers --prefix --ignore-errors\` shows which of its containers failed"
	}
	# The source alone is asked to reconcile, as the header argues, through
	# the annotation the flux client's own `reconcile` writes. It is the one
	# the `chuggy` layer was read to name before anything was decided.
	stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	kube -n flux-system annotate --overwrite "gitrepository/$source_name" "reconcile.fluxcd.io/requestedAt=$stamp" >/dev/null || refuse "the source could not be asked to reconcile"
	unreached="did not reach $merged within ${wait_secs}s"
	wait_for "the fabric source $unreached" true kube -n flux-system get "gitrepository/$source_name" -o jsonpath='{.status.artifact.revision}'
	# The layers, in the order Flux applies them. Whether the migrate Job
	# failed is asked only while its layer is the one waited on, as the header
	# argues.
	wait_for "the apps Kustomization $unreached: it applies what a release runs on and no part of one, and it holds this one, for Flux makes no migrate Job and applies no service of $tag until it has" true applied apps
	wait_for "the chuggy-migrate Kustomization $unreached: it applies the migrate Job, and Flux applies no service of $tag until $job completes" unless_migration_failed applied chuggy-migrate
	wait_for "the chuggy Kustomization $unreached: it applies the services, and $job completed before them" true applied chuggy

	# That is Flux's account of the release. The Job the manifest names is
	# asked after itself, and then each Deployment.
	kube -n "$namespace" wait --for=condition=complete "job/$job" "--timeout=${wait_secs}s" >/dev/null \
		|| fail "$job did not complete; read its log before anything else"

	# Every Deployment in the namespace, held to the image its own manifest
	# names — the manifest is the release, so the cluster is compared with it
	# rather than with this run's memory of what moved.
	deployments="$(kube -n "$namespace" get deployments -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' || true)"
	[ -n "$deployments" ] || refuse "no Deployment could be read in $namespace"
	wrong=0
	while read -r name; do
		[ -n "$name" ] || continue
		[ -f "$cluster/chuggy/$name.yaml" ] || continue
		expected="$(manifest_image "chuggy/$name.yaml")"
		[ -n "$expected" ] || continue
		kube -n "$namespace" rollout status "deployment/$name" "--timeout=${wait_secs}s" >/dev/null || fail "$name did not roll out"
		running="$(kube -n "$namespace" get "deployment/$name" -o jsonpath='{.spec.template.spec.containers[*].image}')" || refuse "what $name runs could not be read"
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
	[ "$live_count" -gt 0 ] || exit 0
	unasked=""

	# What became of each attempt the release went out over, as its own row
	# says and no further: its state, the evidence it ended with, its lease,
	# and whether a pool holds it. A session records its ordinary end, a pod
	# that drained its mailbox and stopped, as `Lost` with `SessionIdle`, so
	# that one is no loss. A lease is written only by the pod's heartbeat or by
	# the poll of the pool that holds the attempt, each through a plane, so one
	# that is not what it was at the first reading is that attempt heard from
	# since the rollout. A placing attempt its pod has not written and no pool
	# holds has nothing renewing it, so it is not waited for; but one whose
	# lease has run out by the database's own clock is what the scheduler ends
	# next, so it is read as `lapsed` and waited for with those not heard from.
	asked="$(printf '%s\n' "$live" | sed "s/^\(.*\) \(.*\)$/('\1','\2')/" | paste -sd, -)"
	sought="$(printf '%s\n' "$live" | sort)"
	first=""
	waited=0
	while :; do
		fates="$(sql "select state || ' ' || kind || ' ' || attempt || ' ' || coalesce((extract(epoch from lease_expires_at) * 1000000)::bigint::text, '-') || ' ' || case when pool is not null then 'held' when lease_expires_at <= now() then 'lapsed' else 'unheld' end || ' in ' || tenant || '/' || project || coalesce(': ' || regexp_replace(evidence, '[[:space:]]+', ' ', 'g'), '') from (select 'work' as kind, tenant, project, attempt, state, evidence, lease_expires_at, pool from execution_attempt union all select 'session', tenant, project, attempt, state, evidence, lease_expires_at, pool from session_attempt) a where (kind, attempt) in ($asked)" 2>/dev/null)" || refuse "what became of the $live_count attempt(s) live at the merge could not be read"
		[ -n "$first" ] || first="$fates"
		answered=""
		ended=0
		heard=0
		unstarted=0
		lost=0
		unheard=0
		losses=""
		silences=""
		while read -r state kind attempt lease holder rest; do
			case "$state $kind $rest" in
			"Reported "* | "Withdrawn "* | "Superseded "* | "Lost session "*": SessionIdle") ended=$((ended + 1)) ;;
			"Lost "*)
				lost=$((lost + 1))
				losses="${losses:+$losses$newline}LOST — $kind attempt $attempt $rest"
				;;
			"Running "* | "Placing "*)
				if renewed "$(printf '%s\n' "$first" | awk -v kind="$kind" -v attempt="$attempt" '$2 == kind && $3 == attempt { print $4 }')" "$lease"; then
					heard=$((heard + 1))
				elif [ "$state $holder" = "Placing unheld" ]; then
					unstarted=$((unstarted + 1))
				else
					unheard=$((unheard + 1))
					silences="${silences:+$silences$newline}UNHEARD — $kind attempt $attempt $rest"
				fi
				;;
			*) continue ;;
			esac
			answered="${answered:+$answered$newline}$kind $attempt"
		done <<-FATES
			$fates
		FATES
		[ "$(printf '%s\n' "$answered" | sort)" = "$sought" ] || refuse "the database did not answer for exactly the $live_count attempt(s) live at the merge, so what became of them is unknown"
		if [ "$unheard" -eq 0 ] || [ "$waited" -ge "$heard_secs" ]; then break; fi
		sleep 5
		waited=$((waited + 5))
	done
	[ -z "$losses" ] || printf '%s\n' "$losses" | sed 's/^/deploy-to-gtr: /'
	[ -z "$silences" ] || printf '%s\n' "$silences" | sed 's/^/deploy-to-gtr: /'
	counts="$ended ended, $heard running and heard from since the rollout, $unstarted not yet started"
	silent="$unheard running had no lease renewed within ${heard_secs}s of the rollout, and whether any such attempt outlasts the release is not known"
	if [ "$lost" -gt 0 ] && [ "$unheard" -gt 0 ]; then
		fail "of $live_count attempt(s) live at the merge, the database records $lost lost, and $silent; $counts"
	elif [ "$lost" -gt 0 ]; then
		fail "of $live_count attempt(s) live at the merge, the database records $lost lost; $counts"
	elif [ "$unheard" -gt 0 ]; then
		refuse "of $live_count attempt(s) live at the merge, $silent; $counts"
	fi
	say "of $live_count attempt(s) live at the merge, none is recorded lost: $counts"
	exit 0
}

if [ "$merge" -eq 1 ]; then
	pr_url="$(gh pr list -R "$fabric_repo" --head "$branch" --state open --json url --jq '.[].url')"
	[ -n "$pr_url" ] || refuse "no open pull request stands for $branch; run without --merge first"
	land "$pr_url"
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
if moved src images/api package.json package-lock.json; then api_moved=1; fi
if moved ui/chuggy-ui src/contract scripts/console-policy.ts scripts/check-console-policy.ts images/chuggy-ui package.json package-lock.json; then ui_moved=1; fi
if moved images/worker; then
	say "WARNING — images/worker changed since $deployed; the worker is built and admitted by the fabric, not here, and this release does not move it"
fi
if [ "$console" -eq 1 ]; then
	[ "$ui_moved" -eq 1 ] || refuse "nothing the console serves moved since $deployed, so there is no console release"
	[ "$api_moved" -eq 0 ] || refuse "the change since $deployed moves the api, so it is not a console release; run without --console"
fi

# --- the gate -------------------------------------------------------------------

if [ "${CHUG_RELEASE_GATE:-}" = "0" ]; then
	gate="skipped by CHUG_RELEASE_GATE=0"
	say "gate $gate; this release carries no verdict of its own"
elif [ "${CHUG_RELEASE_GATE:-}" = "full" ] || [ "$back" -eq 1 ]; then
	say "gating $tag with every gate"
	set +e
	CHUG_CI_FULL=1 ./.chug/tasks/ci.sh
	gated=$?
	set -e
	[ "$gated" -eq 0 ] || leave_as "$gated" "the gate did not pass $tag, so it is not released"
	gate="clean over every gate"
else
	say "gating $tag with the gates the change since $deployed affects"
	set +e
	# The runner selects by the base only when nothing asks it for every gate,
	# and a full run in this environment would. It is asked to answer a range
	# that selects nothing as a could-not-run, because a verdict over no gate
	# is not one about this release.
	CHUG_CI_FULL= CHUG_CI_BASE="$deployed" CHUG_CI_NEEDS_GATE=1 ./.chug/tasks/ci.sh
	gated=$?
	set -e
	if [ "$gated" -eq 1 ]; then
		fail "the gate did not pass $tag, so it is not released"
	elif [ "$gated" -ne 0 ]; then
		refuse "the gate could not run over the change since $deployed, so $tag is not released; CHUG_RELEASE_GATE=full runs every gate"
	fi
	gate="clean over the gates the change since $deployed affects"
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
if [ "$api_moved" -eq 1 ]; then publish api api "$tag"; api_digest="$digest"; fi
if [ "$ui_moved" -eq 1 ]; then publish chuggy-ui web "chuggy-ui-$tag"; ui_digest="$digest"; fi

# --- the manifests --------------------------------------------------------------

api_manifests="chuggy/chuggy-api.yaml chuggy/chuggy-configuration-importer.yaml chuggy/chuggy-finalizer.yaml chuggy-migrate/chuggy-migrate.yaml chuggy/chuggy-pool-plane.yaml chuggy/chuggy-scheduler.yaml chuggy/chuggy-selector.yaml chuggy/chuggy-ticket-service.yaml chuggy/chuggy-worker-plane.yaml"
console_manifests="chuggy/chuggy-ui.yaml"

rewrite() { # <manifest> <sed expression>
	[ -f "$cluster/$1" ] || refuse "the fabric has no cluster/$1 to edit"
	sed "$2" "$cluster/$1" >"$work/edited"
	mv "$work/edited" "$cluster/$1"
}
image_line() { # <repository> <digest>
	printf 's|^\\([[:space:]]*image: %s/%s@\\)sha256:[0-9a-f]*[[:space:]]*$|\\1%s|' "$registry_prefix" "$1" "$2"
}
for manifest in $api_manifests $console_manifests; do
	rewrite "$manifest" "s|^\\([[:space:]]*fabric\\.chuggy\\.dev/source-commit:[[:space:]]*\\).*\$|\\1$tag|"
done
rewrite chuggy-migrate/chuggy-migrate.yaml "s|^\\([[:space:]]*name: chuggy-migrate-\\)[a-z0-9-]*\$|\\1$tag-registry|"
if [ -n "$api_digest" ]; then
	for manifest in $api_manifests; do
		rewrite "$manifest" "$(image_line api "$api_digest")"
		[ "$(manifest_image "$manifest")" = "$registry_prefix/api@$api_digest" ] || fail "$manifest does not carry the api digest after the edit"
	done
fi
if [ -n "$ui_digest" ]; then
	rewrite chuggy/chuggy-ui.yaml "$(image_line web "$ui_digest")"
	[ "$(manifest_image chuggy/chuggy-ui.yaml)" = "$registry_prefix/web@$ui_digest" ] || fail "chuggy-ui.yaml does not carry the console digest after the edit"
fi
git -C "$fabric" diff --quiet && fail "the edit changed no manifest, so there is no release to commit"
set +e
python3 "$fabric/scripts/check-release-consistency" "$cluster"
consistent=$?
set -e
if [ "$consistent" -eq 3 ]; then
	fail "the fabric's consistency check refuses the edited manifests"
elif [ "$consistent" -ne 0 ]; then
	refuse "the fabric's consistency check did not run, and answered $consistent"
fi
# Each of a release's directories is a kustomization, rendered by itself as
# the Flux layer that applies it renders it.
for layer in chuggy-migrate chuggy; do
	kube kustomize "$cluster/$layer" >/dev/null || fail "the edited manifests under cluster/$layer do not render"
done

# --- the fabric change ----------------------------------------------------------

{
	printf 'release: chuggy %s\n\n' "$tag"
	printf 'The rig moves from %s to %s, which carries:\n\n' "$deployed" "$tag"
	git log --format='  %h %s' "$deployed..HEAD"
	printf '\n'
	if [ -n "$api_digest" ]; then printf 'api: %s\n' "$api_digest"; else printf 'api: unchanged\n'; fi
	if [ -n "$ui_digest" ]; then printf 'web: %s\n' "$ui_digest"; else printf 'web: unchanged\n'; fi
	if [ -n "$migrations" ]; then
		printf '\nWhat moved under the migrations the Job applies, below which the only way back is a restore:\n'
		printf '%s\n' "$migrations" | sed 's|^src/adapters/postgres/schema/migrations/|  |'
	else
		printf '\nNo migration: the migrate Job applies nothing.\n'
	fi
	printf '\nGate at %s: %s.\n' "$tag" "$gate"
} >"$work/message"

git -C "$fabric" checkout -q -b "$branch"
# The manifests that were edited are what is staged, by the lists they were
# edited by: anything else a step above left in the clone is not the release.
for manifest in $api_manifests $console_manifests; do
	git -C "$fabric" add "cluster/$manifest"
done
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
if [ "$console" -eq 1 ]; then
	land "$pr_url"
fi
say "not merged. Review it, then land it and roll it out with:"
say "  CHUG_RIG_SSH=$node deploy/rig/deploy-to-gtr.sh --merge"
