#!/bin/sh
# Shell test for deploy-to-gtr.sh, over what it decides and no more: what it
# refuses before touching anything, which images a change rebuilds, that a
# digest comes from the registry's answer and not the push, what the fabric
# change carries, and what `--merge` requires of the cluster before and after
# it moves it.
#
# NOTHING HERE BUILDS, PUSHES OR REACHES A CLUSTER. `docker`, `ssh`, `kubectl`,
# `gh` and `python3` are stubs on PATH that log every invocation and answer
# from environment the case sets, and `sleep` is one that logs and returns; the
# gate and the image builder are stubs inside a throwaway checkout; and the
# fabric is a bare repository the `gh` stub clones, so what the script pushes
# can be read back out of it.
#
# THE MIRROR CASES MATTER AS MUCH. A guard that refuses everything is the same
# defect wearing the other face, so each refusal has a case where the thing
# being checked is there and the run goes on.
#
# Run:  ./deploy/rig/deploy-to-gtr.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../.chug/tasks/_suite.sh"
SUT="$HERE/deploy-to-gtr.sh"

BIN="$WORK/bin"
NOBIN="$WORK/nobin"
REPO="$WORK/repo"
ORIGIN="$WORK/origin.git"
FABRIC_GIT="$WORK/fabric.git"
FABRIC_SEED="$WORK/fabric-seed"
LOG="$WORK/calls.log"
ARCHIVE="$WORK/archive"
mkdir -p "$BIN" "$NOBIN" "$ARCHIVE"

# The script commits inside the clone the gh stub makes, which carries no
# identity of its own, and neither does a machine with no global git config.
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com \
	GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

ln -s "$(command -v git)" "$NOBIN/git"
ln -s "$(command -v sh)" "$NOBIN/sh"

digest_of() { # <letter>
	printf 'sha256:%s' "$(printf '%064d' 0 | tr 0 "$1")"
}
OLD_API="$(digest_of a)"
OLD_UI="$(digest_of b)"
NEW="$(digest_of d)"
STALE="$(digest_of e)"
MERGED="$(printf '%040d' 0 | tr 0 f)"

# --- the stubs -----------------------------------------------------------------

cat >"$BIN/docker" <<'STUB'
#!/bin/sh
printf 'docker %s\n' "$*" >>"$CHUG_STUB_LOG"
STUB

cat >"$BIN/ssh" <<'STUB'
#!/bin/sh
set -u
printf 'ssh %s\n' "$*" >>"$CHUG_STUB_LOG"
shift
case "$1" in
true) exit "${CHUG_STUB_NODE_RC:-0}" ;;
curl)
	printf 'HTTP/1.1 200 OK\r\n'
	printf 'Content-Type: application/vnd.oci.image.manifest.v1+json\r\n'
	[ -z "${CHUG_STUB_DIGEST:-}" ] || printf 'Docker-Content-Digest: %s\r\n' "$CHUG_STUB_DIGEST"
	;;
sudo) exit "${CHUG_STUB_PUSH_RC:-0}" ;;
esac
exit 0
STUB

cat >"$BIN/kubectl" <<'STUB'
#!/bin/sh
set -u
printf 'kubectl %s\n' "$*" >>"$CHUG_STUB_LOG"
args=" $* "
case "$args" in
*' get service registry '*) printf '10.0.0.1' ;;
*' kustomize '*) exit "${CHUG_STUB_RENDER_RC:-0}" ;;
# The work namespace answers by selector, and a pod carries one attempt label
# or the other: each label sees the pods a case says are attempts of that kind,
# and an unselected listing sees everything else there. A namespace that cannot
# be read answers neither.
*' -n chuggy-work get pods -l chuggy.dev/worker=true '*)
	[ "${CHUG_STUB_WORK_PODS_RC:-0}" -eq 0 ] || exit "$CHUG_STUB_WORK_PODS_RC"
	printf '%s' "${CHUG_STUB_WORKER_PODS:-}"
	;;
*' -n chuggy-work get pods -l chuggy.dev/session=true '*)
	[ "${CHUG_STUB_WORK_PODS_RC:-0}" -eq 0 ] || exit "$CHUG_STUB_WORK_PODS_RC"
	printf '%s' "${CHUG_STUB_SESSION_PODS:-}"
	;;
*' -n chuggy-work get pods '*) printf '%s' "${CHUG_STUB_UNLABELLED_PODS:-}" ;;
*'terminal_at is null'*) printf '%s' "${CHUG_STUB_LIVE_ROWS-0}" ;;
# The attempts that have not ended, a kind and an identity a line, and then
# what the rows asked after by both say became of them: one answer to the
# first asking, and another to each asking after it where a case sets one.
*'ended_at is null'*)
	[ "${CHUG_STUB_ATTEMPTS_RC:-0}" -eq 0 ] || exit "$CHUG_STUB_ATTEMPTS_RC"
	printf '%s' "${CHUG_STUB_ATTEMPTS:-}"
	;;
*'(kind, attempt) in ('*)
	[ "${CHUG_STUB_FATES_RC:-0}" -eq 0 ] || exit "$CHUG_STUB_FATES_RC"
	if [ "$(grep -c '(kind, attempt) in (' "$CHUG_STUB_LOG")" -gt 1 ] && [ -n "${CHUG_STUB_FATES_THEN+set}" ]; then
		printf '%s' "$CHUG_STUB_FATES_THEN"
	else
		printf '%s' "${CHUG_STUB_FATES:-}"
	fi
	;;
