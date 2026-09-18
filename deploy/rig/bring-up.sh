#!/bin/sh
# From a migrated-or-empty database and an otherwise-deployed estate to an
# installation that answers: the roles, the schema, the project row, the
# access tuples that make it readable, and the repository bound to it.
#
# `deploy/rig/postgres/README.md` and `deploy/rig/keto/README.md` are the
# procedure and the argument for every step; this is the executable half of
# them, and where the two disagree the runbooks are what to read. Nothing here
# decides anything they do not.
#
# IT IS RUN AFTER `deploy/rig/preflight.sh` AND NOT INSTEAD OF IT. Every value
# below is read out of a Secret an operator issued by hand, and a Secret that
# is not there reads back as an empty string rather than as a failure: a
# pipeline's status is its last command's, and `base64 -d` exits 0 on the empty
# stdin a failed `kubectl get` leaves. So every read is checked for emptiness
# here as well — but the preflight is what tells an operator which object to
# go and make, and this script only tells them one is missing.
#
# THE CONNECTION IS A FORWARDED PORT, as the runbook's is, so that a password
# stays in this host's environment rather than appearing in the server pod's
# argument list. What that port cannot prove is that a password this procedure
# issued is the password a role has: PostgreSQL sees the connection arrive
# from the loopback address, which the server's `pg_hba.conf` trust-matches
# ahead of its catch-all. `deploy/rig/postgres/README.md` is where that is
# proved from a pod instead, and this script proves none of it.
#
# THE RECOVERY EPOCH IS READ FROM THE ESTATE, NOT SUPPLIED. A binding is made
# under an epoch and the door refuses one made under any other, so the epoch
# has to be the one the installation is actually at. The finalizer's own
# `CHUG_FINALIZER_RECOVERY_EPOCH` is where the estate says which that is, and
# this script follows it to the Secret rather than asking an operator to
# retype a value they would have to go and find. A rig whose finalizer is not
# deployed yet supplies it by hand instead.
#
# EVERY STAGE IS SAFE TO RE-RUN, and none of them is safe to interleave with a
# release: the migration stage is the runbook's, so the images that declare the
# schema version it lands go out in the same window. The role stage rotates
# every password when it is run again, which is a rotation the running control
# plane does not learn about until it restarts.
#
# Stages, in the order `all` runs them:
#   roles     create the login and group roles the migration cannot create
#   migrate   apply this checkout's schema as the owner
#   project   write the project row nothing else provisions
#   access    the project's tenant relation, and one member's relation
#   binding   bind a repository, under the epoch the estate is at
#
# Env:
#   CHUG_RIG_CONTEXT    kubectl context, default chuggy-fabric
#   CHUG_RIG_NAMESPACE  namespace holding the server, default chuggy
#   CHUG_RIG_DATABASE   the database to bring up, default chuggy
#   CHUG_RIG_PORT       the local port the forward listens on, default 55440
#   CHUG_RIG_TENANT     the tenant, required by every stage but `roles` and
#                       `migrate`
#   CHUG_RIG_PROJECT    the project, likewise
#   CHUG_RIG_ISSUER     the OIDC issuer a token carries; `access` derives the
#                       principal from it and the subject, with the function
#                       the API derives it from
#   CHUG_RIG_SUBJECT    the `sub` claim the provider issues for the member
#   CHUG_RIG_RELATION   the member's project relation, default admins
#   CHUG_RIG_KETO_WRITE_URL  Keto's write port, required by `access`
#   CHUG_RIG_REPOSITORY      the repository `binding` binds; `all` runs that
#                            stage only when it is named
#   CHUG_RIG_OPERATION       the binding's idempotency key; the default is
#                            derived from the partition and the repository, so
#                            re-running binds the same thing rather than
#                            conflicting with itself
#   CHUG_RIG_AUTHORITY_KIND     who is recorded as having bound, default operator
#   CHUG_RIG_AUTHORITY_SUBJECT  default CHUG_RIG_SUBJECT
#   CHUG_RIG_RECOVERY_EPOCH     the epoch to bind under, default the one the
#                               finalizer names
#   CHUG_RIG_FORWARD_SECS       how long to wait for the forwarded port
#
# Usage:
#   deploy/rig/bring-up.sh <stage>...
#   deploy/rig/bring-up.sh all
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass,
# and a stage that could not run has left the stages before it landed.
set -eu
export LC_ALL=C

