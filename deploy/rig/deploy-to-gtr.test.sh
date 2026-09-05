#!/bin/sh
# Shell test for deploy-to-gtr.sh, over what it decides and no more: what it
# refuses before touching anything, which images a change rebuilds, that a
# digest comes from the registry's answer and not the push, what the fabric
# change carries, and what `--merge` requires of the cluster before and after
# it moves it.
#
# NOTHING HERE BUILDS, PUSHES OR REACHES A CLUSTER. `docker`, `ssh`, `kubectl`,
# `gh` and `python3` are stubs on PATH that log every invocation and answer
# from environment the case sets; the gate and the image builder are stubs
# inside a throwaway checkout; and the fabric is a bare repository the `gh` stub
# clones, so what the script pushes can be read back out of it.
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

ln -s "$(command -v git)" "$NOBIN/git"
ln -s "$(command -v sh)" "$NOBIN/sh"

digest_of() { # <letter>
	printf 'sha256:%s' "$(printf '%064d' 0 | tr 0 "$1")"
}
OLD_API="$(digest_of a)"
OLD_UI="$(digest_of b)"
OLD_WEB="$(digest_of c)"
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
*'max(version)'*) printf '52' ;;
*' pg_dump '*) printf '%s' "${CHUG_STUB_DUMP:-PGDMP-archive}" ;;
*' pg_dumpall '*) printf 'globals\n' ;;
*'{.spec.sourceRef.name}'*) printf 'fabric' ;;
*' annotate '*) ;;
*'{.status.artifact.revision}'* | *'{.status.lastAppliedRevision}'*) printf 'main@sha1:%s' "${CHUG_STUB_MERGED:-}" ;;
*' wait '*) exit "${CHUG_STUB_JOB_RC:-0}" ;;
*' get deployments '*) printf 'chuggy-api\nchuggy-ui\nchuggy-web\nunmanaged\n' ;;
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

chmod +x "$BIN/docker" "$BIN/ssh" "$BIN/kubectl" "$BIN/gh" "$BIN/python3"

# --- the checkout, with its gate and its builder stubbed inside it ---------------

git init -q --bare "$ORIGIN"
fresh_repo "$REPO"
git -C "$REPO" remote add origin "$ORIGIN"
mkdir -p "$REPO/src/contract" "$REPO/src/adapters/postgres/schema/migrations" "$REPO/ui/chuggy-ui" \
	"$REPO/ui/console" "$REPO/images/api" "$REPO/images/web" "$REPO/images/chuggy-ui" "$REPO/images/worker" \
	"$REPO/scripts" "$REPO/.chug/tasks" "$REPO/deploy/rig/images"
for file in src/a.ts src/contract/c.ts ui/chuggy-ui/app.ts ui/console/index.html images/api/Dockerfile \
	images/web/Dockerfile images/web/nginx.conf images/chuggy-ui/Dockerfile images/worker/Dockerfile package.json \
	package-lock.json scripts/console-policy.ts scripts/check-console-policy.ts \
	src/adapters/postgres/schema/migrations/001-a.ts src/adapters/postgres/schema/migrations/index.ts; do
	printf 'fixture\n' >"$REPO/$file"
done
cat >"$REPO/.chug/tasks/ci.sh" <<'STUB'
#!/bin/sh
printf 'ci prefix=<%s>\n' "${CHUG_IMAGE_PREFIX:-}" >>"$CHUG_STUB_LOG"
exit "${CHUG_STUB_GATE_RC:-0}"
STUB
cat >"$REPO/deploy/rig/images/build-and-import.sh" <<'STUB'
#!/bin/sh
printf 'build-and-import %s tag=%s site=%s prefix=%s\n' "$*" "${CHUG_IMAGE_TAG:-}" "${CHUG_WEB_SITE:-}" "${CHUG_IMAGE_PREFIX:-}" >>"$CHUG_STUB_LOG"
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
for name in chuggy-api chuggy-configuration-importer chuggy-finalizer chuggy-scheduler chuggy-selector \
	chuggy-ticket-service chuggy-worker-plane; do
	manifest "$name" Deployment api "$OLD_API" >"$FABRIC_SEED/cluster/apps/$name.yaml"
done
manifest chuggy-ui Deployment web "$OLD_UI" >"$FABRIC_SEED/cluster/apps/chuggy-ui.yaml"
manifest chuggy-web Deployment web "$OLD_WEB" >"$FABRIC_SEED/cluster/apps/chuggy-web.yaml"
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

# --- the drivers ------------------------------------------------------------------

