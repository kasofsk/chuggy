#!/bin/sh
# Seed the rig's git service: mint the static credentials, create the bare
# repository, and push the contents of `deploy/rig/git/repo/deploy/` onto its
# default branch. Run it after `kubectl apply -k deploy/rig/git/bootstrap`; the
# git pod waits on the credential secret this script creates.
#
# Re-running is safe. The credentials are minted once and read back afterwards,
# and the push is skipped when the repository already carries the same tree.
#
# Exits 0 on success, 1 on a failure, 2 when it could not run.
set -eu
export LC_ALL=C

namespace=chuggy-git
repository=rig.git
sync_user=sync
operator_user=operator
worker_user=worker
mirror_user=mirror

for tool in kubectl git openssl base64 curl; do
	command -v "$tool" > /dev/null 2>&1 || {
		echo "seed: no $tool on PATH, so nothing was seeded" >&2
		exit 2
	}
done

root="$(git rev-parse --show-toplevel 2> /dev/null || true)"
if [ -z "$root" ]; then
	echo "seed: not a git checkout, so there is no repository content to push" >&2
	exit 2
fi
seed_tree="$root/deploy/rig/git/repo"
[ -d "$seed_tree" ] || {
	echo "seed: $seed_tree is missing, so there is nothing to push" >&2
	exit 2
}
hook_source="$root/deploy/rig/git/pre-receive.sh"
[ -f "$hook_source" ] || {
	echo "seed: $hook_source is missing, so no repository could be given its ref wall" >&2
	exit 2
}

# The push traverses the ingress, whose host is the one nip.io literal in the
# manifests. Read it back from the applied Ingress rather than restating it, so
# the two cannot drift; a checkout without the Ingress applied cannot push.
ingress_host="$(kubectl -n "$namespace" get ingress git \
	-o jsonpath='{.spec.rules[0].host}' 2> /dev/null)"
if [ -z "$ingress_host" ]; then
	echo "seed: the git Ingress is not applied, so there is no host to push through" >&2
	exit 2
fi

secret_password() {
	# A pipeline's status is its last command's, and `base64 -d` exits 0 on the
	# empty stdin a failed `kubectl get` leaves. Without pipefail (not POSIX),
	# that empty string would be minted as a valid credential — an empty
	# password has a well-formed `{SHA}` digest — so the emptiness is the failure
	# and it stops the run rather than seeding one.
	password="$(kubectl -n "$namespace" get secret "$1" -o jsonpath='{.data.password}' | base64 -d)"
	if [ -z "$password" ]; then
		echo "seed: secret $1 has no password, so no credential can be read back from it" >&2
		exit 2
	fi
	printf '%s' "$password"
}

# nginx validates a `{SHA}` entry against the base64 of the password's SHA-1.
# The password is what carries the entropy here: it is minted below by
# `openssl rand` and never chosen by a person.
credential_digest() {
	printf '%s' "$1" | openssl sha1 -binary | openssl base64
}

# Every secret this script writes goes here: 0700 from mktemp, removed by the
# trap on any exit. A token given to a command in argv is readable in /proc for
# that command's lifetime, so the minting below and the push at the end both
# hand theirs over in a file rather than on a command line.
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

# --- The static credential classes ------------------------------------------
# The sync reader, the worker's create-only writer, the mirror's main-only
# writer and the operator's break-glass. `pre-receive.sh`, installed below,
# narrows the worker and the mirror independently of nginx admitting them to
# receive-pack.
#
# Each class is settled on its own: read back when its secret is there, minted
# when it is not. A class this script gains after a rig was seeded has no
# secret to read back — the mirror is one and the worker was — and the classes
# beside it must not be rotated to give it one. The token comes back in a
# variable rather than on stdout so that minting can say so on stdout.
minted=0
credential_token() { # <secret> <username>
	if kubectl -n "$namespace" get secret "$1" > /dev/null 2>&1; then
		token="$(secret_password "$1")"
		return 0
	fi
	token="$(openssl rand -hex 32)"
	(
		umask 077
		printf '%s' "$token" > "$work_dir/$1"
	)
	kubectl -n "$namespace" create secret generic "$1" \
		--from-literal=username="$2" \
		--from-file=password="$work_dir/$1" > /dev/null
	minted=1
	echo "seed: minted the $2 credential"
}

credential_token git-sync "$sync_user"
sync_token="$token"
credential_token git-operator "$operator_user"
operator_token="$token"
credential_token git-worker "$worker_user"
worker_token="$token"
credential_token git-mirror "$mirror_user"
mirror_token="$token"

readers="$sync_user:{SHA}$(credential_digest "$sync_token")
$operator_user:{SHA}$(credential_digest "$operator_token")
$worker_user:{SHA}$(credential_digest "$worker_token")
$mirror_user:{SHA}$(credential_digest "$mirror_token")"
writers="$operator_user:{SHA}$(credential_digest "$operator_token")
$worker_user:{SHA}$(credential_digest "$worker_token")
$mirror_user:{SHA}$(credential_digest "$mirror_token")"

