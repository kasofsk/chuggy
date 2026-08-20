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
# A refusal is nginx returning 401/403 before the backend; any other status
# means the reader was authenticated at a push endpoint, whether or not a
# repository happened to be there. An unanswered request or a 5xx is neither of
# those — it is the ingress or the pod failing rather than the wall deciding —
# so the run stops at 2 rather than reporting a wall it never exercised.
#
# Each attempt is a genuine ref creation, and every repository an attempt was
# aimed at is swept afterwards for the ref it tried to create, so a pass is the
# ref never appearing rather than merely a status code. The nested repository is
# this script's own and is torn down whole; the control is aimed at the served
# repository, which is not, so there only the refs an attempt could have created
# are removed.
#
# Run it after `seed.sh`; `seed.sh` runs it for you. Exits 0 clean, 1 on a
# finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

namespace=chuggy-git
repository=rig.git
# Nested so the probe's push endpoint does not end in `.git/git-receive-pack`.
# The root is named separately because it is what stand-up and teardown remove:
# a literal there would outlive a rename and orphan the repository.
probe_root=probe.git
probe="$probe_root/inner"
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
# Removal is the trap's job rather than the sweep's, so an attempt that lands a
# ref is undone even when the run dies before it reaches the sweep. The probe
# repository is this script's own and goes whole; the served one is not, so
# only the refs an attempt could have created come out of it.
cleanup() {
	rm -rf "$work_dir"
	kubectl -n "$namespace" exec "$pod" -- sh -c '
		rm -rf "/git/$2"
		git -C "/git/$1" for-each-ref --format="%(refname)" "refs/heads/audit-*" \
			| while read -r ref; do
				git -C "/git/$1" update-ref -d "$ref"
			done
	' sh "$repository" "$probe_root" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# The token goes to curl in a file rather than in `-u`, where it would be
# readable in /proc for the request's life — the rule seed.sh states for the
# credentials it mints. The value is hex from `openssl rand`, so curl's quoted
# form carries it without escaping.
(
	umask 077
	printf 'user = "%s:%s"\n' "$sync_user" "$sync_token" > "$work_dir/curlrc"
)

# A bare repo carrying one commit, and the tip the read credential will try to
# point a new ref at.
tip="$(kubectl -n "$namespace" exec "$pod" -- sh -c '
	set -eu
	rm -rf "/git/$2"
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
' sh "$probe" "$probe_root")"
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

	# A curl that never gets an answer exits non-zero and writes 000, and that
	# is a verdict this script has to reach rather than an exit code it dies of.
	code="$(curl -s -o /dev/null -w '%{http_code}' \
		-K "$work_dir/curlrc" -X POST \
		-H 'Content-Type: application/x-git-receive-pack-request' \
		--data-binary "@$body" "http://$ingress_host$url" || true)"

	case "$code" in
	401 | 403) verdict="refused ($code)" ;;
	'' | 000 | 5??)
		# The ingress or the pod failing, not the wall deciding: a rolling pod
		# answers 502 with nothing authenticated, so calling it a breach would
		# be a finding the wall never earned, and calling it a refusal would be
		# a pass it never earned either.
		echo "audit: $url answered ${code:-nothing}, so nothing was exercised" >&2
		exit 2
		;;
	*)
		verdict="AUTHENTICATED ($code)"
		findings=$((findings + 1))
		;;
	esac
	printf '  %-28s %-42s %s\n' "$label" "$url" "$verdict"
}

echo "audit: the read credential must be refused a push at every /git-receive-pack:"
attempt "plain endpoint (control)" "/$repository/git-receive-pack" "refs/heads/audit-control"
attempt "nested path" "/$probe/git-receive-pack" "refs/heads/audit-nested"
attempt "percent-encoded service" "/$probe/git-receive-pack?service=git%2Dreceive%2Dpack" "refs/heads/audit-percent"
attempt "duplicated service" "/$probe/git-receive-pack?service=git-upload-pack&service=git-receive-pack" "refs/heads/audit-dup"

# Belt to the status codes' suspenders: no attempt may have moved a ref, in
# either repository the attempts were aimed at. Naming the repository in each
# line is what keeps this from reporting a sweep narrower than the attempts.
moved="$(kubectl -n "$namespace" exec "$pod" -- sh -c '
	for repo in "$@"; do
		git -C "/git/$repo" for-each-ref --format="$repo %(refname)" \
			"refs/heads/audit-*" 2> /dev/null || true
	done
' sh "$repository" "$probe")"
if [ -n "$moved" ]; then
	echo "audit: the read credential created refs on the server:" >&2
	echo "$moved" >&2
	findings=$((findings + 1))
fi

if [ "$findings" -ne 0 ]; then
	echo "audit: the read credential reached a push endpoint — the write wall does not hold" >&2
	exit 1
fi
echo "audit: refused at every endpoint, no ref moved in $repository or $probe — the write wall holds"