fresh_case() {
	: >"$LOG"
	rm -f "$LOG.body" "$ARCHIVE"/*
	git -C "$REPO" reset -q --hard "$DEPLOYED_FULL"
	git -C "$REPO" push -q -f origin main
	for ref in $(git --git-dir="$FABRIC_GIT" for-each-ref --format='%(refname:short)' refs/heads/release); do
		git --git-dir="$FABRIC_GIT" branch -q -D "$ref"
	done
	unset CHUG_RIG_SSH CHUG_RIG_ARCHIVE CHUG_RELEASE_GATE CHUG_IMAGE_PREFIX
	unset CHUG_STUB_DIGEST CHUG_STUB_PUSH_RC CHUG_STUB_GATE_RC CHUG_STUB_BUILD_RC CHUG_STUB_CONSISTENCY_RC
	unset CHUG_STUB_RENDER_RC CHUG_STUB_LIVE_ROWS CHUG_STUB_PR_HEAD CHUG_STUB_PR_URL
	unset CHUG_STUB_WORKER_PODS CHUG_STUB_SESSION_PODS CHUG_STUB_UNLABELLED_PODS CHUG_STUB_WORK_PODS_RC
	unset CHUG_STUB_MERGE_RC CHUG_STUB_MERGED CHUG_STUB_JOB_RC CHUG_STUB_ROLLOUT_RC CHUG_STUB_STALE CHUG_STUB_BRANCH
	unset CHUG_STUB_DUMP CHUG_STUB_NODE_RC CHUG_STUB_PUSH_DENIED
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
released chuggy-web.yaml >"$OUT"
check "the old console keeps its digest" 0 "$RC" "chuggy/web@$OLD_WEB"
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
check "the pull request reports the gate" 0 "$RC" "Gate at $TAG: clean"

fresh_case
advance src/a.ts
run
check "a server change builds the api" 0 "$RC" "build-and-import api tag=$TAG site= prefix=registry.chuggy.internal/chuggy"
check "a server change builds only the api" 0 "$RC" "builds attempted: 1"
# The builder's suite runs inside the gate and reads the builder's variables,
# so the gate must not inherit them.
check "the gate is not handed the builder's prefix" 0 "$RC" "ci prefix=<>"
OUT="$WORK/.release"
printf 'api digests moved: %s\n' "$(count_in_release "chuggy/api@$NEW")" >"$OUT"
check "every control-plane manifest selects the new api" 0 "$RC" "api digests moved: 8"
released chuggy-ui.yaml >"$OUT"
check "the console keeps its digest on a server change" 0 "$RC" "chuggy/web@$OLD_UI"

fresh_case
advance src/contract/c.ts
run
check "a contract change rebuilds the api and the console" 0 "$RC" "builds attempted: 2"

fresh_case
advance ui/console/index.html
run
check "an old console change builds the web image over it" 0 "$RC" "build-and-import web tag=$TAG site=ui/console"
OUT="$WORK/.release"
released chuggy-web.yaml >"$OUT"
check "the old console manifest selects the new digest" 0 "$RC" "chuggy/web@$NEW"

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
check "a gate that could not run is not a pass" 2 "$RC" "did not pass $TAG"

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

fresh_case
advance src/a.ts
export CHUG_STUB_CONSISTENCY_RC=1
run
check "the fabric's consistency check is obeyed" 1 "$RC" "consistency check refuses"
check "a refused release is not pushed" 1 "$RC" "pull requests opened: 0"

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

# Each attempt label is asked for on its own, so a pod carrying either one is
# enough to refuse; a pod carrying neither is not the rollout's business, and
# neither label answering is the emptiness the refusal turns on.
open_release src/a.ts
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
run --merge
check "a live worker pod refuses the rollout" 1 "$RC" "an attempt is live in chuggy-work"
check "a live attempt is not merged over" 1 "$RC" "merges attempted: 0"

open_release src/a.ts
export CHUG_STUB_SESSION_PODS=pod/chuggy-session-1
run --merge
check "a live session pod refuses the rollout" 1 "$RC" "an attempt is live in chuggy-work"

open_release src/a.ts
export CHUG_STUB_WORKER_PODS=pod/chuggy-worker-1
export CHUG_STUB_SESSION_PODS=pod/chuggy-session-1
run --merge
check "a worker pod and a session pod together refuse the rollout" 1 "$RC" "an attempt is live in chuggy-work"

open_release src/a.ts
export CHUG_STUB_UNLABELLED_PODS=pod/chuggy-git-mirror-1
run --merge
check "a pod that is no attempt does not refuse the rollout" 0 "$RC" "the rig is at $TAG; ledger at 52"
check "a pod that is no attempt is merged over" 0 "$RC" "merges attempted: 1"

open_release src/a.ts
export CHUG_STUB_WORK_PODS_RC=1
run --merge
check "an unreadable work namespace could not run" 2 "$RC" "the work namespace could not be read"
check "an unreadable namespace is not merged over" 2 "$RC" "merges attempted: 0"

open_release src/a.ts
export CHUG_STUB_LIVE_ROWS=1
run --merge
check "a live execution row refuses the rollout" 1 "$RC" "1 execution(s) are live"

open_release src/a.ts
export CHUG_STUB_LIVE_ROWS=
run --merge
check "an unreadable execution count could not run" 2 "$RC" "live execution count could not be read"
check "an unreadable count is not merged over" 2 "$RC" "merges attempted: 0"

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
check "each managed Deployment is rolled out" 0 "$RC" "rollout status deployment/chuggy-web"
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