context="${CHUG_RIG_CONTEXT:-chuggy-fabric}"
namespace="${CHUG_RIG_NAMESPACE:-chuggy}"
database="${CHUG_RIG_DATABASE:-chuggy}"
port="${CHUG_RIG_PORT:-55440}"
forward_secs="${CHUG_RIG_FORWARD_SECS:-60}"
tenant="${CHUG_RIG_TENANT:-}"
project="${CHUG_RIG_PROJECT:-}"
issuer="${CHUG_RIG_ISSUER:-}"
subject="${CHUG_RIG_SUBJECT:-}"
relation="${CHUG_RIG_RELATION:-admins}"
keto_write_url="${CHUG_RIG_KETO_WRITE_URL:-}"
repository="${CHUG_RIG_REPOSITORY:-}"
authority_kind="${CHUG_RIG_AUTHORITY_KIND:-operator}"
authority_subject="${CHUG_RIG_AUTHORITY_SUBJECT:-$subject}"

# A refusal leaves by a status none of the tools under this script returns:
# `npm` spends 1 on a script that exited non-zero and `psql` spends 2 on a
# connection it could not make, so exiting either directly would put this
# script's own verdict in a race with theirs.
refused_status=97
say() { printf 'bring-up: %s\n' "$*"; }
cannot() {
	printf 'bring-up: LINTER ERROR — %s\n' "$*" >&2
	exit "$refused_status"
}
fail() {
	printf 'bring-up: FAILED — %s\n' "$*" >&2
	exit 1
}
# A command's own protocol is kept: one is a finding, anything else could not
# run — which is what the migration and the provisioning commands promise.
leave_as() { # <status> <what>
	if [ "$1" -eq 1 ]; then fail "$2"; else cannot "$2"; fi
}
# psql keeps a protocol of its own: it spends 3 on a statement the server
# refused under ON_ERROR_STOP, which is a finding, and 1 and 2 on a psql that
# could not run or could not connect, which are not.
psql_leave_as() { # <status> <what>
	if [ "$1" -eq 3 ]; then fail "$2"; else cannot "$2"; fi
}

work=""
forward=""
leave() {
	rc=$?
	trap - EXIT
	if [ -n "$forward" ]; then
		kill "$forward" 2> /dev/null || true
		wait "$forward" 2> /dev/null || true
	fi
	[ -z "$work" ] || rm -rf "$work"
	case "$rc" in
	0) exit 0 ;;
	"$refused_status") exit 2 ;;
	*) exit 1 ;;
	esac
}
trap leave EXIT

for tool in kubectl node npm; do
	command -v "$tool" > /dev/null 2>&1 || cannot "no \`$tool\` on PATH, so nothing was brought up"
done
work="$(mktemp -d)" || cannot "no scratch directory could be made"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || cannot "not a git checkout, so the schema and the role script this would apply are not here"
cd "$root" || exit "$refused_status"

kube() { kubectl --context "$context" "$@"; }

# One Secret key, refused when it reads back empty. An empty password is not a
# failure anywhere below this line: it reaches psql as a password that is
# simply wrong, and reaches `postgres-roles.sql` as an instruction to clear the
# role's password.
secret() { # <name> <key>
	_value="$(kube -n "$namespace" get secret "$1" -o "jsonpath={.data.$2}" 2> /dev/null | base64 -d 2> /dev/null || true)"
	[ -n "$_value" ] || cannot "$1/$2 read back empty, so nothing was done with it; run deploy/rig/preflight.sh"
	printf '%s' "$_value"
}

# A password is interpolated into a URL, so it is encoded rather than trusted:
# an `@`, a `/`, a `:` or a `#` in one would silently make that URL a different
# URL. It goes in on stdin rather than as an argument, where every process on
# this host could read it.
urlencode() { # <value>
	printf '%s' "$1" | node -e 'let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => { process.stdout.write(encodeURIComponent(text)); });'
}

# The forwarded port, opened once however many stages need it and closed by
# `leave`. A forward that has not yet said it is listening is one a connection
# races, so the readiness is its own announcement rather than a sleep.
open_forward() {
	[ -z "$forward" ] || return 0
	kube -n "$namespace" port-forward "svc/postgres" "$port:5432" > "$work/forward.log" 2>&1 &
	forward=$!
	waited=0
	until grep -q 'Forwarding from' "$work/forward.log" 2> /dev/null; do
		kill -0 "$forward" 2> /dev/null \
			|| cannot "the forward to svc/postgres in $namespace stopped: $(cat "$work/forward.log")"
		waited=$((waited + 1))
		[ "$waited" -lt "$forward_secs" ] \
			|| cannot "svc/postgres in $namespace was not forwarded in time, so no stage ran"
		sleep 1
	done
	say "forwarding $port to svc/postgres in $namespace"
}

