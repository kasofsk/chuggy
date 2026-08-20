#!/bin/sh
# Prove the write wall: the read (git-sync) credential cannot move a branch.
#
# The wall is one static htpasswd file on every URL ending in /git-receive-pack.
# This attempts a real ref creation with the read credential through each way
# past a wall keyed on anything narrower, and fails if any is not refused:
#
#   - the plain write endpoint (the control: refused because it is the writers
#     location, on every config);
#   - a nested /git-receive-pack path, which a `\.git/git-receive-pack` regex
#     would miss and git-http-backend would still dispatch as a push;
#   - the same nested path with a percent-encoded `service`, which nginx does
#     not decode and git-http-backend never reads;
#   - the same with a duplicated `service`, where nginx takes the first and the
#     backend the last.
#
# A refusal is nginx returning 401/403 before the backend; anything else means
# the reader was authenticated at a push endpoint, whether or not a repository
# happened to be there. Each attempt is a genuine ref creation against a bare
# repo this script stands up and tears down, so a pass is the ref never
# appearing, not merely a status code.
#
# Run it after `seed.sh`; `seed.sh` runs it for you. Exits 0 clean, 1 on a
# finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

namespace=chuggy-git
repository=rig.git
probe=probe.git/inner
sync_user=sync

for tool in kubectl git curl base64; do
	command -v "$tool" > /dev/null 2>&1 || {
		echo "audit: no $tool on PATH, so the wall could not be probed" >&2
		exit 2
	}
done

ingress_host="$(kubectl -n "$namespace" get ingress git \
	-o jsonpath='{.spec.rules[0].host}' 2> /dev/null)"
if [ -z "$ingress_host" ]; then
	echo "audit: the git Ingress is not applied, so there is no host to probe" >&2
	exit 2
fi

sync_token="$(kubectl -n "$namespace" get secret git-sync \
	-o jsonpath='{.data.password}' 2> /dev/null | base64 -d)"
if [ -z "$sync_token" ]; then
	echo "audit: the git-sync secret has no password, so there is nothing to probe with" >&2
	exit 2
fi

pod="$(kubectl -n "$namespace" get pod -l app.kubernetes.io/name=git \
	-o jsonpath='{.items[0].metadata.name}' 2> /dev/null)"
if [ -z "$pod" ]; then
	echo "audit: no git pod, so there is nothing serving to probe" >&2
	exit 2
fi

work_dir="$(mktemp -d)"
cleanup() {
	rm -rf "$work_dir"
	kubectl -n "$namespace" exec "$pod" -- rm -rf "/git/probe.git" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# A bare repo carrying one commit, nested so its push endpoint does not end in
# `.git/git-receive-pack`, and the tip the read credential will try to point a
# new ref at.
tip="$(kubectl -n "$namespace" exec "$pod" -- sh -c '
	set -eu
	rm -rf /git/probe.git
	git init --bare -q "/git/$1"
	git -C "/git/$1" config http.receivepack true
	git -C "/git/$1" symbolic-ref HEAD refs/heads/main
	wd="$(mktemp -d)"
	git init -q -b main "$wd"
	: > "$wd/seed"
	git -C "$wd" add seed
	git -C "$wd" -c user.name=probe -c user.email=probe@invalid commit -qm seed
	git -C "$wd" push -q "/git/$1" main
	rm -rf "$wd"
	git -C "/git/$1" rev-parse refs/heads/main
' sh "$probe")"
if [ -z "$tip" ]; then
	echo "audit: could not stand up the probe repository" >&2
	exit 2
fi

# An empty pack: the ref this creates points at an object the repo already has,
# so the request carries no new objects and only the ref command matters.
git init -q "$work_dir/pk"
git -C "$work_dir/pk" pack-objects --stdout < /dev/null > "$work_dir/empty.pack" 2> /dev/null

zero=0000000000000000000000000000000000000000
findings=0

# Attempt a create of $2 on $1 with the read credential, and report a finding
# unless nginx refused it and no ref appeared.
attempt() {
	label="$1"
	url="$2"
	ref="$3"
	body="$work_dir/body"
	printf '%s %s %s\000report-status\n' "$zero" "$tip" "$ref" > "$work_dir/cmd"
	len=$(($(wc -c < "$work_dir/cmd") + 4))
	printf '%04x' "$len" > "$body"
	cat "$work_dir/cmd" >> "$body"
	printf '0000' >> "$body"
	cat "$work_dir/empty.pack" >> "$body"

	code="$(curl -s -o /dev/null -w '%{http_code}' \
		-u "$sync_user:$sync_token" -X POST \
		-H 'Content-Type: application/x-git-receive-pack-request' \
		--data-binary "@$body" "http://$ingress_host$url")"

	case "$code" in
	401 | 403) verdict="refused ($code)" ;;
	*) verdict="AUTHENTICATED ($code)" ;;
	esac
	printf '  %-28s %-42s %s\n' "$label" "$url" "$verdict"
	if [ "$code" != 401 ] && [ "$code" != 403 ]; then
		findings=$((findings + 1))
	fi
}

echo "audit: the read credential must be refused a push at every /git-receive-pack:"
attempt "plain endpoint (control)" "/$repository/git-receive-pack" "refs/heads/audit-control"
attempt "nested path" "/$probe/git-receive-pack" "refs/heads/audit-nested"
attempt "percent-encoded service" "/$probe/git-receive-pack?service=git%2Dreceive%2Dpack" "refs/heads/audit-percent"
attempt "duplicated service" "/$probe/git-receive-pack?service=git-upload-pack&service=git-receive-pack" "refs/heads/audit-dup"

# Belt to the status codes' suspenders: no attempt may have moved a ref.
moved="$(kubectl -n "$namespace" exec "$pod" -- \
	sh -c 'git -C "/git/$1" for-each-ref --format="%(refname)" "refs/heads/audit-*" 2> /dev/null || true' \
	sh "$probe")"
if [ -n "$moved" ]; then
	echo "audit: the read credential created refs on the server:" >&2
	echo "$moved" >&2
	findings=$((findings + 1))
fi

if [ "$findings" -ne 0 ]; then
	echo "audit: the read credential reached a push endpoint — the write wall does not hold" >&2
	exit 1
fi
echo "audit: refused at every endpoint, no ref moved — the write wall holds"
