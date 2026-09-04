#!/bin/sh
# Prove the write wall, which is two walls with different jobs.
#
# NGINX DECIDES WHO MAY PUSH AT ALL. It is one static htpasswd file on every URL
# ending in /git-receive-pack. This attempts a real ref creation with the read
# credential through each way past a wall keyed on anything narrower, and fails
# if any is not refused:
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
# THE HOOK DECIDES WHAT AN ADMITTED CREDENTIAL MAY DO, and the mirror is the
# class it narrows to one branch. nginx admits the mirror to receive-pack, so
# what refuses it anywhere is `pre-receive.sh`: with the mirror credential a
# push at the probe's main is accepted, a push at any other ref on it is
# refused, and a push at rig.git's main — rig.git being what Flux reconciles
# the cluster from rather than a mirror of anything — is refused. A verdict
# there is git's own `ok` or `ng ... pre-receive hook declined` for the ref,
# and the ref the repository carries afterwards. It cannot be a status code: an
# accepted and a refused push are both 200.
#
# NOTHING HERE MAY MOVE rig.git, INCLUDING WHEN THE WALL DOES NOT HOLD. The
# mirror's attempt at its main names an old value that branch does not hold — a
# commit this run has just made — so a hook that wrongly accepts it still
# leaves git's own old-value check to refuse it, and the branch keeps its
# object name either way. That name is read before and after, and a difference
# is the worst finding this script can report. Every other ref an attempt could
# create is one this script names: swept from both repositories afterwards, and
# removed by the trap even when the run dies before the sweep. The probe
# repository is this script's own and is torn down whole.
#
# Run it after `seed.sh`; `seed.sh` runs it for you, once the hook is installed.
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
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
mirror_user=mirror

for tool in kubectl git curl base64; do
	command -v "$tool" > /dev/null 2>&1 || {
		echo "audit: no $tool on PATH, so the wall could not be probed" >&2
		exit 2
	}
done

# The hook is half of what is probed, so the probe repository is given the same
# file `seed.sh` installs rather than a copy of its rules.
here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/pre-receive.sh"
if [ ! -f "$hook" ]; then
	echo "audit: $hook is missing, so the probe has no hook to exercise" >&2
	exit 2
fi

ingress_host="$(kubectl -n "$namespace" get ingress git \
	-o jsonpath='{.spec.rules[0].host}' 2> /dev/null)"
if [ -z "$ingress_host" ]; then
	echo "audit: the git Ingress is not applied, so there is no host to probe" >&2
	exit 2
fi

credential() { # <secret>
	value="$(kubectl -n "$namespace" get secret "$1" \
		-o jsonpath='{.data.password}' 2> /dev/null | base64 -d)"
	if [ -z "$value" ]; then
		echo "audit: the $1 secret has no password, so there is nothing to probe with" >&2
		exit 2
	fi
	printf '%s' "$value"
}
sync_token="$(credential git-sync)"
mirror_token="$(credential git-mirror)"

pod="$(kubectl -n "$namespace" get pod -l app.kubernetes.io/name=git \
	-o jsonpath='{.items[0].metadata.name}' 2> /dev/null)"
if [ -z "$pod" ]; then
	echo "audit: no git pod, so there is nothing serving to probe" >&2
	exit 2
fi

work_dir="$(mktemp -d)"
# Every ref an attempt is about to try, and the whole of what comes out of the
# served repository. Removal is the trap's job rather than the sweep's, so a ref
# that landed is undone even when the run dies before the sweep; and it is by
# name rather than by `refs/heads/audit-*` because the served repository is the
# rig's, where a branch under that prefix may be an operator's. The probe
# repository is this script's own and goes whole.
attempted_refs=
cleanup() {
	rm -rf "$work_dir"
	kubectl -n "$namespace" exec "$pod" -- sh -c '
		repository="$1"
		probe_root="$2"
		shift 2
		rm -rf "/git/$probe_root"
		for ref in "$@"; do
			git -C "/git/$repository" update-ref -d "$ref"
		done
	' sh "$repository" "$probe_root" $attempted_refs > /dev/null 2>&1 || true
}
trap cleanup EXIT

# Each token goes to curl in a file rather than in `-u`, where it would be
# readable in /proc for the request's life — the rule seed.sh states for the
# credentials it mints. The values are hex from `openssl rand`, so curl's quoted
# form carries them without escaping.
(
	umask 077
	printf 'user = "%s:%s"\n' "$sync_user" "$sync_token" > "$work_dir/sync.curlrc"
	printf 'user = "%s:%s"\n' "$mirror_user" "$mirror_token" > "$work_dir/mirror.curlrc"
)