kubectl -n "$namespace" create secret generic git-credentials \
	--from-literal=readers="$readers" \
	--from-literal=writers="$writers" \
	--dry-run=client -o yaml | kubectl apply -f - > /dev/null

# A Secret mounted as a directory reaches a running pod only on the kubelet's
# next sync, and the audit below asks the pod about a credential this run may
# have just minted. A restart is what makes the file the pod serves the file
# this run wrote, and it is spent only when there is a new credential in it.
if [ "$minted" -eq 1 ]; then
	kubectl -n "$namespace" rollout restart deployment/git > /dev/null
fi
kubectl -n "$namespace" rollout status deployment/git --timeout=180s

# --- The bare repository and the ref wall -----------------------------------
# git-http-backend serves repositories; it does not create them, so the first
# one is made in the pod that will serve it.
#
# The hook goes on every repository under /git rather than on this one alone.
# They are served by one nginx and admit one set of credentials, so a
# repository without it is a credential class with nothing behind it — which is
# what `chuggy.git`, pushed into the pod by hand, was. Installing it on every
# seed is what governs a repository that arrived since the last one.
pod="$(kubectl -n "$namespace" get pod -l app.kubernetes.io/name=git \
	-o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$namespace" exec -i "$pod" -- sh -c '
	set -eu
	repository="$1"
	if [ ! -d "/git/$repository" ]; then
		git init --bare -q "/git/$repository"
		git -C "/git/$repository" config http.receivepack true
		git -C "/git/$repository" symbolic-ref HEAD refs/heads/main
	fi
	hook="$(mktemp)"
	cat > "$hook"
	for repo in /git/*.git; do
		# A directory ending in .git that is no repository — the audit names
		# its probe root that way — has no hooks directory and dispatches
		# nothing.
		[ -d "$repo/hooks" ] || continue
		# Removed first because the installed mode carries no write bit.
		rm -f "$repo/hooks/pre-receive"
		cp "$hook" "$repo/hooks/pre-receive"
		chmod 0555 "$repo/hooks/pre-receive"
	done
	rm -f "$hook"
' sh "$repository" < "$hook_source"

# --- The write wall ---------------------------------------------------------
# A control that is not exercised is worse than none, so the wall is shown the
# pushes it must refuse before this run is trusted: the read credential at a
# push endpoint, and the mirror at a ref and a repository that are not its. It
# runs here rather than earlier because half of what it probes is the hook
# above, and before the push below because a deploy this run cannot vouch for
# is a deploy nobody asked for.
"$root/deploy/rig/git/audit-credentials.sh"

# --- The default branch -----------------------------------------------------
# The token never outlives the command that carried it, and there are three
# ways it would. Not the URL: a credential there is copied into the clone's
# `.git/config`, so the remote carries the username alone. Not argv, readable
# in /proc for the command's life: an askpass helper reads the token from a
# file. And not a credential helper — git calls each configured one's `store`
# on a successful request, and `credential.helper=store` writes the token to
# plaintext `~/.git-credentials`, outside the directory the trap removes.
# `GIT_ASKPASS` does not suppress helpers, which are consulted before it, so
# both authenticated commands reset the list with an empty
# `-c credential.helper=`.
remote="http://$operator_user@$ingress_host/$repository"
# The helper reads the path out of the environment rather than carrying it as
# text, so a `TMPDIR` that would need shell quoting cannot break it.
export SEED_TOKEN_FILE="$work_dir/token"
askpass="$work_dir/askpass"
(
	umask 077
	printf '%s' "$operator_token" > "$SEED_TOKEN_FILE"
	printf '#!/bin/sh\ncat "$SEED_TOKEN_FILE"\n' > "$askpass"
)
chmod 700 "$askpass"
export GIT_ASKPASS="$askpass"
export GIT_TERMINAL_PROMPT=0

git -c credential.helper= clone -q "$remote" "$work_dir/clone"
# A clone of a repository with no commits leaves HEAD wherever the local git
# defaults it, and the branch this pushes to is not a local default.
git -C "$work_dir/clone" rev-parse --verify --quiet HEAD > /dev/null \
	|| git -C "$work_dir/clone" symbolic-ref HEAD refs/heads/main
# The Kustomization reconciles ./deploy, so that is the directory synced and
# the only one the seed tree carries.
rm -rf "$work_dir/clone/deploy"
cp -R "$seed_tree/deploy" "$work_dir/clone/deploy"
git -C "$work_dir/clone" add -A
if git -C "$work_dir/clone" diff --cached --quiet; then
	echo "seed: $repository already carries this tree"
	exit 0
fi
git -C "$work_dir/clone" \
	-c user.name="$operator_user" \
	-c user.email="$operator_user@$ingress_host" \
	commit -qm "seed the rig's deploy directory"
git -C "$work_dir/clone" -c credential.helper= push -q origin HEAD:main
echo "seed: pushed $repository"
