#!/bin/sh
# Seed the rig's git service: mint the static credentials, create the bare
# repository, and push the contents of `deploy/rig/repo/` onto its default
# branch. Run it after `kubectl apply -k deploy/rig/bootstrap`; the git pod
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
ingress_host=git.192.168.0.114.nip.io
sync_user=sync
operator_user=operator

for tool in kubectl git openssl base64; do
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
seed_tree="$root/deploy/rig/repo"
[ -d "$seed_tree" ] || {
	echo "seed: $seed_tree is missing, so there is nothing to push" >&2
	exit 2
}

secret_password() {
	kubectl -n "$namespace" get secret "$1" -o jsonpath='{.data.password}' | base64 -d
}

# nginx validates a `{SHA}` entry against the base64 of the password's SHA-1.
# The password is what carries the entropy here: it is minted below by
# `openssl rand` and never chosen by a person.
credential_digest() {
	printf '%s' "$1" | openssl sha1 -binary | openssl base64
}

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
	kubectl -n "$namespace" create secret generic git-sync \
		--from-literal=username="$sync_user" \
		--from-literal=password="$sync_token" > /dev/null
	kubectl -n "$namespace" create secret generic git-operator \
		--from-literal=username="$operator_user" \
		--from-literal=password="$operator_token" > /dev/null
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
remote="http://$operator_user:$operator_token@$ingress_host/$repository"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
export GIT_TERMINAL_PROMPT=0

git clone -q "$remote" "$work_dir/clone"
# A clone of a repository with no commits leaves HEAD wherever the local git
# defaults it, and the branch this pushes to is not a local default.
git -C "$work_dir/clone" rev-parse --verify --quiet HEAD > /dev/null \
	|| git -C "$work_dir/clone" symbolic-ref HEAD refs/heads/main
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
