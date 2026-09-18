#!/bin/sh
# Shell test for bring-up.sh, over what it decides and no more: which stages a
# word runs, what each one refuses before touching the estate, that a Secret
# which reads back empty stops the run rather than reaching a server as a
# password, what goes into the URL a stage is given, where the recovery epoch
# comes from, and what a status from a command underneath is worth by the time
# it leaves.
#
# NOTHING HERE REACHES A CLUSTER, A SERVER OR A REGISTRY. `kubectl`, `psql` and
# `npm` are stubs on PATH that log every invocation and the environment it
# carried, and answer out of a fixture directory the case writes; the context
# and the namespace are named so that a stub that was missed would resolve
# against no rig.
#
# THE MIRROR CASES MATTER AS MUCH. A guard that refuses everything is the same
# defect wearing the other face, so each refusal has a case where the thing
# being checked is there and the stage goes on.
#
# Run:  ./deploy/rig/bring-up.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../.chug/tasks/_suite.sh"
SUT="$HERE/bring-up.sh"

BIN="$WORK/bin"
DIR="$WORK/cluster"
LOG="$WORK/calls.log"
SH="$(command -v sh)"
mkdir -p "$BIN"

cat > "$BIN/kubectl" << 'STUB'
#!/bin/sh
# A Secret is a file in the fixture directory, base64-encoded on the way out as
# the API server encodes one; a forward announces itself and then stays up long
# enough to be killed by the script that opened it.
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
*' port-forward '*)
	[ -z "${CHUG_STUB_FORWARD_DIES:-}" ] || exit 1
	printf 'Forwarding from 127.0.0.1:%s -> 5432\n' "${CHUG_STUB_PORT:-55440}"
	exec sleep 5
	;;
*' get secret '*)
	name="$(word_after secret)"
	key="${args##*jsonpath=\{.data.}"
	key="${key%%\}*}"
	[ -f "$dir/secret.$name.$key" ] || exit 0
	# `base64 -w` is GNU's alone, so the wrapping is undone rather than turned
	# off: a long value would otherwise come back with a newline in it.
	base64 < "$dir/secret.$name.$key" | tr -d '\n'
	exit 0
	;;
*' get deployment/chuggy-finalizer '*)
	case "$args" in
	*secretKeyRef*) cat "$dir/epoch-ref" 2> /dev/null ;;
	*) cat "$dir/epoch-value" 2> /dev/null ;;
	esac
	exit 0
	;;
esac
exit 0
STUB

cat > "$BIN/psql" << 'STUB'
#!/bin/sh
set -u
printf 'psql %s\n' "$*" >> "$CHUG_STUB_LOG"
printf 'psql owner password: %s\n' "${CHUG_PG_OWNER_PASSWORD:-none}" >> "$CHUG_STUB_LOG"
printf 'psql superuser password: %s\n' "${PGPASSWORD:-none}" >> "$CHUG_STUB_LOG"
exit "${CHUG_STUB_PSQL_RC:-0}"
STUB

cat > "$BIN/npm" << 'STUB'
#!/bin/sh
# The command and the environment it was given, which is the whole of what this
# script decides about a provisioning command.
set -u
printf 'npm %s\n' "$*" >> "$CHUG_STUB_LOG"
env | grep -E '^CHUG_(MIGRATE|PROVISION|BIND|API_OIDC)' | sort >> "$CHUG_STUB_LOG"
for script in ${CHUG_STUB_NPM_FAIL:-}; do
	for word in "$@"; do
		[ "$word" = "$script" ] && exit "${CHUG_STUB_NPM_RC:-1}"
	done
done
exit 0
STUB

chmod +x "$BIN/kubectl" "$BIN/psql" "$BIN/npm"

# An estate with every value these stages read. Each case starts from it and
# takes away the one thing it is about.
whole_rig() {
	rm -rf "$DIR"
	mkdir -p "$DIR"
	: > "$LOG"
	printf 'super-secret' > "$DIR/secret.postgres-superuser.password"
	for key in owner ticket-service api scheduler finalizer worker-plane; do
		printf 'pw-%s' "$key" > "$DIR/secret.chuggy-postgres-credentials.$key-password"
	done
	# A password with the characters that would make a URL a different URL.
	printf 'p@ss/word' > "$DIR/secret.chuggy-postgres-credentials.owner-password"
	printf 'chuggy-recovery-epoch epoch' > "$DIR/epoch-ref"
	printf 'epoch-2026-09-17' > "$DIR/secret.chuggy-recovery-epoch.epoch"
}

run() { # <env assignment>... -- <stage>...
	OUT="$WORK/.out"
	assignments=""
	while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
		assignments="$assignments $1"
		shift
	done
	shift
	set +e
	# `env` is given the assignments as words so that a case can name none.
	# shellcheck disable=SC2086
	env PATH="$BIN:$PATH" \
		CHUG_STUB_LOG="$LOG" \
		CHUG_STUB_DIR="$DIR" \
		CHUG_RIG_CONTEXT=no-such-context \
		CHUG_RIG_NAMESPACE=no-such-namespace \
		CHUG_RIG_DATABASE=fixture \
		$assignments \
		"$SH" "$SUT" "$@" > "$OUT" 2>&1
	RC=$?
	set -e
	cat "$LOG" >> "$OUT"
}

# --- which stages a word runs ---------------------------------------------------

whole_rig
run --
check "no stage named is a could-not-run" 2 "$RC" "name a stage"

whole_rig
run -- teardown
check "a stage this script does not have is a could-not-run" 2 "$RC" "unknown stage teardown"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_ISSUER=https://accounts.example.test \
	CHUG_RIG_SUBJECT=sub CHUG_RIG_KETO_WRITE_URL=http://keto.invalid -- all
