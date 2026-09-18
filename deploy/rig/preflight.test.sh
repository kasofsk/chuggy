#!/bin/sh
# Shell test for preflight.sh, over what it decides and no more: that a cluster
# it could not reach is a could-not-run which reports nothing absent, that an
# object it did not find is a finding, that a Secret which is there but empty
# is one too, that the names the estate supplies are read from the estate, and
# that the served repository's HEAD is resolved rather than assumed.
#
# NOTHING HERE REACHES A CLUSTER. `kubectl` is a stub on PATH that logs every
# invocation and answers out of a fixture directory the case writes, and the
# context and every namespace are named so that a stub that was missed would
# resolve against no rig.
#
# THE MIRROR CASES MATTER AS MUCH. A preflight that reports everything absent
# is as useless as one that reports nothing, and it is the easier of the two to
# write by accident, so every finding here has a case where the object is
# present and the run goes on.
#
# Run:  ./deploy/rig/preflight.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../.chug/tasks/_suite.sh"
SUT="$HERE/preflight.sh"

BIN="$WORK/bin"
DIR="$WORK/cluster"
LOG="$WORK/kubectl.log"
SH="$(command -v sh)"
mkdir -p "$BIN"

cat > "$BIN/kubectl" << 'STUB'
#!/bin/sh
# The cluster as far as this suite lets the script see it. A namespace exists
# when the fixture directory holds a secrets file for it; a Secret's keys, the
# scheduler's mounts, the finalizer's epoch reference and the git service's
# answer are each a file the case writes or leaves out.
set -u
printf 'kubectl %s\n' "$*" >> "$CHUG_STUB_LOG"
dir="$CHUG_STUB_DIR"
args=" $* "

word_after() { # <word>
	_prev=""
	for _w in $CHUG_STUB_ARGS; do
		[ "$_prev" = "$1" ] && { printf '%s' "$_w"; return 0; }
		_prev="$_w"
	done
}
CHUG_STUB_ARGS="$*"

case "$args" in
*' get --raw /version '*) exit "${CHUG_STUB_REACH_RC:-0}" ;;
*' get namespace '*)
	ns="$(word_after namespace)"
	[ -f "$dir/secrets.$ns" ] && exit 0
	exit 1
	;;
*' get secret -o '*)
	cat "$dir/secrets.$(word_after -n)" 2> /dev/null
	exit 0
	;;
*' get secret '*)
	cat "$dir/keys.$(word_after -n).$(word_after secret)" 2> /dev/null
	exit 0
	;;
*' get deployment/chuggy-scheduler '*)
	cat "$dir/mounts" 2> /dev/null
	exit 0
	;;
*' get deployment/chuggy-finalizer '*)
	case "$args" in
	*secretKeyRef*) cat "$dir/epoch-ref" 2> /dev/null ;;
	*) cat "$dir/epoch-value" 2> /dev/null ;;
	esac
	exit 0
	;;
*' exec deployment/git '*)
	[ -f "$dir/git-verdict" ] || exit 1
	cat "$dir/git-verdict"
	exit 0
	;;
esac
exit 0
STUB
chmod +x "$BIN/kubectl"

# A rig with every object this preflight names. Each case starts from it and
# takes away the one thing it is about, so a finding is the absence and not the
# fixture.
whole_rig() {
	rm -rf "$DIR"
	mkdir -p "$DIR"
	: > "$LOG"

	cat > "$DIR/secrets.chuggy" << 'NAMES'
chuggy-postgres-credentials
postgres-superuser
chuggy-recovery-epoch
chuggy-finalizer-credentials
chuggy-github-app-portal
chuggy-github-app-worker
tailnet-tls
NAMES
	cat > "$DIR/keys.chuggy.chuggy-postgres-credentials" << 'KEYS'
owner-password
ticket-service-password
api-password
scheduler-password
finalizer-password
worker-plane-password
KEYS
	printf 'password\n' > "$DIR/keys.chuggy.postgres-superuser"

	printf 'chuggy-git-worker\nchuggy-agent-claude\n' > "$DIR/secrets.chuggy-work"
	printf 'password\n' > "$DIR/keys.chuggy-work.chuggy-git-worker"
	printf 'token\n' > "$DIR/keys.chuggy-work.chuggy-agent-claude"

	printf 'hydra\nkratos\nketo\nory-ui\n' > "$DIR/secrets.ory"
	printf 'grafana-admin\n' > "$DIR/secrets.monitoring"
	printf 'admin-user\nadmin-password\n' > "$DIR/keys.monitoring.grafana-admin"
	: > "$DIR/secrets.chuggy-git"

	printf '{"claude-code":{"secretName":"chuggy-agent-claude","key":"token","mountPath":"/etc/chuggy/claude"}}' > "$DIR/mounts"
	printf 'chuggy-recovery-epoch epoch' > "$DIR/epoch-ref"
	printf 'ok\n' > "$DIR/git-verdict"
}

