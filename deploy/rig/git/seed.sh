#!/bin/sh
# Seed the rig's git service: mint the static credentials, create the bare
# repository, and push the contents of `deploy/rig/git/repo/` onto its default
# branch. Run it after `kubectl apply -k deploy/rig/git/bootstrap`; the git pod
# waits on the credential secret this script creates.
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

# --- The two static credential classes --------------------------------------
# The sync reader, and the operator's break-glass. Per-job tokens are the
# dispatcher's to mint and are not rehearsed here.
if kubectl -n "$namespace" get secret git-sync > /dev/null 2>&1; then
	sync_token="$(secret_password git-sync)"
	operator_token="$(secret_password git-operator)"
	echo "seed: reusing the existing credentials"
else
	sync_token="$(openssl rand -hex 32)"
	operator_token="$(openssl rand -hex 32)"
	(
		umask 077
		printf '%s' "$sync_token" > "$work_dir/sync-token"
		printf '%s' "$operator_token" > "$work_dir/operator-token"
	)
	kubectl -n "$namespace" create secret generic git-sync \
		--from-literal=username="$sync_user" \
		--from-file=password="$work_dir/sync-token" > /dev/null
	kubectl -n "$namespace" create secret generic git-operator \
		--from-literal=username="$operator_user" \
		--from-file=password="$work_dir/operator-token" > /dev/null
	echo "seed: minted the sync and operator credentials"
fi

readers="$sync_user:{SHA}$(credential_digest "$sync_token")
$operator_user:{SHA}$(credential_digest "$operator_token")"
writers="$operator_user:{SHA}$(credential_digest "$operator_token")"

kubectl -n "$namespace" create secret generic git-credentials \
	--from-literal=readers="$readers" \
	--from-literal=writers="$writers" \
	--dry-run=client -o yaml | kubectl apply -f - > /dev/null

kubectl -n "$namespace" rollout status deployment/git --timeout=180s

# --- The write wall ---------------------------------------------------------
# A control that is not exercised is worse than none, so the read credential is
# shown a push and refused before this run is trusted. The audit stands up its
# own throwaway repository and needs nothing this script has yet pushed.
"$root/deploy/rig/git/audit-credentials.sh"

# --- The bare repository ----------------------------------------------------
# git-http-backend serves repositories; it does not create them, so the first
# one is made in the pod that will serve it.
pod="$(kubectl -n "$namespace" get pod -l app.kubernetes.io/name=git \
	-o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$namespace" exec "$pod" -- sh -c '
	set -eu
	repository="$1"
	if [ ! -d "/git/$repository" ]; then
		git init --bare -q "/git/$repository"
		git -C "/git/$repository" config http.receivepack true
		git -C "/git/$repository" symbolic-ref HEAD refs/heads/main
	fi
' sh "$repository"

# --- The default branch -----------------------------------------------------
# The remote URL carries the username but never the token: a credential in the
# URL outlives the command that carried it, copied into the clone's
# `.git/config`. The token is handed to git out of band by an askpass helper
# that reads it from a file.
remote="http://$operator_user@$ingress_host/$repository"
token_file="$work_dir/token"
askpass="$work_dir/askpass"
(
	umask 077
	printf '%s' "$operator_token" > "$token_file"
	printf '#!/bin/sh\ncat %s\n' "$token_file" > "$askpass"
)
chmod 700 "$askpass"
export GIT_ASKPASS="$askpass"
export GIT_TERMINAL_PROMPT=0

git clone -q "$remote" "$work_dir/clone"
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
git -C "$work_dir/clone" push -q origin HEAD:main
echo "seed: pushed $repository"