owner_database_url() {
	[ -z "${owner_url:-}" ] || return 0
	open_forward
	owner_password="$(secret chuggy-postgres-credentials owner-password)"
	owner_url="postgres://chuggy_owner:$(urlencode "$owner_password")@127.0.0.1:$port/$database"
}

partition() {
	[ -n "$tenant" ] || cannot "CHUG_RIG_TENANT names the tenant, and this stage writes into one"
	[ -n "$project" ] || cannot "CHUG_RIG_PROJECT names the project, and this stage writes into one"
}

# --- the stages ------------------------------------------------------------------

# The roles the migration cannot create for itself, in one transaction that
# lands whole or not at all. Re-running it rotates every password, which is why
# it is a stage of its own and not part of the migration.
stage_roles() {
	command -v psql > /dev/null 2>&1 || cannot "no \`psql\` on PATH, so the roles were not created"
	[ -f deploy/rig/postgres/postgres-roles.sql ] || cannot "deploy/rig/postgres/postgres-roles.sql is not here to apply"
	open_forward
	PGPASSWORD="$(secret postgres-superuser password)"
	CHUG_PG_OWNER_PASSWORD="$(secret chuggy-postgres-credentials owner-password)"
	CHUG_PG_TICKET_SERVICE_PASSWORD="$(secret chuggy-postgres-credentials ticket-service-password)"
	CHUG_PG_API_PASSWORD="$(secret chuggy-postgres-credentials api-password)"
	CHUG_PG_SCHEDULER_PASSWORD="$(secret chuggy-postgres-credentials scheduler-password)"
	CHUG_PG_FINALIZER_PASSWORD="$(secret chuggy-postgres-credentials finalizer-password)"
	CHUG_PG_WORKER_PLANE_PASSWORD="$(secret chuggy-postgres-credentials worker-plane-password)"
	export PGPASSWORD CHUG_PG_OWNER_PASSWORD CHUG_PG_TICKET_SERVICE_PASSWORD \
		CHUG_PG_API_PASSWORD CHUG_PG_SCHEDULER_PASSWORD CHUG_PG_FINALIZER_PASSWORD \
		CHUG_PG_WORKER_PLANE_PASSWORD
	psql -h 127.0.0.1 -p "$port" -U postgres -d "$database" \
		-v ON_ERROR_STOP=1 -f deploy/rig/postgres/postgres-roles.sql \
		|| psql_leave_as $? "the role script did not land, so no role was created or rotated"
	say "roles created in $database"
}

# The schema, as the owner and as nobody else. A ledger this checkout does not
# declare is the command's own could-not-run, and it is kept as one.
stage_migrate() {
	owner_database_url
	CHUG_MIGRATE_DATABASE_URL="$owner_url" npm run --silent migrate \
		|| leave_as $? "the migration did not apply, so the schema is where it was"
}

# The row nothing else provisions and everything else presupposes: without it
# a repository binding raises `repository binding project is absent` and the
# console correctly reports an installation with no project.
stage_project() {
	partition
	owner_database_url
	CHUG_PROVISION_PROJECT_DATABASE_URL="$owner_url" \
		CHUG_PROVISION_PROJECT_TENANT="$tenant" \
		CHUG_PROVISION_PROJECT_PROJECT="$project" \
		npm run --silent provision:project \
		|| leave_as $? "the project row was not written, so nothing that presupposes it can answer"
}