# A bare repo carrying one commit and the hook, and the tip the read credential
# will try to point a new ref at. The hook is installed after the seeding push
# so that no fixture here is built by a rule under test. Non-fast-forward is
# allowed explicitly because a mirror force-updates its branch by construction,
# and what this probes is the hook rather than the image's git defaults.
tip="$(kubectl -n "$namespace" exec -i "$pod" -- sh -c '
	set -eu
	rm -rf "/git/$2"
	git init --bare -q "/git/$1"
	git -C "/git/$1" config http.receivepack true
	git -C "/git/$1" config receive.denyNonFastForwards false
	git -C "/git/$1" symbolic-ref HEAD refs/heads/main
	wd="$(mktemp -d)"
	git init -q -b main "$wd"
	: > "$wd/seed"
	git -C "$wd" add seed
	git -C "$wd" -c user.name=probe -c user.email=probe@invalid commit -qm seed
	git -C "$wd" push -q "/git/$1" main
	rm -rf "$wd"
	cat > "/git/$1/hooks/pre-receive"
	chmod 0555 "/git/$1/hooks/pre-receive"
	git -C "/git/$1" rev-parse refs/heads/main
' sh "$probe" "$probe_root" < "$hook")"
if [ -z "$tip" ]; then
	echo "audit: could not stand up the probe repository" >&2
	exit 2
fi

# What rig.git's default branch holds before anything is attempted. `none` when
# it holds nothing, which is a first seed: the comparison afterwards is what
# matters and it is as good a value as any other.
rig_main_before="$(kubectl -n "$namespace" exec "$pod" -- sh -c '
	git -C "/git/$1" rev-parse --verify --quiet refs/heads/main || echo none
' sh "$repository")"

# An empty pack: the refs the read credential attempts point at an object the
# repository already has, so those requests carry no new objects and only the
# ref command matters.
git init -q "$work_dir/pk"
git -C "$work_dir/pk" pack-objects --stdout < /dev/null > "$work_dir/empty.pack" 2> /dev/null

# The mirror's attempts carry a real commit, because a pre-receive hook runs
# only once the pack has unpacked: an update naming an object the server does
# not have fails before the hook is reached, and a refusal that never reached
# the hook says nothing about it. This commit is also the old value the attempt
# at rig.git's main names — made here, so that branch cannot be holding it.
git init -q -b main "$work_dir/mirror"
: > "$work_dir/mirror/mirrored"
git -C "$work_dir/mirror" add mirrored
git -C "$work_dir/mirror" -c user.name=audit -c user.email=audit@invalid commit -qm mirrored
mirror_tip="$(git -C "$work_dir/mirror" rev-parse HEAD)"
printf 'HEAD\n' | git -C "$work_dir/mirror" pack-objects --revs --stdout \
	> "$work_dir/mirror.pack" 2> /dev/null

zero=0000000000000000000000000000000000000000
findings=0

# The wire body of a receive-pack request carrying one ref command: the
# pkt-line, the flush, and the pack.
push_body() { # <old> <new> <ref> <pack file>
	printf '%s %s %s\000report-status\n' "$1" "$2" "$3" > "$work_dir/cmd"
	len=$(($(wc -c < "$work_dir/cmd") + 4))
	printf '%04x' "$len" > "$work_dir/body"
	cat "$work_dir/cmd" >> "$work_dir/body"
	printf '0000' >> "$work_dir/body"
	cat "$4" >> "$work_dir/body"
}