check "all runs the roles, the schema, the row and the access" 0 "$RC" "done: roles migrate project access"
refute "and binds no repository when none is named" 0 "$RC" "bind:project-repository"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_ISSUER=https://accounts.example.test \
	CHUG_RIG_SUBJECT=sub CHUG_RIG_KETO_WRITE_URL=http://keto.invalid \
	CHUG_RIG_REPOSITORY=github.com/kasofsk/chuggy -- all
check "all binds the repository it is given" 0 "$RC" "bind:project-repository"

# --- the roles -------------------------------------------------------------------

whole_rig
run -- roles
check "the role script is what is applied" 0 "$RC" "deploy/rig/postgres/postgres-roles.sql"
check "and each role's password is in the environment rather than the argument list" 0 "$RC" "psql owner password: p@ss/word"
check "as is the superuser's" 0 "$RC" "psql superuser password: super-secret"

whole_rig
rm -f "$DIR/secret.chuggy-postgres-credentials.finalizer-password"
run -- roles
check "a password that reads back empty stops the run" 2 "$RC" "read back empty"
refute "and nothing was applied on the strength of it" 2 "$RC" "postgres-roles.sql"

whole_rig
run CHUG_STUB_PSQL_RC=3 -- roles
check "a server that refused the role script is a finding" 1 "$RC" "no role was created or rotated"

whole_rig
run CHUG_STUB_PSQL_RC=2 -- roles
check "a psql that could not connect is not a finding" 2 "$RC" "no role was created or rotated"

# --- the schema ---------------------------------------------------------------------

whole_rig
run -- migrate
check "the migration is given the owner's own identity" 0 "$RC" "CHUG_MIGRATE_DATABASE_URL=postgres://chuggy_owner:"
check "and a password that would make the URL a different URL is encoded" 0 "$RC" "p%40ss%2Fword@127.0.0.1"

whole_rig
run CHUG_STUB_NPM_FAIL=migrate CHUG_STUB_NPM_RC=2 -- migrate
check "a migration that could not run is not a finding" 2 "$RC" "the schema is where it was"

whole_rig
run CHUG_STUB_NPM_FAIL=migrate CHUG_STUB_NPM_RC=1 -- migrate
check "a migration that was refused is a finding" 1 "$RC" "the schema is where it was"

# --- the row and the tuples ------------------------------------------------------------

whole_rig
run -- project
check "a project stage with no partition is a could-not-run" 2 "$RC" "CHUG_RIG_TENANT"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p -- project
check "the project row is provisioned into the partition it was given" 0 "$RC" "CHUG_PROVISION_PROJECT_PROJECT=p"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_SUBJECT=sub CHUG_RIG_ISSUER=https://accounts.example.test -- access
check "access with no write port is a could-not-run" 2 "$RC" "CHUG_RIG_KETO_WRITE_URL"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_SUBJECT=sub CHUG_RIG_KETO_WRITE_URL=http://keto.invalid -- access
check "access with no issuer is a could-not-run" 2 "$RC" "CHUG_RIG_ISSUER"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_SUBJECT=sub \
	CHUG_RIG_ISSUER=https://accounts.example.test CHUG_RIG_KETO_WRITE_URL=http://keto.invalid \
	CHUG_RIG_RELATION=developers -- access
check "the tenant the project inherits from is written" 0 "$RC" "CHUG_PROVISION_RELATION=tenant"
check "and the member's own relation beside it" 0 "$RC" "CHUG_PROVISION_RELATION=developers"
check "derived from the issuer the API derives it from" 0 "$RC" "CHUG_API_OIDC_ISSUER=https://accounts.example.test"

# --- the binding -----------------------------------------------------------------------

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_REPOSITORY=github.com/kasofsk/chuggy -- binding
check "the epoch is the one the estate says it is at" 0 "$RC" "CHUG_BIND_REPOSITORY_RECOVERY_EPOCH=epoch-2026-09-17"
check "and re-running binds the same thing rather than a second one" 0 "$RC" "CHUG_BIND_REPOSITORY_OPERATION=bind-t-p-github.com/kasofsk/chuggy"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_REPOSITORY=r \
	CHUG_RIG_RECOVERY_EPOCH=an-epoch-by-hand -- binding
check "an epoch named by hand is the one used" 0 "$RC" "CHUG_BIND_REPOSITORY_RECOVERY_EPOCH=an-epoch-by-hand"

whole_rig
: > "$DIR/epoch-ref"
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_REPOSITORY=r -- binding
check "an estate that names no epoch is a could-not-run" 2 "$RC" "which epoch this installation is at is unknown"

whole_rig
: > "$DIR/epoch-ref"
printf 'epoch-by-value' > "$DIR/epoch-value"
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p CHUG_RIG_REPOSITORY=r -- binding
check "an epoch the finalizer carries by value is read too" 0 "$RC" "CHUG_BIND_REPOSITORY_RECOVERY_EPOCH=epoch-by-value"

whole_rig
run CHUG_RIG_TENANT=t CHUG_RIG_PROJECT=p -- binding
check "a binding with no repository is a could-not-run" 2 "$RC" "CHUG_RIG_REPOSITORY"

# --- what has to be there before anything runs ------------------------------------------

whole_rig
run CHUG_STUB_FORWARD_DIES=1 -- migrate
check "a forward that did not come up is a could-not-run" 2 "$RC" "the forward to svc/postgres"

whole_rig
run PATH="$WORK/empty" -- migrate
check "no kubectl is a could-not-run" 2 "$RC" "no \`kubectl\` on PATH"

done_ bring-up.test.sh