# Two tuples in the authority, which is where access lives: the tenant the
# project inherits from, and one member's relation on the project. Until both
# a project row and a read-implying tuple exist, the API answers empty and an
# operator cannot tell that from a broken deployment.
stage_access() {
	partition
	[ -n "$keto_write_url" ] || cannot "CHUG_RIG_KETO_WRITE_URL names Keto's write port, and access is a tuple there rather than a row"
	[ -n "$issuer" ] || cannot "CHUG_RIG_ISSUER is the issuer the principal is derived from, and the API derives it from the same one"
	[ -n "$subject" ] || cannot "CHUG_RIG_SUBJECT is the sub claim the member's token carries"
	CHUG_PROVISION_KETO_WRITE_URL="$keto_write_url" \
		CHUG_PROVISION_TENANT="$tenant" \
		CHUG_PROVISION_PROJECT="$project" \
		CHUG_PROVISION_RELATION=tenant \
		CHUG_PROVISION_ACTION=grant \
		npm run --silent provision:project-access \
		|| leave_as $? "the project's tenant relation was not written, so the project inherits from nothing"
	CHUG_PROVISION_KETO_WRITE_URL="$keto_write_url" \
		CHUG_API_OIDC_ISSUER="$issuer" \
		CHUG_PROVISION_SUBJECT="$subject" \
		CHUG_PROVISION_TENANT="$tenant" \
		CHUG_PROVISION_PROJECT="$project" \
		CHUG_PROVISION_RELATION="$relation" \
		CHUG_PROVISION_ACTION=grant \
		npm run --silent provision:project-access \
		|| leave_as $? "the member's $relation relation was not written, so the console still reports no project"
	say "granted tenant and $relation on $tenant/$project"
}

# The epoch a binding is made under, taken from where the estate says it is
# rather than from an operator's memory. A binding under any other epoch is
# answered `RecoveryEpochMismatch` and writes nothing.
recovery_epoch() {
	if [ -n "${CHUG_RIG_RECOVERY_EPOCH:-}" ]; then
		printf '%s' "$CHUG_RIG_RECOVERY_EPOCH"
		return 0
	fi
	_reference="$(kube -n "$namespace" get deployment/chuggy-finalizer \
		-o go-template='{{range .spec.template.spec.containers}}{{range .env}}{{if eq .name "CHUG_FINALIZER_RECOVERY_EPOCH"}}{{with .valueFrom}}{{with .secretKeyRef}}{{.name}} {{.key}}{{end}}{{end}}{{end}}{{end}}{{end}}' 2> /dev/null || true)"
	if [ -n "$_reference" ]; then
		secret "${_reference%% *}" "${_reference##* }"
		return 0
	fi
	_value="$(kube -n "$namespace" get deployment/chuggy-finalizer \
		-o go-template='{{range .spec.template.spec.containers}}{{range .env}}{{if eq .name "CHUG_FINALIZER_RECOVERY_EPOCH"}}{{if .value}}{{.value}}{{end}}{{end}}{{end}}{{end}}' 2> /dev/null || true)"
	[ -n "$_value" ] || cannot "the finalizer names no CHUG_FINALIZER_RECOVERY_EPOCH, so which epoch this installation is at is unknown; name it with CHUG_RIG_RECOVERY_EPOCH"
	printf '%s' "$_value"
}

stage_binding() {
	partition
	[ -n "$repository" ] || cannot "CHUG_RIG_REPOSITORY names the repository to bind"
	owner_database_url
	epoch="$(recovery_epoch)"
	operation="${CHUG_RIG_OPERATION:-bind-$tenant-$project-$repository}"
	CHUG_BIND_REPOSITORY_DATABASE_URL="$owner_url" \
		CHUG_BIND_REPOSITORY_TENANT="$tenant" \
		CHUG_BIND_REPOSITORY_PROJECT="$project" \
		CHUG_BIND_REPOSITORY_REPOSITORY="$repository" \
		CHUG_BIND_REPOSITORY_RECOVERY_EPOCH="$epoch" \
		CHUG_BIND_REPOSITORY_OPERATION="$operation" \
		CHUG_BIND_REPOSITORY_AUTHORITY_KIND="$authority_kind" \
		CHUG_BIND_REPOSITORY_AUTHORITY_SUBJECT="$authority_subject" \
		npm run --silent bind:project-repository \
		|| leave_as $? "$repository was not bound to $tenant/$project"
}

# --- what to run --------------------------------------------------------------------

[ "$#" -gt 0 ] || cannot "name a stage: roles, migrate, project, access, binding, or all"

stages=""
for argument in "$@"; do
	case "$argument" in
	roles | migrate | project | access | binding) stages="$stages $argument" ;;
	all)
		stages="$stages roles migrate project access"
		if [ -n "$repository" ]; then
			stages="$stages binding"
		else
			say "CHUG_RIG_REPOSITORY is unset, so \`all\` binds no repository"
		fi
		;;
	*) cannot "unknown stage $argument; the stages are roles, migrate, project, access, binding and all" ;;
	esac
done

for stage in $stages; do
	say "$stage"
	"stage_$stage"
done
say "done:$stages"