*'max(version)'*) printf '52' ;;
*' pg_dump '*) printf '%s' "${CHUG_STUB_DUMP:-PGDMP-archive}" ;;
*' pg_dumpall '*) printf 'globals\n' ;;
*'{.spec.sourceRef.name}'*) printf 'fabric' ;;
*' annotate '*) ;;
*'{.status.artifact.revision}'* | *'{.status.lastAppliedRevision}'*) printf 'main@sha1:%s' "${CHUG_STUB_MERGED:-}" ;;
*' wait '*) exit "${CHUG_STUB_JOB_RC:-0}" ;;
*' get deployments '*) printf 'chuggy-api\nchuggy-ui\nunmanaged\n' ;;
*' rollout status '*) exit "${CHUG_STUB_ROLLOUT_RC:-0}" ;;
*' get deployment/'*)
	name=""
	for word in "$@"; do
		case "$word" in deployment/*) name="${word#deployment/}" ;; esac
	done
	if [ "$name" = "${CHUG_STUB_STALE:-}" ]; then
		printf 'registry.chuggy.internal/chuggy/api@%s' "$CHUG_STUB_STALE_DIGEST"
	else
		git --git-dir="$CHUG_STUB_FABRIC" show "$CHUG_STUB_BRANCH:cluster/apps/$name.yaml" \
			| sed -n 's/^[[:space:]]*image: \(registry\.chuggy\.internal.*\)$/\1/p' | head -n 1
	fi
	;;
esac
exit 0
STUB

cat >"$BIN/gh" <<'STUB'
#!/bin/sh
set -u
printf 'gh %s\n' "$*" >>"$CHUG_STUB_LOG"
case "$1 $2" in
'repo clone')
	git clone -q "$CHUG_STUB_FABRIC" "$4"
	# A clone whose pushes go where this identity may not write.
	[ -z "${CHUG_STUB_PUSH_DENIED:-}" ] || git -C "$4" remote set-url --push origin "$CHUG_STUB_PUSH_DENIED"
	;;
'pr list')
	head=""
	while [ "$#" -gt 0 ]; do
		[ "$1" = "--head" ] && head="${2:-}"
		shift
	done
	[ "$head" = "${CHUG_STUB_PR_HEAD:-}" ] && printf '%s\n' "${CHUG_STUB_PR_URL:-}"
	;;
'pr create')
	while [ "$#" -gt 0 ]; do
		[ "$1" = "--body-file" ] && cp "${2:-}" "$CHUG_STUB_LOG.body"
		shift
	done
	printf 'https://example.test/pull/7\n'
	;;
'pr merge') exit "${CHUG_STUB_MERGE_RC:-0}" ;;
'pr view') printf '%s\n' "${CHUG_STUB_MERGED:-}" ;;
esac
exit 0
STUB

cat >"$BIN/python3" <<'STUB'
#!/bin/sh
printf 'python3 %s\n' "$*" >>"$CHUG_STUB_LOG"
exit "${CHUG_STUB_CONSISTENCY_RC:-0}"
STUB

# A wait is logged and not sat through, so a case can count the waits.
cat >"$BIN/sleep" <<'STUB'
#!/bin/sh
printf 'sleep %s\n' "$*" >>"$CHUG_STUB_LOG"
STUB

chmod +x "$BIN/docker" "$BIN/ssh" "$BIN/kubectl" "$BIN/gh" "$BIN/python3" "$BIN/sleep"

# --- the checkout, with its gate and its builder stubbed inside it ---------------

git init -q --bare "$ORIGIN"
fresh_repo "$REPO"
git -C "$REPO" remote add origin "$ORIGIN"
mkdir -p "$REPO/src/contract" "$REPO/src/adapters/postgres/schema/migrations" "$REPO/ui/chuggy-ui" \
	"$REPO/images/api" "$REPO/images/chuggy-ui" "$REPO/images/worker" \
	"$REPO/scripts" "$REPO/.chug/tasks" "$REPO/deploy/rig/images"
for file in src/a.ts src/contract/c.ts ui/chuggy-ui/app.ts images/api/Dockerfile \
	images/chuggy-ui/Dockerfile images/chuggy-ui/nginx.conf images/worker/Dockerfile package.json \
	package-lock.json scripts/console-policy.ts scripts/check-console-policy.ts \
	src/adapters/postgres/schema/migrations/001-a.ts src/adapters/postgres/schema/migrations/index.ts; do
	printf 'fixture\n' >"$REPO/$file"
done
printf 'export const workerContractRelease = "1.6.0";\n' >"$REPO/src/contract/workerContract.ts"
cat >"$REPO/.chug/tasks/ci.sh" <<'STUB'
#!/bin/sh
printf 'ci prefix=<%s> full=<%s> base=<%s> needs=<%s>\n' "${CHUG_IMAGE_PREFIX:-}" "${CHUG_CI_FULL:-}" "${CHUG_CI_BASE:-}" "${CHUG_CI_NEEDS_GATE:-}" >>"$CHUG_STUB_LOG"
exit "${CHUG_STUB_GATE_RC:-0}"
STUB
cat >"$REPO/deploy/rig/images/build-and-import.sh" <<'STUB'
#!/bin/sh
printf 'build-and-import %s tag=%s prefix=%s\n' "$*" "${CHUG_IMAGE_TAG:-}" "${CHUG_IMAGE_PREFIX:-}" >>"$CHUG_STUB_LOG"
exit "${CHUG_STUB_BUILD_RC:-0}"
STUB
chmod +x "$REPO/.chug/tasks/ci.sh" "$REPO/deploy/rig/images/build-and-import.sh"
cp "$SUT" "$REPO/deploy/rig/deploy-to-gtr.sh"
git -C "$REPO" add -A
git -C "$REPO" commit -qm deployed
git -C "$REPO" push -q origin main
DEPLOYED="$(git -C "$REPO" rev-parse --short HEAD)"
DEPLOYED_FULL="$(git -C "$REPO" rev-parse HEAD)"

# --- the fabric, as a bare repository the gh stub clones ------------------------

manifest() { # <name> <kind> <repository> <digest>
	cat <<-MANIFEST
		apiVersion: apps/v1
		kind: $2
		metadata:
		  name: $1
		  namespace: chuggy
		  annotations:
		    fabric.chuggy.dev/source-commit: $DEPLOYED
		spec:
		  template:
		    spec:
		      containers:
		        - name: main
		          image: registry.chuggy.internal/chuggy/$3@$4
	MANIFEST
}
mkdir -p "$FABRIC_SEED/cluster/apps" "$FABRIC_SEED/scripts"
for name in chuggy-api chuggy-configuration-importer chuggy-finalizer chuggy-pool-plane chuggy-scheduler \
	chuggy-selector chuggy-ticket-service chuggy-worker-plane; do
	manifest "$name" Deployment api "$OLD_API" >"$FABRIC_SEED/cluster/apps/$name.yaml"
done
manifest chuggy-ui Deployment web "$OLD_UI" >"$FABRIC_SEED/cluster/apps/chuggy-ui.yaml"
# The worker plane states how it rolls, in the fabric's own shape but for a
# blank line inside the mapping, and is followed by a document that bounds an
# unavailability of its own: what a landing reads is the whole of the
# Deployment's strategy and nothing after it.
{
	manifest chuggy-worker-plane Deployment api "$OLD_API" | sed 's|^spec:$|&\
  strategy:\
    type: RollingUpdate\
\
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }|'
	printf -- '---\napiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: chuggy-worker-plane\n'
	printf 'spec:\n  maxUnavailable: 0\n'
} >"$FABRIC_SEED/cluster/apps/chuggy-worker-plane.yaml"
# The migrate manifest carries a ServiceAccount named after the Job's family,
# an init container from a public repository, and then the Job: the release
# must find the Job's name and the release image past both.
{
	printf 'apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: chuggy-migrate\n---\n'
	printf 'apiVersion: batch/v1\nkind: Job\nmetadata:\n  name: chuggy-migrate-%s-registry\n' "$DEPLOYED"
	printf '  annotations:\n    fabric.chuggy.dev/source-commit: %s\n' "$DEPLOYED"
	printf 'spec:\n  template:\n    spec:\n      initContainers:\n        - name: wait\n          image: postgres:18\n'
	printf '      containers:\n        - name: migrate\n          image: registry.chuggy.internal/chuggy/api@%s\n' "$OLD_API"
} >"$FABRIC_SEED/cluster/apps/chuggy-migrate.yaml"
printf 'stub\n' >"$FABRIC_SEED/scripts/check-release-consistency"
git init -q -b main "$FABRIC_SEED"
git -C "$FABRIC_SEED" config user.email t@example.com
git -C "$FABRIC_SEED" config user.name t
git -C "$FABRIC_SEED" add -A
git -C "$FABRIC_SEED" commit -qm seed
git clone -q --bare "$FABRIC_SEED" "$FABRIC_GIT"
FABRIC_SEED_SHA="$(git --git-dir="$FABRIC_GIT" rev-parse main)"

# --- the drivers ------------------------------------------------------------------

fresh_case() {
	: >"$LOG"
	rm -f "$LOG.body" "$ARCHIVE"/*
	git -C "$REPO" reset -q --hard "$DEPLOYED_FULL"
	git -C "$REPO" push -q -f origin main
	git --git-dir="$FABRIC_GIT" update-ref refs/heads/main "$FABRIC_SEED_SHA"
	for ref in $(git --git-dir="$FABRIC_GIT" for-each-ref --format='%(refname:short)' refs/heads/release); do
		git --git-dir="$FABRIC_GIT" branch -q -D "$ref"
	done
	unset CHUG_RIG_SSH CHUG_RIG_ARCHIVE CHUG_RELEASE_GATE CHUG_IMAGE_PREFIX CHUG_CI_FULL CHUG_CI_BASE
	unset CHUG_STUB_DIGEST CHUG_STUB_PUSH_RC CHUG_STUB_GATE_RC CHUG_STUB_BUILD_RC CHUG_STUB_CONSISTENCY_RC
	unset CHUG_STUB_RENDER_RC CHUG_STUB_LIVE_ROWS CHUG_STUB_PR_HEAD CHUG_STUB_PR_URL
	unset CHUG_STUB_WORKER_PODS CHUG_STUB_SESSION_PODS CHUG_STUB_UNLABELLED_PODS CHUG_STUB_WORK_PODS_RC
	unset CHUG_STUB_MERGE_RC CHUG_STUB_MERGED CHUG_STUB_JOB_RC CHUG_STUB_ROLLOUT_RC CHUG_STUB_STALE CHUG_STUB_BRANCH
	unset CHUG_STUB_DUMP CHUG_STUB_NODE_RC CHUG_STUB_PUSH_DENIED
	unset CHUG_STUB_ATTEMPTS CHUG_STUB_ATTEMPTS_RC CHUG_STUB_FATES CHUG_STUB_FATES_THEN CHUG_STUB_FATES_RC
	unset CHUG_RELEASE_HEARD_SECS CHUG_CI_NEEDS_GATE
	export CHUG_RIG_SSH=nobody@no-such-host
	export CHUG_STUB_DIGEST="$NEW"
}

# A commit on main touching the named paths, pushed so that HEAD is on
# origin/main; the tag the release will carry is then HEAD's.
advance() { # <path>...
	for path in "$@"; do
		printf 'changed\n' >>"$REPO/$path"
	done
	git -C "$REPO" add -A
	git -C "$REPO" commit -qm "touch $*"
	git -C "$REPO" push -q origin main
	TAG="$(git -C "$REPO" rev-parse --short HEAD)"
	export CHUG_STUB_BRANCH="release/chuggy-$TAG"
}

# The fabric's main comes to name another commit as live, as a release that
# landed would leave it.
rig_at() { # <short commit>
	rm -rf "$WORK/rig-at"
	git clone -q "$FABRIC_GIT" "$WORK/rig-at"
	git -C "$WORK/rig-at" config user.email t@example.com
	git -C "$WORK/rig-at" config user.name t
	for name in $(ls "$WORK/rig-at/cluster/apps"); do
		sed -i "s|source-commit: $DEPLOYED|source-commit: $1|; s|chuggy-migrate-$DEPLOYED-|chuggy-migrate-$1-|" "$WORK/rig-at/cluster/apps/$name"
	done
	git -C "$WORK/rig-at" commit -qam "release: chuggy $1"
	git -C "$WORK/rig-at" push -q origin main
}

run() { # <argument...>
	OUT="$WORK/.out"
	set +e
	(
		cd "$REPO" || exit 2
		PATH="$BIN:$PATH" CHUG_STUB_LOG="$LOG" CHUG_STUB_FABRIC="$FABRIC_GIT" \
			CHUG_STUB_STALE_DIGEST="$STALE" \
			sh "$REPO/deploy/rig/deploy-to-gtr.sh" "$@"
	) >"$OUT" 2>&1
	RC=$?
	set -e
	printf 'tools reached: %s\n' "$(wc -l <"$LOG" | tr -d ' ')" >>"$OUT"
	printf 'builds attempted: %s\n' "$(grep -c '^build-and-import ' "$LOG" || true)" >>"$OUT"
	printf 'gates run: %s\n' "$(grep -c '^ci ' "$LOG" || true)" >>"$OUT"
	printf 'pushes attempted: %s\n' "$(grep -c 'images push' "$LOG" || true)" >>"$OUT"
	printf 'pull requests opened: %s\n' "$(grep -c '^gh pr create ' "$LOG" || true)" >>"$OUT"
	printf 'merges attempted: %s\n' "$(grep -c '^gh pr merge ' "$LOG" || true)" >>"$OUT"
	printf 'fates asked for: %s\n' "$(grep -c '(kind, attempt) in (' "$LOG" || true)" >>"$OUT"
	printf 'waits: %s\n' "$(grep -c '^sleep ' "$LOG" || true)" >>"$OUT"
	echo "--- the calls, in order" >>"$OUT"
	cat "$LOG" >>"$OUT"
	echo "--- the pull request body" >>"$OUT"
	[ ! -f "$LOG.body" ] || cat "$LOG.body" >>"$OUT"
}

# What the fabric now holds on the release branch, read out of the bare
# repository the script pushed to rather than out of the script's own output.
released() { # <manifest>
	git --git-dir="$FABRIC_GIT" show "release/chuggy-$TAG:cluster/apps/$1" 2>/dev/null || true
}
count_in_release() { # <fixed string>
	total=0
	for name in $(git --git-dir="$FABRIC_GIT" ls-tree --name-only "release/chuggy-$TAG:cluster/apps" 2>/dev/null); do
		total=$((total + $(released "$name" | grep -Fc "$1" || true)))
	done
	printf '%s' "$total"
}

untouched="tools reached: 0"

# --- refused while refusing is still free ---------------------------------------

fresh_case
run --frobnicate
check "an unknown argument is refused" 2 "$RC" "unknown argument --frobnicate"
check "an unknown argument reaches no tool" 2 "$RC" "$untouched"

fresh_case
unset CHUG_RIG_SSH
run
check "no node is refused" 2 "$RC" "CHUG_RIG_SSH must name"
check "no node reaches no tool" 2 "$RC" "$untouched"

fresh_case
printf 'dirt\n' >"$REPO/dirt"
run
check "a dirty tree is refused" 2 "$RC" "the working tree is dirty"
check "a dirty tree reaches no tool" 2 "$RC" "$untouched"
rm -f "$REPO/dirt"

fresh_case
printf 'local\n' >>"$REPO/src/a.ts"
git -C "$REPO" commit -qam "not pushed"
run
check "a HEAD main does not have is refused" 2 "$RC" "HEAD is not on origin/main"
check "an unpushed HEAD builds nothing" 2 "$RC" "builds attempted: 0"

fresh_case
run
check "a HEAD the rig already runs is nothing to release" 0 "$RC" "already at $DEPLOYED"
check "nothing to release builds nothing" 0 "$RC" "builds attempted: 0"

# --- what must answer before the slow work, and refuses before it ----------------

fresh_case
advance src/a.ts
export CHUG_STUB_NODE_RC=255
run
check "a node that does not answer is refused" 2 "$RC" "does not answer over ssh"
check "a silent node is refused before the gate" 2 "$RC" "gates run: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_PUSH_DENIED="$WORK/nowhere.git"
run
check "a push this identity may not make is refused" 2 "$RC" "refuses a push to release/chuggy-$TAG from this identity; git said:"
check "a denied push is refused before the gate" 2 "$RC" "gates run: 0"
check "a denied push builds nothing" 2 "$RC" "builds attempted: 0"

# The mirror: the same run with the push allowed goes through the gate.
fresh_case
advance src/a.ts
run
check "a push this identity may make is rehearsed dry and then gated" 0 "$RC" "gates run: 1"

# --- which images a change rebuilds ---------------------------------------------

fresh_case
advance ui/chuggy-ui/app.ts
run
check "a console change releases" 0 "$RC" "pull request https://example.test/pull/7"
check "a console change builds the console image" 0 "$RC" "build-and-import chuggy-ui tag=$TAG"
check "a console change builds only the console" 0 "$RC" "builds attempted: 1"
check "the console is published under the web repository" 0 "$RC" "images push --plain-http 10.0.0.1:5000/chuggy/web:chuggy-ui-$TAG"
check "the release is not merged by this run" 0 "$RC" "not merged"
OUT="$WORK/.release"
released chuggy-ui.yaml >"$OUT"
check "the console manifest selects the registry's digest" 0 "$RC" "chuggy/web@$NEW"
released chuggy-api.yaml >"$OUT"
check "the api manifest keeps its digest" 0 "$RC" "chuggy/api@$OLD_API"
printf 'source commits moved: %s\n' "$(count_in_release "source-commit: $TAG")" >"$OUT"
check "the source commit moves on every manifest" 0 "$RC" "source commits moved: 10"
printf 'stale source commits: %s\n' "$(count_in_release "source-commit: $DEPLOYED")" >"$OUT"
check "no manifest keeps the old source commit" 0 "$RC" "stale source commits: 0"
released chuggy-migrate.yaml >"$OUT"
check "the migrate Job is renamed after the release" 0 "$RC" "name: chuggy-migrate-$TAG-registry"
printf 'service account intact: %s\n' "$(released chuggy-migrate.yaml | grep -c '^  name: chuggy-migrate$' || true)" >"$OUT"
check "the migrate ServiceAccount is not renamed" 0 "$RC" "service account intact: 1"
printf 'init image intact: %s\n' "$(released chuggy-migrate.yaml | grep -Fc 'image: postgres:18' || true)" >"$OUT"
check "the init container is left alone" 0 "$RC" "init image intact: 1"
cp "$LOG.body" "$OUT"
check "the pull request says the api did not move" 0 "$RC" "api: unchanged"
check "the pull request carries the commits" 0 "$RC" "touch ui/chuggy-ui/app.ts"
check "the pull request says no migration is applied" 0 "$RC" "No migration"
check "the pull request reports the gate" 0 "$RC" "Gate at $TAG: clean over the gates the change since $DEPLOYED affects"

fresh_case
advance src/a.ts
run
check "a server change builds the api" 0 "$RC" "build-and-import api tag=$TAG prefix=registry.chuggy.internal/chuggy"
check "a server change builds only the api" 0 "$RC" "builds attempted: 1"
# The builder's suite runs inside the gate and reads the builder's variables,
# so the gate must not inherit them.
check "the gate is not handed the builder's prefix" 0 "$RC" "ci prefix=<>"
OUT="$WORK/.release"
printf 'api digests moved: %s\n' "$(count_in_release "chuggy/api@$NEW")" >"$OUT"
check "every control-plane manifest selects the new api" 0 "$RC" "api digests moved: 9"
released chuggy-ui.yaml >"$OUT"
check "the console keeps its digest on a server change" 0 "$RC" "chuggy/web@$OLD_UI"

fresh_case
advance src/contract/c.ts
run
check "a contract change rebuilds the api and the console" 0 "$RC" "builds attempted: 2"

fresh_case
advance images/worker/Dockerfile
run
check "a worker change is reported" 0 "$RC" "WARNING — images/worker changed"
check "a worker change builds nothing here" 0 "$RC" "builds attempted: 0"
check "a worker change still moves the source commit" 0 "$RC" "pull requests opened: 1"

fresh_case
advance src/adapters/postgres/schema/migrations/050-b.ts src/adapters/postgres/schema/migrations/index.ts
run
cp "$LOG.body" "$OUT"
check "the pull request names the migration" 0 "$RC" "  050-b.ts"
check "the pull request says a restore is the way back" 0 "$RC" "only way back is a restore"

# --- the gate ---------------------------------------------------------------------

fresh_case
advance src/a.ts
export CHUG_STUB_GATE_RC=1
run
check "a gate finding stops the release" 1 "$RC" "did not pass $TAG"
check "a failed gate builds nothing" 1 "$RC" "builds attempted: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_GATE_RC=2
run
check "a gate that could not run is not a pass, and is told what runs every gate" 2 "$RC" "the gate could not run over the change since $DEPLOYED, so $TAG is not released; CHUG_RELEASE_GATE=full runs every gate"
check "a gate that could not run builds nothing" 2 "$RC" "builds attempted: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_GATE_RC=3
run
check "a gate that ended any other way is not a pass" 2 "$RC" "the gate could not run over the change since $DEPLOYED"

# The variable takes what the header says it takes: a value it does not know
# is refused before anything runs, and not taken for the gate by what changed.
for value in FULL 1 changed; do
	fresh_case
	advance src/a.ts
	export CHUG_RELEASE_GATE="$value"
	run
	check "a gate setting of $value is refused" 2 "$RC" "CHUG_RELEASE_GATE is \`$value\`, and it takes 0, full or nothing"
	check "a gate setting of $value reaches no tool" 2 "$RC" "$untouched"
done

fresh_case
advance src/a.ts
export CHUG_RELEASE_GATE=
run
check "an empty gate setting is the gate by what changed" 0 "$RC" "base=<$DEPLOYED> needs=<1>"

fresh_case
advance src/a.ts
export CHUG_RELEASE_GATE=0
run
check "the gate can be skipped, and says so" 0 "$RC" "gate skipped by CHUG_RELEASE_GATE=0"
check "a skipped gate is not run" 0 "$RC" "gates run: 0"
cp "$LOG.body" "$OUT"
check "the pull request says the gate was skipped" 0 "$RC" "Gate at $TAG: skipped by CHUG_RELEASE_GATE=0"

# --- the digest is the registry's answer ------------------------------------------

fresh_case
advance src/a.ts
export CHUG_STUB_BUILD_RC=1
run
check "an image that did not reach the node is a finding" 1 "$RC" "api did not reach the node"
check "an unbuilt image is not pushed" 1 "$RC" "pushes attempted: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_PUSH_RC=1
run
check "a push that failed is a finding" 1 "$RC" "could not be tagged for the registry"

fresh_case
advance src/a.ts
unset CHUG_STUB_DIGEST
run
check "a registry that answers no digest is a finding" 1 "$RC" "answered no digest for api:$TAG"
check "no digest opens no pull request" 1 "$RC" "pull requests opened: 0"
printf 'branches: %s\n' "$(git --git-dir="$FABRIC_GIT" for-each-ref refs/heads/release | wc -l | tr -d ' ')" >"$OUT"
check "no digest pushes no fabric branch" 1 "$RC" "branches: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_DIGEST="sha256:notadigest"
run
check "a malformed digest is a finding" 1 "$RC" "answered no digest"

# The consistency check's own protocol: it refuses with 3 and crashes with 1,
# so the release is a finding under the first and a could-not-run under the
# second. A status that meant the same under both would be the release
# believing a control that never ran.
fresh_case
advance src/a.ts
export CHUG_STUB_CONSISTENCY_RC=3
run
check "the fabric's consistency check is obeyed" 1 "$RC" "consistency check refuses"
check "a refused release is not pushed" 1 "$RC" "pull requests opened: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_CONSISTENCY_RC=1
run
check "a consistency check that could not run is not a refusal" 2 "$RC" "consistency check did not run"
check "an unchecked release is not pushed" 2 "$RC" "pull requests opened: 0"

fresh_case
advance src/a.ts
export CHUG_STUB_RENDER_RC=1
run
check "manifests that do not render are a finding" 1 "$RC" "do not render"

# --- --merge: what it requires of the cluster ---------------------------------------

fresh_case
advance src/a.ts
run --merge
check "merging without a pull request is refused" 2 "$RC" "no open pull request stands for release/chuggy-$TAG"
check "no pull request merges nothing" 2 "$RC" "merges attempted: 0"

# The branch the pull request points at was made for another commit.
fresh_case
advance src/a.ts
run
FIRST="$TAG"
advance src/a.ts
git --git-dir="$FABRIC_GIT" branch -q -m "release/chuggy-$FIRST" "release/chuggy-$TAG"
export CHUG_STUB_PR_HEAD="release/chuggy-$TAG" CHUG_STUB_PR_URL=https://example.test/pull/8 CHUG_STUB_MERGED="$MERGED"
run --merge
check "a pull request that selects another commit is refused" 2 "$RC" "does not select $TAG"
check "another commit's pull request is not merged" 2 "$RC" "merges attempted: 0"

# A release to merge: opened by one run, landed by the next.
open_release() { # <path>...
	fresh_case
	advance "$@"
	run
	export CHUG_STUB_PR_HEAD="release/chuggy-$TAG" CHUG_STUB_PR_URL=https://example.test/pull/9 CHUG_STUB_MERGED="$MERGED"
	: >"$LOG"
}

# A branch of the fabric as another hand left it: the command runs in its
# `cluster/apps`, and what it changed is pushed over the branch.
fabric_edited() { # <branch> <command...>
	rm -rf "$WORK/edited"
	git clone -q --branch "$1" "$FABRIC_GIT" "$WORK/edited"
	(cd "$WORK/edited/cluster/apps" && shift && "$@")
	git -C "$WORK/edited" commit -qam edited
	git -C "$WORK/edited" push -q origin "$1"
}
release_edited() { # <command...>
	fabric_edited "release/chuggy-$TAG" "$@"
}

# A release with a migration in it, which is one a landing may not put out over
# a live attempt.
MIGRATION=src/adapters/postgres/schema/migrations/050-b.ts

# Each attempt label is asked for on its own, so a pod carrying either one is
# enough to refuse; a pod carrying neither is not the rollout's business, and
# neither label answering is the emptiness the refusal turns on.
open_release "$MIGRATION"
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --merge
check "a live worker pod refuses a migration's rollout" 1 "$RC" "an attempt is live in chuggy-work, and this release carries a migration"
check "a live attempt is not merged over" 1 "$RC" "merges attempted: 0"

open_release "$MIGRATION"
export CHUG_STUB_SESSION_PODS=pod/chuggy-session-1
run --merge
check "a live session pod refuses a migration's rollout" 1 "$RC" "an attempt is live in chuggy-work, and this release carries a migration"

open_release "$MIGRATION"
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
export CHUG_STUB_SESSION_PODS=pod/chuggy-session-1
run --merge
check "a worker pod and a session pod together refuse a migration's rollout" 1 "$RC" "an attempt is live in chuggy-work, and this release carries a migration"

open_release "$MIGRATION"
export CHUG_RIG_ARCHIVE="$ARCHIVE" CHUG_STUB_UNLABELLED_PODS=pod/chuggy-git-mirror-1
run --merge
check "a pod that is no attempt does not refuse a migration's rollout" 0 "$RC" "the rig is at $TAG; ledger at 52"
check "a pod that is no attempt is merged over" 0 "$RC" "merges attempted: 1"
printf 'attempts asked for: %s\n' "$(grep -c 'chuggy-work get pods' "$LOG" || true)" >>"$OUT"
check "a migration's rollout asks after each kind of attempt" 0 "$RC" "attempts asked for: 2"

open_release "$MIGRATION"
export CHUG_STUB_WORK_PODS_RC=1
run --merge
check "an unreadable work namespace could not run" 2 "$RC" "the work namespace could not be read"
check "an unreadable namespace is not merged over" 2 "$RC" "merges attempted: 0"

open_release "$MIGRATION"
export CHUG_STUB_LIVE_ROWS=1
run --merge
check "a live execution row refuses a migration's rollout" 1 "$RC" "1 execution(s) are live, and this release carries a migration"

open_release "$MIGRATION"
export CHUG_STUB_LIVE_ROWS=
run --merge
check "an unreadable execution count could not run" 2 "$RC" "live execution count could not be read"
check "an unreadable count is not merged over" 2 "$RC" "merges attempted: 0"

# A release that moves the rig back is the second a landing may not put out
# over a live attempt, and the mirror is the same move with nothing live.
open_move_back() {
	fresh_case
	advance ui/chuggy-ui/app.ts
	rig_at "$TAG"
	git -C "$REPO" reset -q --hard "$DEPLOYED_FULL"
	git -C "$REPO" push -q -f origin main
	TAG="$DEPLOYED"
	export CHUG_STUB_BRANCH="release/chuggy-$TAG"
	run
	export CHUG_STUB_PR_HEAD="release/chuggy-$TAG" CHUG_STUB_PR_URL=https://example.test/pull/9 CHUG_STUB_MERGED="$MERGED"
	: >"$LOG"
}

open_move_back
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --merge
check "a live attempt refuses a rollout that moves the rig back" 1 "$RC" "an attempt is live in chuggy-work, and this release moves the rig back"
check "a move back is not merged over a live attempt" 1 "$RC" "merges attempted: 0"

open_move_back
run --merge
check "a move back with nothing live is landed" 0 "$RC" "the rig is at $TAG; ledger at 52"

# The third is a worker plane that would leave a moment with no plane serving,
# and it is read from the tree the merge will produce. Each of these is a
# landing over one live attempt of the release branch as another hand left it,
# and whether the landing asked or went out is what the reader decided.
plane_edited() { # <command...>
	open_release src/a.ts
	release_edited "$@"
	export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
	run --merge
}
PLANE=chuggy-worker-plane.yaml
asks="does not state a rolling update with none unavailable, so a moment with no plane serving is not ruled out"

# The strategy's type is edited with the unavailability left standing beside
# it and the old type left in a comment above it and another after it, and
# then the unavailability is edited with the type left standing.
plane_edited sed -i 's/^\( *\)type: RollingUpdate$/\1# type: RollingUpdate, until the volume moved\n\1type: Recreate # type: RollingUpdate again once it is shared/' "$PLANE"
check "a live attempt refuses a rollout that recreates the worker plane" 1 "$RC" "an attempt is live in chuggy-work, and the worker plane that merging release/chuggy-$TAG lands $asks"
check "a recreated plane is not merged over a live attempt" 1 "$RC" "merges attempted: 0"

open_release src/a.ts
release_edited sed -i '/rollingUpdate:/s/maxUnavailable: 0/maxUnavailable: 1/' "$PLANE"
export CHUG_STUB_LIVE_ROWS=1
run --merge
check "a live attempt refuses a rollout that may leave the worker plane unavailable" 1 "$RC" "1 execution(s) are live, and the worker plane that merging release/chuggy-$TAG lands $asks"

plane_edited sed -i '/strategy:/,/rollingUpdate:/d' "$PLANE"
check "a worker plane that states no strategy is not one a live attempt is rolled over" 1 "$RC" "$asks"

open_release src/a.ts
release_edited sed -i 's/type: RollingUpdate/type: Recreate/' "$PLANE"
run --merge
check "a recreated plane with nothing live is landed" 0 "$RC" "the rig is at $TAG; ledger at 52"

open_release src/a.ts
release_edited rm "$PLANE"
run --merge
check "a release that lands no worker plane manifest could not run" 2 "$RC" "merging release/chuggy-$TAG lands no chuggy-worker-plane.yaml"
check "an unread strategy is not merged over" 2 "$RC" "merges attempted: 0"

# The answer is the worker plane Deployment's own `spec.strategy` and nothing
# else in the file that reads like one. In each of these the plane recreates,
# or states nothing, and the words of a rolling update stand somewhere a
# reader of words would find them first.
recreates() { sed 's/type: RollingUpdate/type: Recreate/; /rollingUpdate:/d' "$PLANE"; }
another_deployment_first() {
	{
		printf 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: chuggy-worker-plane-canary\nspec:\n'
		printf '  strategy:\n    type: RollingUpdate\n    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }\n---\n'
		recreates
	} >edited && mv edited "$PLANE"
}
a_block_of_text_first() {
	{
		printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: notes\ndata:\n  notes: |\n'
		printf '    strategy:\n      type: RollingUpdate\n      rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }\n---\n'
		recreates
	} >edited && mv edited "$PLANE"
}
no_deployment() {
	sed -i 's/^kind: Deployment$/kind: ConfigMap/' "$PLANE"
}
a_key_that_ends_in_type() {
	sed -i 's/^\( *\)type: RollingUpdate$/\1type: Recreate\n\1x-type: RollingUpdate/' "$PLANE"
}
a_later_strategy() {
	sed -i 's/^  template:$/  strategy: { type: Recreate }\n&/' "$PLANE"
}
the_template_states_it() {
	sed -i '/^  strategy:/,/rollingUpdate:/d' "$PLANE"
	sed -i 's/^    spec:$/&\n      strategy:\n        type: RollingUpdate\n        rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }/' "$PLANE"
	sed -i 's/^---$/  strategy: { type: Recreate }\n&/' "$PLANE"
}
# And a Deployment that states it twice has not stated it: one key of two is
# the one a cluster takes, and which is not this reader's to say.
the_plane_twice() {
	{
		sed '/^---$/,$d' "$PLANE"
		printf -- '---\n'
		recreates
	} >edited && mv edited "$PLANE"
}
an_empty_later_strategy() {
	sed -i 's/^  template:$/  strategy:\n&/' "$PLANE"
}
a_later_type() {
	sed -i 's/^\( *\)rollingUpdate: .*$/&\n\1type: Recreate/' "$PLANE"
}
a_later_bound() {
	sed -i 's/^\( *\)rollingUpdate: .*$/&\n\1rollingUpdate: { maxSurge: 3 }/' "$PLANE"
}
a_later_unavailability() {
	sed -i '/rollingUpdate:/s/maxUnavailable: 0/maxUnavailable: 0, maxUnavailable: 1/' "$PLANE"
}
a_later_spec() {
	sed -i 's/^---$/spec:\n  replicas: 1\n&/' "$PLANE"
}
a_later_kind() {
	sed -i 's/^---$/kind: StatefulSet\n&/' "$PLANE"
}
a_later_name() {
	sed -i 's/^  name: chuggy-worker-plane$/&\n  name: chuggy-pool-plane/' "$PLANE"
}
another_name() {
	sed -i 's/^  name: chuggy-worker-plane$/&-next/' "$PLANE"
}
# Nor has one that states it in a shape this reader does not know, or beside
# a key written as this reader would not read it.
a_later_kind_in_quotes() {
	sed -i 's/^---$/"kind": StatefulSet\n&/' "$PLANE"
}
a_later_name_in_quotes() {
	sed -i "s/^  name: chuggy-worker-plane\$/&\n  'name': chuggy-pool-plane/" "$PLANE"
}
a_later_strategy_in_quotes() {
	sed -i 's/^  template:$/  "strategy": { type: Recreate }\n&/' "$PLANE"
}
a_line_it_does_not_know() {
	sed -i 's/^\( *\)type: RollingUpdate$/&\n\1paused: true/' "$PLANE"
}
a_bound_it_does_not_know() {
	sed -i '/rollingUpdate:/s/maxSurge: 1/maxSurge: 1, minReadySeconds: 5/' "$PLANE"
}
a_type_that_ends_in_the_word() {
	sed -i 's/type: RollingUpdate$/type: NotRollingUpdate/' "$PLANE"
}
a_type_that_begins_with_the_word() {
	sed -i 's/type: RollingUpdate$/&Later/' "$PLANE"
}
a_value_that_runs_on() {
	sed -i 's/^\( *\)type: RollingUpdate$/&\n\1  OnDelete/' "$PLANE"
}
a_strategy_in_flow() {
	sed -i '/^  strategy:/,/rollingUpdate:/d' "$PLANE"
	sed -i 's/^spec:$/&\n  strategy: { type: RollingUpdate, rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }/' "$PLANE"
}
for shape in another_deployment_first a_block_of_text_first no_deployment a_key_that_ends_in_type a_later_strategy \
	the_template_states_it another_name the_plane_twice an_empty_later_strategy a_later_type a_later_bound \
	a_later_unavailability a_later_spec a_later_kind a_later_name a_later_kind_in_quotes \
	a_later_name_in_quotes a_later_strategy_in_quotes a_line_it_does_not_know a_bound_it_does_not_know \
	a_type_that_ends_in_the_word a_type_that_begins_with_the_word a_value_that_runs_on a_strategy_in_flow; do
	plane_edited "$shape"
	check "a live attempt is not rolled over a plane read as $shape" 1 "$RC" "$asks"
	check "a plane read as $shape is not merged" 1 "$RC" "merges attempted: 0"
done

# None unavailable is the one value that says it.
for unavailable in 1 0% '"0"' 0.9 01; do
	plane_edited sed -i "/rollingUpdate:/s/maxUnavailable: 0/maxUnavailable: $unavailable/" "$PLANE"
	check "a live attempt is not rolled over a plane with $unavailable unavailable" 1 "$RC" "$asks"
done

# What the reader does take is the statement however it is laid out: the
# bounds a line each, a comment after a value, and another line ending.
bounds_a_line_each() {
	sed -i 's/^\( *\)rollingUpdate: .*$/\1rollingUpdate:\n\1  maxSurge: 25%\n\1  maxUnavailable: 0 # none, for a live attempt/' "$PLANE"
}
carriage_returns() {
	sed -i 's/$/\r/' "$PLANE"
}
for shape in bounds_a_line_each carriage_returns; do
	plane_edited "$shape"
	check "a live attempt is rolled over a plane that rolls with $shape" 0 "$RC" "merges attempted: 1"
done

# What lands is the merge and not the branch. The fabric's main as another
# hand left it once the release was open: a plane that recreates there is the
# plane the cluster is given, whatever the branch says.
main_edited() { # <command...>
	fabric_edited main "$@"
}
open_release src/a.ts
main_edited sed -i 's/type: RollingUpdate/type: Recreate/' "$PLANE"
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --merge
check "a live attempt refuses a rollout whose plane the fabric's main has since recreated" 1 "$RC" "$asks"
check "a plane recreated on main is not merged over a live attempt" 1 "$RC" "merges attempted: 0"

open_release src/a.ts
main_edited sed -i '1i # the worker plane' "$PLANE"
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --merge
check "a main that moved and left the plane rolling is landed over a live attempt" 0 "$RC" "merges attempted: 1"

open_release src/a.ts
main_edited sed -i "s|^\( *image: registry.*\)@.*$|\1@$STALE|" "$PLANE"
run --merge
check "a release that does not merge cleanly could not run" 2 "$RC" "release/chuggy-$TAG could not be merged cleanly into the main of"
check "a release that does not merge cleanly is not merged" 2 "$RC" "merges attempted: 0"

# A release whose commit states an earlier worker contract than the live
# commit does is a move back by another road: its plane refuses a pod of the
# later contract. A patch is packaging and no contract, and a commit that
# does not state one is not known to be safe.
CONTRACT=src/contract/workerContract.ts
contract_stated() { # <release>...
	: >"$REPO/$CONTRACT"
	for release in "$@"; do
		printf 'export const workerContractRelease = "%s";\n' "$release" >>"$REPO/$CONTRACT"
	done
	advance src/a.ts
}
open_contract() { # <release>...
	fresh_case
	contract_stated "$@"
	run
	export CHUG_STUB_PR_HEAD="release/chuggy-$TAG" CHUG_STUB_PR_URL=https://example.test/pull/9 CHUG_STUB_MERGED="$MERGED"
	: >"$LOG"
}
for lower in 1.5.9 0.7.0; do
	open_contract "$lower"
	export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
	run --merge
	check "a live attempt refuses a release that lowers the worker contract to $lower" 1 "$RC" "an attempt is live in chuggy-work, and this release states worker contract ${lower%.*} where the live commit states 1.6"
	check "a contract lowered to $lower is not merged over a live attempt" 1 "$RC" "merges attempted: 0"
done

open_contract 1.5.9
run --merge
check "a lowered contract with nothing live is landed" 0 "$RC" "the rig is at $TAG; ledger at 52"

for kept in 1.6.1 1.10.0 2.0.0; do
	open_contract "$kept"
	export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
	run --merge
	check "a release that states worker contract $kept goes out over a live attempt" 0 "$RC" "merges attempted: 1"
done

for unstated in "" 1.6 1.6.0-rc "1.6.0 1.7.0"; do
	# shellcheck disable=SC2086 # each word is a release the file states
	open_contract $unstated
	export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
	run --merge
	check "a live attempt refuses a release whose worker contract reads \`$unstated\`" 1 "$RC" "the worker contract is not stated once at each of $DEPLOYED and $TAG"
done

fresh_case
contract_stated
rig_at "$TAG"
UNSTATED="$TAG"
contract_stated 1.6.0
run
export CHUG_STUB_PR_HEAD="release/chuggy-$TAG" CHUG_STUB_PR_URL=https://example.test/pull/9 CHUG_STUB_MERGED="$MERGED"
: >"$LOG"
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --merge
check "a live attempt refuses a release over a live commit that states no worker contract" 1 "$RC" "the worker contract is not stated once at each of $UNSTATED and $TAG"

# Any other release goes out over what is live: the pods and the executions are
# not asked after, the attempts that have not ended are counted, and once the
# rollout is done each is asked after by its kind and its identity. A fate is
# a row's state, kind, identity and lease, whether a pool holds it, where it
# is, and the evidence it ended on.
fate() { # <state> <kind> <identity> <lease> <held|unheld> [evidence]
	printf '%s %s %s %s %s in acme/site%s\n' "$1" "$2" "$3" "$4" "$5" "${6:+: $6}"
}
ALL_FATES="$(
	fate Placing work attempt-1 100 unheld
	fate Running work attempt-2 100 unheld
	fate Reported work attempt-3 - unheld
	fate Withdrawn work attempt-4 - unheld RunRateLimited
	fate Superseded work attempt-5 - unheld Fenced
	fate Lost session session-attempt-6 - unheld SessionIdle
)"
ALL_ATTEMPTS="$(printf '%s\n' "$ALL_FATES" | cut -d' ' -f2,3)"

# One that still runs is vouched for once its lease is not what it was when
# the rollout was done, and the landing waits to see that.
open_release src/a.ts
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1 CHUG_STUB_SESSION_PODS=pod/chuggy-session-1 CHUG_STUB_LIVE_ROWS=1
export CHUG_STUB_ATTEMPTS="$ALL_ATTEMPTS" CHUG_STUB_FATES="$ALL_FATES"
CHUG_STUB_FATES_THEN="$(printf '%s\n' "$ALL_FATES" | sed 's/attempt-2 100/attempt-2 400/')"
export CHUG_STUB_FATES_THEN
run --merge
check "a release with no migration goes out over live attempts, and says how many" 0 "$RC" "6 attempt(s) are live, and the release goes out over them"
check "a release over live attempts is merged" 0 "$RC" "merges attempted: 1"
printf 'attempts asked for: %s\n' "$(grep -c 'chuggy-work get pods' "$LOG" || true)" >>"$OUT"
check "a release over live attempts asks after no pod" 0 "$RC" "attempts asked for: 0"
check "each attempt is asked after by its kind and its identity" 0 "$RC" "where (kind, attempt) in (('work','attempt-1'),('work','attempt-2'),('work','attempt-3'),('work','attempt-4'),('work','attempt-5'),('session','session-attempt-6'))"
check "none lost is clean, and each is counted as it was read" 0 "$RC" "of 6 attempt(s) live at the merge, none is recorded lost: 4 ended, 1 running and heard from since the rollout, 1 not yet started"
check "one heard from at the second asking is waited for once" 0 "$RC" "waits: 1"
printf 'first of rollout and asking: %s\n' "$(grep -o 'rollout status\|attempt) in (' "$LOG" | head -n 1)" >>"$OUT"
check "what became of them is asked once the rollout is done" 0 "$RC" "first of rollout and asking: rollout status"

open_release src/a.ts
run --merge
check "a release over nothing live reports on nothing" 0 "$RC" "fates asked for: 0"

open_release src/a.ts
export CHUG_STUB_ATTEMPTS_RC=1
run --merge
check "unreadable live attempts could not run" 2 "$RC" "the live attempts could not be read"
check "unread attempts are not merged over" 2 "$RC" "merges attempted: 0"

# An attempt is asked after by what the scheduler names it, so an answer that
# is not a kind and such a name on every line is refused while that is free.
for answer in "   " "attempt-1" "work attempt-o'brien" "work attempt-1
task attempt-2" "work attempt-1 attempt-2"; do
	open_release src/a.ts
	export CHUG_STUB_ATTEMPTS="$answer"
	run --merge
	check "live attempts answered as \`$(printf '%s' "$answer" | tr '\n' '|')\` could not run" 2 "$RC" "the live attempts were not answered as a kind and an identity each"
	check "attempts answered so are not merged over" 2 "$RC" "merges attempted: 0"
done

# A lease that stands where it stood is an attempt nothing has heard from, and
# one whose row has lost its lease is the same. Neither is vouched for: the
# landing waits as long as it is told to, names each, and says what it does
# not know.
open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1
session session-attempt-2
work attempt-3"
CHUG_STUB_FATES="$(
	fate Running work attempt-1 100 unheld
	fate Running session session-attempt-2 100 unheld
	fate Reported work attempt-3 - unheld
)"
CHUG_STUB_FATES_THEN="$(
	fate Running work attempt-1 100 unheld
	fate Running session session-attempt-2 - unheld
	fate Reported work attempt-3 - unheld
)"
export CHUG_STUB_FATES CHUG_STUB_FATES_THEN CHUG_RELEASE_HEARD_SECS=10
run --merge
check "an attempt not heard from is named" 2 "$RC" "deploy-to-gtr: UNHEARD — work attempt attempt-1 in acme/site"
check "a session not heard from is named" 2 "$RC" "deploy-to-gtr: UNHEARD — session attempt session-attempt-2 in acme/site"
check "one not heard from is a could-not-run that says what is not known" 2 "$RC" "LINTER ERROR — of 3 attempt(s) live at the merge, 2 running had no lease renewed within 10s of the rollout, and whether any such attempt outlasts the release is not known; 1 ended, 0 running and heard from since the rollout, 0 not yet started"
check "one not heard from is waited for as long as the landing is told" 2 "$RC" "waits: 2"
check "a release that could not vouch for an attempt is still landed" 2 "$RC" "the rig is at $TAG; ledger at 52"
printf 'silences named: %s\n' "$(grep -c 'UNHEARD' "$OUT" || true)" >>"$OUT"
check "each not heard from is named once" 2 "$RC" "silences named: 2"

open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1"
CHUG_STUB_FATES="$(fate Running work attempt-1 100 unheld)"
export CHUG_STUB_FATES
run --merge
check "the wait for an attempt has a length of its own where none is given" 2 "$RC" "1 running had no lease renewed within 150s of the rollout"
check "that length is waited out" 2 "$RC" "waits: 30"

fresh_case
advance src/a.ts
export CHUG_RELEASE_HEARD_SECS=soon
run
check "a wait that is no number of seconds is refused" 2 "$RC" "CHUG_RELEASE_HEARD_SECS is \`soon\`, which is not a whole number of seconds"
check "a wait that is no number reaches no tool" 2 "$RC" "$untouched"

# A lease is written whole by whatever renews it, so one that reads earlier
# than it did has been written as surely as one that reads later.
open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1"
CHUG_STUB_FATES="$(fate Running work attempt-1 400 unheld)"
CHUG_STUB_FATES_THEN="$(fate Running work attempt-1 100 unheld)"
export CHUG_STUB_FATES CHUG_STUB_FATES_THEN
run --merge
check "a lease written shorter is an attempt heard from" 0 "$RC" "none is recorded lost: 0 ended, 1 running and heard from since the rollout, 0 not yet started"

# A placing attempt that a pool holds is a runner's whole run, and its lease is
# the pool's to renew: it is waited for like one that runs. One no pool holds
# has no pod to hear from, unless its lease says otherwise, and a lease where
# there was none is a pool taking it up.
open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1
work attempt-2
session session-attempt-3
work attempt-4"
CHUG_STUB_FATES="$(
	fate Placing work attempt-1 100 held
	fate Placing work attempt-2 100 held
	fate Placing session session-attempt-3 100 unheld
	fate Placing work attempt-4 - unheld
)"
CHUG_STUB_FATES_THEN="$(
	fate Placing work attempt-1 400 held
	fate Placing work attempt-2 100 held
	fate Placing session session-attempt-3 400 unheld
	fate Placing work attempt-4 400 held
)"
export CHUG_STUB_FATES CHUG_STUB_FATES_THEN CHUG_RELEASE_HEARD_SECS=5
run --merge
check "a runner's attempt is heard from by its pool's renewal, and one not renewed is not" 2 "$RC" "1 running had no lease renewed within 5s of the rollout, and whether any such attempt outlasts the release is not known; 0 ended, 3 running and heard from since the rollout, 0 not yet started"
check "the runner's attempt not renewed is the one named" 2 "$RC" "UNHEARD — work attempt attempt-2 in acme/site"

open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1"
CHUG_STUB_FATES="$(fate Placing work attempt-1 100 unheld)"
export CHUG_STUB_FATES
run --merge
check "an attempt not yet started is counted apart" 0 "$RC" "none is recorded lost: 0 ended, 0 running and heard from since the rollout, 1 not yet started"
check "an attempt not yet started is not waited for" 0 "$RC" "waits: 0"

# One lost is the finding, and it is the last thing a landing says: the
# release is merged, rolled out and verified as any other first. It is said
# as what the row records and no more, and a loss that comes while the landing
# waits is one it sees.
open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1
work attempt-2
session session-attempt-3"
CHUG_STUB_FATES="$(
	fate Running work attempt-1 100 unheld
	fate Running work attempt-2 100 unheld
	fate Lost session session-attempt-3 - unheld SessionIdle
)"
CHUG_STUB_FATES_THEN="$(
	fate Running work attempt-1 400 unheld
	fate Lost work attempt-2 - unheld LeaseExpired
	fate Lost session session-attempt-3 - unheld SessionIdle
)"
export CHUG_STUB_FATES CHUG_STUB_FATES_THEN
run --merge
check "an attempt recorded lost is named with the evidence its row gives" 1 "$RC" "deploy-to-gtr: LOST — work attempt attempt-2 in acme/site: LeaseExpired"
check "one lost is the landing's finding, and no cause is given it" 1 "$RC" "FAILED — of 3 attempt(s) live at the merge, the database records 1 lost; 1 ended, 1 running and heard from since the rollout, 0 not yet started"
check "a release with an attempt lost is still landed" 1 "$RC" "the rig is at $TAG; ledger at 52"
refute "a landing that asked after its attempts does not say it did not" 1 "$RC" "were not asked after"
check "a release with an attempt lost is still verified" 1 "$RC" "rollout status deployment/chuggy-ui"
printf 'losses named: %s\n' "$(grep -c 'LOST' "$OUT" || true)" >>"$OUT"
check "a session that drained its mailbox is not named as lost" 1 "$RC" "losses named: 1"

open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1
work attempt-2"
CHUG_STUB_FATES="$(
	fate Lost work attempt-1 - unheld RunFailed
	fate Running work attempt-2 100 unheld
)"
export CHUG_STUB_FATES CHUG_RELEASE_HEARD_SECS=5
run --merge
check "one lost beside one not heard from names the loss" 1 "$RC" "LOST — work attempt attempt-1 in acme/site: RunFailed"
check "one lost beside one not heard from names the silence" 1 "$RC" "UNHEARD — work attempt attempt-2 in acme/site"
check "one lost beside one not heard from is the finding, and says both" 1 "$RC" "FAILED — of 2 attempt(s) live at the merge, the database records 1 lost, and 1 running had no lease renewed within 5s of the rollout, and whether any such attempt outlasts the release is not known; 0 ended, 0 running and heard from since the rollout, 0 not yet started"

open_release src/a.ts
export CHUG_STUB_ATTEMPTS="session session-attempt-1"
CHUG_STUB_FATES="$(fate Lost session session-attempt-1 - unheld TurnFailed)"
export CHUG_STUB_FATES
run --merge
check "a session that ended any other way is lost" 1 "$RC" "LOST — session attempt session-attempt-1 in acme/site: TurnFailed"

open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1"
CHUG_STUB_FATES="$(fate Lost work attempt-1 - unheld SessionIdle)"
export CHUG_STUB_FATES
run --merge
check "an idle end is a session's, and work that records one is lost" 1 "$RC" "LOST — work attempt attempt-1 in acme/site: SessionIdle"

# What became of them is a read like any other: one that failed has not said
# none was lost, and neither has one that answered for anything but exactly
# the attempts asked after, each by its kind and in a state this knows.
open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1" CHUG_STUB_FATES_RC=1
run --merge
check "unreadable fates could not run" 2 "$RC" "what became of the 1 attempt(s) live at the merge could not be read"
check "unreadable fates leave the release landed" 2 "$RC" "the rig is at $TAG; ledger at 52"

inexactly() { # <what was answered for> <state kind identity>...
	open_release src/a.ts
	what="$1"
	shift
	export CHUG_STUB_ATTEMPTS="work attempt-1
session attempt-2"
	CHUG_STUB_FATES="$(for answer in "$@"; do
		# shellcheck disable=SC2086 # an answer is three words of a fate
		fate $answer - unheld
	done)"
	export CHUG_STUB_FATES
	run --merge
	check "fates that answer for $what could not run" 2 "$RC" "the database did not answer for exactly the 2 attempt(s) live at the merge, so what became of them is unknown"
}
inexactly "fewer attempts than were live" "Reported work attempt-1"
inexactly "one attempt twice and one not at all" "Reported work attempt-1" "Reported work attempt-1"
inexactly "an attempt that was not asked after" "Reported work attempt-1" "Reported session attempt-3"
inexactly "more attempts than were asked after" "Reported work attempt-1" "Reported session attempt-2" "Reported work attempt-3"
inexactly "an attempt of the other kind" "Reported work attempt-1" "Reported work attempt-2"
inexactly "an attempt in a state this does not know" "Reported work attempt-1" "Evicted session attempt-2"

# A landing that stops between the merge and the asking has not asked, and
# says so with whatever stopped it.
open_release src/a.ts
export CHUG_STUB_ATTEMPTS="work attempt-1
work attempt-2" CHUG_STUB_ROLLOUT_RC=1
run --merge
check "a rollout that fails says the live attempts were not asked after" 1 "$RC" "; the 2 attempt(s) live at the merge were not asked after"
check "a rollout that fails asks after none" 1 "$RC" "fates asked for: 0"

open_release src/a.ts
export CHUG_STUB_ROLLOUT_RC=1
run --merge
refute "a rollout that fails over nothing live owes no asking" 1 "$RC" "were not asked after"

open_release src/adapters/postgres/schema/migrations/050-b.ts
run --merge
check "a migration with nowhere to keep the dump is refused" 2 "$RC" "CHUG_RIG_ARCHIVE names nowhere"
check "no dump means no merge" 2 "$RC" "merges attempted: 0"

# The server answered, but not with an archive: an error message on stdout, or
# nothing, is a file the restore would refuse, and so no way back.
open_release src/adapters/postgres/schema/migrations/050-b.ts
export CHUG_RIG_ARCHIVE="$ARCHIVE" CHUG_STUB_DUMP="pg_dump: error: connection failed"
run --merge
check "a dump that is not an archive could not run" 2 "$RC" "is not a PostgreSQL archive"
check "a dump that is not an archive is not merged over" 2 "$RC" "merges attempted: 0"

open_release src/adapters/postgres/schema/migrations/050-b.ts
export CHUG_RIG_ARCHIVE="$ARCHIVE"
run --merge
check "a migration release dumps before it merges" 0 "$RC" "dump at $ARCHIVE/chuggy-pre-$TAG.dump"
printf 'dump magic: %s\n' "$(dd if="$ARCHIVE/chuggy-pre-$TAG.dump" bs=5 count=1 2>/dev/null)" >>"$OUT"
check "the dump is the archive the server wrote" 0 "$RC" "dump magic: PGDMP"
printf 'globals: %s\n' "$(cat "$ARCHIVE/chuggy-pre-$TAG-globals.sql")" >>"$OUT"
check "the globals are dumped beside it" 0 "$RC" "globals: globals"
printf 'first of dump and merge: %s\n' "$(grep -o 'pg_dump\|gh pr merge' "$LOG" | head -n 1)" >>"$OUT"
check "the dump precedes the merge" 0 "$RC" "first of dump and merge: pg_dump"

open_release src/a.ts
run --merge
check "a release with no migration merges without a dump" 0 "$RC" "the rig is at $TAG; ledger at 52"
check "the merge is the fabric's" 0 "$RC" "gh pr merge 9 -R gdoteof/chuggy-fabric --merge --delete-branch --admin"
check "the source is asked to reconcile" 0 "$RC" "annotate --overwrite gitrepository/fabric reconcile.fluxcd.io/requestedAt="
check "then the applications are" 0 "$RC" "annotate --overwrite kustomization/apps reconcile.fluxcd.io/requestedAt="
check "the migrate Job is waited on by its release name" 0 "$RC" "wait --for=condition=complete job/chuggy-migrate-$TAG-registry"
check "each managed Deployment is rolled out" 0 "$RC" "rollout status deployment/chuggy-ui"
printf 'unmanaged rollouts: %s\n' "$(grep -c 'rollout status deployment/unmanaged' "$LOG" || true)" >>"$OUT"
check "a Deployment with no manifest is not held to one" 0 "$RC" "unmanaged rollouts: 0"
printf 'first of merge and reconcile: %s\n' "$(grep -o 'gh pr merge\|annotate' "$LOG" | head -n 1)" >>"$OUT"
check "the merge precedes the reconcile" 0 "$RC" "first of merge and reconcile: gh pr merge"

open_release src/a.ts
export CHUG_STUB_STALE=chuggy-api
run --merge
check "a Deployment off its manifest's image is a finding" 1 "$RC" "chuggy-api runs registry.chuggy.internal/chuggy/api@$STALE"
check "the count of stale Deployments is reported" 1 "$RC" "1 Deployment(s) are not on the release"

open_release src/a.ts
export CHUG_STUB_JOB_RC=1
run --merge
check "a migrate Job that did not complete is a finding" 1 "$RC" "did not complete; read its log"

open_release src/a.ts
export CHUG_STUB_ROLLOUT_RC=1
run --merge
check "a rollout that did not complete is a finding" 1 "$RC" "chuggy-api did not roll out"

open_release src/a.ts
export CHUG_STUB_MERGE_RC=1
run --merge
check "a merge that failed is a finding" 1 "$RC" "pull request 9 did not merge"

# --- --console: a console-only release, both phases in one run ----------------------

fresh_case
advance ui/chuggy-ui/app.ts
run --console --merge
check "console with merge is refused" 2 "$RC" "takes no --merge"
check "console with merge reaches no tool" 2 "$RC" "$untouched"

fresh_case
advance ui/chuggy-ui/app.ts src/a.ts
run --console
check "a change that moves the api is not a console release" 2 "$RC" "moves the api, so it is not a console release"
check "a refused console release runs no gate" 2 "$RC" "gates run: 0"
check "a refused console release builds nothing" 2 "$RC" "builds attempted: 0"

fresh_case
advance ui/chuggy-ui/app.ts src/adapters/postgres/schema/migrations/050-b.ts
run --console
check "a migration moves the api and is not a console release" 2 "$RC" "moves the api, so it is not a console release"

fresh_case
advance images/worker/Dockerfile
run --console
check "a change the console does not serve is no console release" 2 "$RC" "nothing the console serves moved"

# The rig runs a commit HEAD is behind: the gate runner would diff HEAD from
# itself and find nothing to run, so the mode refuses rather than vouch for it.
fresh_case
advance ui/chuggy-ui/app.ts
rig_at "$TAG"
git -C "$REPO" reset -q --hard "$DEPLOYED_FULL"
git -C "$REPO" push -q -f origin main
run --console
check "a console release that moves the rig back is refused" 2 "$RC" "HEAD has none; run without --console"
check "a release that moves the rig back runs no gate" 2 "$RC" "gates run: 0"
check "a release that moves the rig back builds nothing" 2 "$RC" "builds attempted: 0"

# The mirror: the full route releases the same move, with every gate.
fresh_case
advance ui/chuggy-ui/app.ts
rig_at "$TAG"
git -C "$REPO" reset -q --hard "$DEPLOYED_FULL"
git -C "$REPO" push -q -f origin main
export CHUG_STUB_BRANCH="release/chuggy-$DEPLOYED"
run
check "the full route releases a move back" 0 "$RC" "this moves the rig back"
check "a move back is gated with every gate" 0 "$RC" "ci prefix=<> full=<1> base=<> needs=<>"

fresh_case
advance ui/chuggy-ui/app.ts
export CHUG_STUB_MERGED="$MERGED"
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1 CHUG_STUB_LIVE_ROWS=1
run --console
check "a console release lands in one run" 0 "$RC" "the rig is at $TAG; ledger at 52"
check "a console release gates what moved since the live commit, and a range that selects nothing is not its pass" 0 "$RC" "ci prefix=<> full=<> base=<$DEPLOYED> needs=<1>"
check "a console release runs one gate" 0 "$RC" "gates run: 1"
check "a console release builds the console alone" 0 "$RC" "builds attempted: 1"
check "a console release opens the pull request" 0 "$RC" "pull requests opened: 1"
check "a console release merges its own pull request" 0 "$RC" "gh pr merge 7 -R gdoteof/chuggy-fabric --merge --delete-branch --admin"
check "a live attempt does not refuse a console release" 0 "$RC" "merges attempted: 1"
printf 'attempts asked for: %s\n' "$(grep -c 'chuggy-work get pods' "$LOG" || true)" >>"$OUT"
check "a console release does not ask after attempts" 0 "$RC" "attempts asked for: 0"
check "a console release verifies the console rollout" 0 "$RC" "rollout status deployment/chuggy-ui"
cp "$LOG.body" "$OUT"
check "the pull request says what the gate covered" 0 "$RC" "Gate at $TAG: clean over the gates the change since $DEPLOYED affects"
OUT="$WORK/.release"
released chuggy-ui.yaml >"$OUT"
check "a console release selects the registry's digest" 0 "$RC" "chuggy/web@$NEW"

# A console release rolls no plane, so how the worker plane would roll is not
# its question: one over a fabric whose plane recreates lands over a live
# attempt all the same.
fresh_case
advance ui/chuggy-ui/app.ts
main_edited sed -i 's/type: RollingUpdate/type: Recreate/' "$PLANE"
export CHUG_STUB_MERGED="$MERGED" CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --console
check "a console release does not ask how the worker plane rolls" 0 "$RC" "merges attempted: 1"

fresh_case
advance ui/chuggy-ui/app.ts
export CHUG_STUB_GATE_RC=1
run --console
check "a console gate finding stops the release" 1 "$RC" "did not pass $TAG"
check "a failed console gate merges nothing" 1 "$RC" "merges attempted: 0"

# The full route gates the same way: by what moved since the live commit.
fresh_case
advance src/a.ts
run
check "the full route gates what moved since the live commit, and a range that selects nothing is not its pass" 0 "$RC" "ci prefix=<> full=<> base=<$DEPLOYED> needs=<1>"

fresh_case
advance ui/chuggy-ui/app.ts
export CHUG_STUB_GATE_RC=2
run --console
check "a console gate that could not run stops the release" 2 "$RC" "the gate could not run over the change since $DEPLOYED"
check "a console gate that could not run merges nothing" 2 "$RC" "merges attempted: 0"

# Every gate is run when a release asks for it, and the pull request says so.
fresh_case
advance src/a.ts
export CHUG_RELEASE_GATE=full
run
check "a release that asks for every gate runs every gate" 0 "$RC" "ci prefix=<> full=<1> base=<> needs=<>"
cp "$LOG.body" "$OUT"
check "the pull request says every gate ran" 0 "$RC" "Gate at $TAG: clean over every gate"

fresh_case
advance src/a.ts
export CHUG_RELEASE_GATE=full CHUG_STUB_GATE_RC=2
run
check "every gate that could not run is not a pass" 2 "$RC" "the gate did not pass $TAG"

# A full run in the caller's environment, as a suite under the full gate has,
# must not widen a release's gate to every gate, on either route.
fresh_case
advance ui/chuggy-ui/app.ts
export CHUG_STUB_MERGED="$MERGED" CHUG_CI_FULL=1
run --console
check "an inherited full-run flag does not widen a console release's gate" 0 "$RC" "ci prefix=<> full=<> base=<$DEPLOYED>"

fresh_case
advance src/a.ts
export CHUG_CI_FULL=1
run
check "an inherited full-run flag does not widen a release's gate" 0 "$RC" "ci prefix=<> full=<> base=<$DEPLOYED>"

# --- the tools that have to be there --------------------------------------------------

fresh_case
OUT="$WORK/.out"
set +e
(
	cd "$REPO" || exit 2
	PATH="$NOBIN" CHUG_STUB_LOG="$LOG" sh "$REPO/deploy/rig/deploy-to-gtr.sh"
) >"$OUT" 2>&1
RC=$?
set -e
check "a missing tool could not run" 2 "$RC" "no \`docker\` on PATH"

done_ "deploy-to-gtr.test.sh"