run() {
	OUT="$WORK/.out"
	set +e
	env PATH="$BIN:$PATH" \
		CHUG_STUB_LOG="$LOG" \
		CHUG_STUB_DIR="$DIR" \
		CHUG_RIG_CONTEXT=no-such-context \
		"$@" \
		"$SH" "$SUT" > "$OUT" 2>&1
	RC=$?
	set -e
}

# --- a rig with everything on it ------------------------------------------------

whole_rig
run
check "a whole rig is clean" 0 "$RC" "0 absent or incomplete"
check "the derived credential is checked under the name the scheduler gave it" 0 "$RC" "chuggy-work/chuggy-agent-claude"
refute "nothing is reported absent" 0 "$RC" "ABSENT"

# --- could not run is not a pass ------------------------------------------------

whole_rig
run CHUG_STUB_REACH_RC=1
check "a cluster that did not answer is a could-not-run" 2 "$RC" "did not answer"
refute "and it reports nothing absent" 2 "$RC" "ABSENT"

whole_rig
run PATH="$WORK/empty"
check "no kubectl is a could-not-run" 2 "$RC" "no kubectl on PATH"

# --- an object that is not there -------------------------------------------------

whole_rig
: > "$DIR/secrets.monitoring"
run
check "an absent grafana-admin is a finding" 1 "$RC" "ABSENT   monitoring/grafana-admin"
check "and it says what its absence looks like" 1 "$RC" "CreateContainerConfigError"

whole_rig
grep -v '^chuggy-github-app-worker$' "$DIR/secrets.chuggy" > "$DIR/names" && mv "$DIR/names" "$DIR/secrets.chuggy"
run
check "an absent forge key is a finding on a rig that reaches no forge" 1 "$RC" "ABSENT   chuggy/chuggy-github-app-worker"

whole_rig
rm -f "$DIR/secrets.ory"
run
check "an absent namespace takes everything in it with it" 1 "$RC" "ABSENT   ory/kratos"
check "and it says the namespace is why" 1 "$RC" "ABSENT   namespace ory"

# --- an object that is there and carries nothing ----------------------------------

whole_rig
grep -v '^finalizer-password$' "$DIR/keys.chuggy.chuggy-postgres-credentials" > "$DIR/keys" \
	&& mv "$DIR/keys" "$DIR/keys.chuggy.chuggy-postgres-credentials"
run
check "a Secret without a key that reads it is incomplete" 1 "$RC" "INCOMPLETE chuggy/chuggy-postgres-credentials"
check "and the key it lacks is named" 1 "$RC" "carries no finalizer-password"

# --- the names the estate supplies -------------------------------------------------

whole_rig
: > "$DIR/mounts"
run
check "a scheduler naming no credential mounts is a finding" 1 "$RC" "could not be named"

whole_rig
printf 'not json at all' > "$DIR/mounts"
run
check "mounts that are not the JSON the scheduler reads is a could-not-run" 2 "$RC" "is not the JSON object"

whole_rig
printf 'chuggy-work\n' > "$DIR/secrets.chuggy-work"
run
check "a credential the scheduler mounts and nobody created is a finding" 1 "$RC" "ABSENT   chuggy-work/chuggy-agent-claude"
check "and the credential slot it satisfies is named" 1 "$RC" "claude-code"

whole_rig
printf 'chuggy-epoch-2026 value' > "$DIR/epoch-ref"
run
check "the epoch is looked for under the name the finalizer takes it from" 1 "$RC" "ABSENT   chuggy/chuggy-epoch-2026"

whole_rig
: > "$DIR/epoch-ref"
: > "$DIR/epoch-value"
run
check "a finalizer naming no recovery epoch is a finding" 1 "$RC" "could not be read"

whole_rig
: > "$DIR/epoch-ref"
printf 'an epoch set by value' > "$DIR/epoch-value"
run
check "an epoch supplied by value is not a finding" 0 "$RC" "0 absent or incomplete"

# --- the served repository ----------------------------------------------------------

whole_rig
printf 'refs/heads/master\n' > "$DIR/git-verdict"
run
check "a HEAD the repository does not have is incomplete" 1 "$RC" "HEAD names refs/heads/master"

whole_rig
printf 'empty\n' > "$DIR/git-verdict"
run
check "a repository with no commits yet is not held to a HEAD" 0 "$RC" "0 absent or incomplete"

whole_rig
printf 'absent\n' > "$DIR/git-verdict"
run
check "a repository nobody created is a finding" 1 "$RC" "a worker clone fails at attempt time"

whole_rig
rm -f "$DIR/git-verdict"
run
check "a git service that could not be reached is a could-not-run" 2 "$RC" "could not be reached"

done_ preflight.test.sh