# Attempt a create of $3 on $2 with the read credential, and report a finding
# unless nginx refused it and no ref appeared.
attempt() { # <label> <url> <ref>
	label="$1"
	url="$2"
	ref="$3"
	# Recorded before the request rather than after it, so a ref an unanswered
	# attempt still created is one the trap removes.
	attempted_refs="$attempted_refs $ref"
	push_body "$zero" "$tip" "$ref" "$work_dir/empty.pack"

	# A curl that never gets an answer exits non-zero and writes 000, and that
	# is a verdict this script has to reach rather than an exit code it dies of.
	code="$(curl -s -o /dev/null -w '%{http_code}' \
		-K "$work_dir/sync.curlrc" -X POST \
		-H 'Content-Type: application/x-git-receive-pack-request' \
		--data-binary "@$work_dir/body" "http://$ingress_host$url" || true)"

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

# Attempt an update of $4 on $2 with the mirror credential, where the hook and
# not nginx is what decides, and report a finding unless git answered $3.
mirror_attempt() { # <label> <url> <ok|ng> <ref> <old>
	label="$1"
	url="$2"
	want="$3"
	ref="$4"
	# Recorded for the trap like every other attempted ref, except main: what
	# the trap is given it deletes from rig.git, and rig.git's default branch
	# is the one ref here that nothing may remove. What keeps that attempt safe
	# is the old value it names, not the trap.
	if [ "$ref" != refs/heads/main ]; then
		attempted_refs="$attempted_refs $ref"
	fi
	push_body "$5" "$mirror_tip" "$ref" "$work_dir/mirror.pack"

	code="$(curl -s -o "$work_dir/reply" -w '%{http_code}' \
		-K "$work_dir/mirror.curlrc" -X POST \
		-H 'Content-Type: application/x-git-receive-pack-request' \
		--data-binary "@$work_dir/body" "http://$ingress_host$url" || true)"

	case "$code" in
	200) ;;
	401 | 403)
		# The mirror is in the writers file this run wrote, and a Secret
		# mounted as a directory reaches a running pod on the kubelet's next
		# sync. Refused here, the hook never decided anything.
		echo "audit: the mirror was refused at $url before the hook could decide;" >&2
		echo "audit: the pod is serving a writers file older than this run" >&2
		exit 2
		;;
	*)
		echo "audit: $url answered ${code:-nothing}, so nothing was exercised" >&2
		exit 2
		;;
	esac

	# git's report-status, which is the only place a hook's verdict for a ref
	# appears: the hook's own sentence goes to the server's stderr unless the
	# client asks for a sideband, and this client does not. The reason is read
	# as well as the refusal, because git refuses an update naming a stale old
	# value too — and one of the attempts below names one deliberately. The
	# string is receive-pack's own for a push a hook declined.
	reason="$(sed -n "s|.*ng $ref ||p" "$work_dir/reply" | head -n 1)"
	case "$want" in
	ok) needle="ok $ref" ;;
	*) needle="ng $ref pre-receive hook declined" ;;
	esac
	if grep -qaF "$needle" "$work_dir/reply"; then
		case "$want" in
		ok) verdict="accepted" ;;
		*) verdict="refused by the hook" ;;
		esac
	else
		case "$want" in
		ok) verdict="REFUSED — the one branch this credential is for" ;;
		*) verdict="NOT REFUSED BY THE HOOK (${reason:-accepted})" ;;
		esac
		findings=$((findings + 1))
	fi
	printf '  %-28s %-42s %s\n' "$label" "$url" "$verdict"
}

echo "audit: the read credential must be refused a push at every /git-receive-pack:"
attempt "plain endpoint (control)" "/$repository/git-receive-pack" "refs/heads/audit-control"
attempt "nested path" "/$probe/git-receive-pack" "refs/heads/audit-nested"
attempt "percent-encoded service" "/$probe/git-receive-pack?service=git%2Dreceive%2Dpack" "refs/heads/audit-percent"
attempt "duplicated service" "/$probe/git-receive-pack?service=git-upload-pack&service=git-receive-pack" "refs/heads/audit-dup"

echo "audit: the mirror credential must be held to main, and off $repository:"
mirror_attempt "main on the probe" "/$probe/git-receive-pack" ok "refs/heads/main" "$tip"
mirror_attempt "another ref on the probe" "/$probe/git-receive-pack" ng "refs/heads/audit-mirror" "$zero"
mirror_attempt "main on $repository" "/$repository/git-receive-pack" ng "refs/heads/main" "$mirror_tip"

# Belt to the verdicts' suspenders, and the whole of what the last attempt is
# judged on: no attempt may have created a ref in either repository, the branch
# the mirror is allowed must carry what it pushed, and rig.git's must be
# untouched. Naming the repository in each line is what keeps this from
# reporting a sweep narrower than the attempts.
state="$(kubectl -n "$namespace" exec "$pod" -- sh -c '
	for repo in "$1" "$2"; do
		git -C "/git/$repo" for-each-ref --format="created $repo %(refname)" \
			"refs/heads/audit-*" 2> /dev/null || true
	done
	printf "probe main %s\n" \
		"$(git -C "/git/$1" rev-parse --verify --quiet refs/heads/main || echo none)"
	printf "rig main %s\n" \
		"$(git -C "/git/$2" rev-parse --verify --quiet refs/heads/main || echo none)"
' sh "$probe" "$repository")"

created="$(printf '%s\n' "$state" | grep '^created ' || true)"
if [ -n "$created" ]; then
	echo "audit: an attempt created a ref on the server:" >&2
	echo "$created" >&2
	findings=$((findings + 1))
fi
if [ "$(printf '%s\n' "$state" | sed -n 's/^probe main //p')" != "$mirror_tip" ]; then
	echo "audit: the mirror's push at $probe's main did not land, so nothing here" >&2
	echo "audit: has shown that this credential can do the one thing it is for" >&2
	findings=$((findings + 1))
fi
rig_main_after="$(printf '%s\n' "$state" | sed -n 's/^rig main //p')"
if [ "$rig_main_after" != "$rig_main_before" ]; then
	echo "audit: $repository's default branch MOVED during this run:" >&2
	echo "audit: $rig_main_before -> $rig_main_after" >&2
	findings=$((findings + 1))
fi

if [ "$findings" -ne 0 ]; then
	echo "audit: the wall does not hold — see the findings above" >&2
	exit 1
fi
echo "audit: the reader was refused at every endpoint, the mirror everywhere but"
echo "audit: $probe's main, and $repository's default branch did not move — the wall holds"
