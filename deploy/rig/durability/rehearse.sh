#!/bin/sh
# Row D2 of the deployment rehearsal: dump the rig's PostgreSQL, prove the dump
# restorable, destroy the database, restore it, and establish a fresh recovery
# epoch before anything may mutate what came back.
#
# THE ORDER IS THE CONTROL. `verify` restores the dump into a scratch database
# and refuses to agree unless the inventory matches; `destroy` refuses to run
# until `verify` has left its receipt beside the dump. A rehearsal that loses
# the data it was rehearsing the recovery of is the only failure this procedure
# cannot walk back, so the one ordering it enforces is the one that prevents it.
#
# EVERY CONNECTION IS A CLIENT POD'S, over the cluster network, authenticated
# by the role's own password. `kubectl port-forward` is served inside the
# server pod's network namespace, so the server sees the loopback address and
# matches the `trust` line in `pg_hba.conf`: a session opened through one is
# admitted whatever password it offers, and establishes the role's grants and
# nothing about its credential. A pod is also what the client label is on, and
# it is applied after the pod is running because the policy controller learns a
# new pod's labels on its own schedule.
#
# THE ARCHIVE LIVES WHEREVER THE CALLER SAYS AND THIS SCRIPT WILL NOT GUESS.
# CHUG_RIG_ARCHIVE is the one variable with no default: between `destroy` and
# `restore` the dump is the only copy of the database, and a default would put
# it somewhere the caller had not agreed to.
#
# WHAT THIS PROVES AND WHAT IT ONLY EXERCISES is
# `deploy/rig/durability/README.md`'s, which is the runbook this script is the
# repeatable half of. In particular `fence` establishes the divergence a
# restore creates and the refusal that stops a stranded writer minting its way
# out of it; the refusal that writer meets when it tries to append or renew is
# the durable authority's own decision, and the operations-inbox slice is what
# carries both that adapter and the suites asserting it.
#
# Stages, in the order they are run:
#   client    create the labelled client pod, and prove it reaches the server
#   snapshot  record what the live database holds, before anything touches it
#   dump      take the globals and the database off the box
#   verify    restore the dump into a scratch database and compare
#   destroy   drop the database
#   restore   recreate it from the dump, and compare again
#   epoch     establish a fresh epoch, and show what moved before it did
#   fence     report what the restored leases carry, and what they may do
#   teardown  remove the client pod and the scratch database
#
# Env:
#   CHUG_RIG_ARCHIVE    where the dump is kept; required, no default
#   CHUG_RIG_CONTEXT    kubectl context, default chuggy-fabric
#   CHUG_RIG_NAMESPACE  namespace holding the server, default chuggy
#   CHUG_RIG_DATABASE   database to rehearse, default chuggy
#
# Usage:
#   CHUG_RIG_ARCHIVE=<dir> ./deploy/rig/durability/rehearse.sh <stage>
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

context="${CHUG_RIG_CONTEXT:-chuggy-fabric}"
namespace="${CHUG_RIG_NAMESPACE:-chuggy}"
database="${CHUG_RIG_DATABASE:-chuggy}"
archive="${CHUG_RIG_ARCHIVE:-}"

client=durability-rehearsal
scratch="${database}_restore_check"
service="postgres.$namespace.svc.cluster.local"

say() { echo "rehearsal: $*"; }
die() {
	echo "rehearsal: $*" >&2
	exit 1
}
cannot() {
	echo "rehearsal: $*" >&2
	exit 2
}

kube() { kubectl --context "$context" -n "$namespace" "$@"; }

command -v kubectl > /dev/null 2>&1 || cannot "no kubectl on PATH, so nothing ran"
[ -n "$archive" ] || cannot "CHUG_RIG_ARCHIVE is unset, and this script will not choose where the only copy of a database lives"
mkdir -p "$archive" || cannot "$archive is not writable"

dump_file="$archive/$database.dump"
globals_file="$archive/globals.sql"
receipt_file="$archive/sha256.txt"
verified_file="$archive/verified.txt"
live_inventory="$archive/inventory-live.txt"
scratch_inventory="$archive/inventory-scratch.txt"
restored_inventory="$archive/inventory-restored.txt"
epoched_inventory="$archive/inventory-after-epoch.txt"

# --- Talking to the server --------------------------------------------------
# One shape for every connection: a psql in the client pod, as the named role,
# with that role's password taken from the pod's environment rather than from
# an argument list every process on the node can read. The statement arrives on
# stdin.
client_psql() { # <role> <database>
	kube exec -i "$client" -- env CHUG_ROLE="$1" CHUG_DB="$2" CHUG_HOST="$service" sh -c '
		set -eu
		case "$CHUG_ROLE" in
		postgres) PGPASSWORD="$PGSUPERPASSWORD" ;;
		chuggy_owner) PGPASSWORD="$PGOWNERPASSWORD" ;;
		chuggy_dispatcher_login) PGPASSWORD="$PGDISPATCHERPASSWORD" ;;
		*)
			echo "no password is issued to $CHUG_ROLE" >&2
			exit 2
			;;
		esac
		export PGPASSWORD
		exec psql -X -A -t -q -v ON_ERROR_STOP=1 \
			"postgres://$CHUG_ROLE@$CHUG_HOST:5432/$CHUG_DB?connect_timeout=10"
	'
}

# The same connection with the error stream kept, for the statements whose
# whole point is the refusal the server answers with.
client_psql_refusable() { # <role> <database>
	client_psql "$1" "$2" 2>&1 || true
}

# What a database holds, as one sorted block: its objects and their owners, the
# grants that reach them, and how many rows are in each table. The row counts
# are asked for through `query_to_xml` so the set of tables comes from the
# catalog rather than from a list in this file that a migration would outgrow.
inventory() { # <database>
	client_psql postgres "$1" << 'SQL'
SELECT line FROM (
  SELECT format('relation|%s|%s', c.relkind, c.relname) AS line
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
  UNION ALL
  SELECT format('owner|%s|%s', c.relname, pg_get_userbyid(c.relowner))
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
  UNION ALL
  SELECT format('routine|%s|security_definer=%s', p.proname, p.prosecdef)
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT format('trigger|%s|%s', c.relname, t.tgname)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
  UNION ALL
  SELECT format('constraint|%s|%s|%s', c.relname, k.conname, k.contype)
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE k.connamespace = 'public'::regnamespace
  UNION ALL
  SELECT format('grant|%s|%s|%s|%s', g.table_name, g.column_name, g.grantee, g.privilege_type)
    FROM information_schema.column_privileges g
   WHERE g.table_schema = 'public'
  UNION ALL
  SELECT format('rows|%s|%s', c.relname,
                (xpath('/row/n/text()',
                       query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname),
                                    false, true, '')))[1]::text)
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
) inventory ORDER BY line
SQL
}

latest_epoch="SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1"

# --- The stages -------------------------------------------------------------

stage_client() {
	kube apply -f - << 'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: durability-rehearsal
spec:
  restartPolicy: Never
  containers:
    - name: client
      image: postgres:18.3-trixie
      command: ["sleep", "7200"]
      env:
        - name: PGSUPERPASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-superuser
              key: password
        - name: PGOWNERPASSWORD
          valueFrom:
            secretKeyRef:
              name: chuggy-postgres-credentials
              key: owner-password
        - name: PGDISPATCHERPASSWORD
          valueFrom:
            secretKeyRef:
              name: chuggy-postgres-credentials
              key: dispatcher-password
YAML
	kube wait --for=condition=Ready "pod/$client" --timeout=180s
	kube label --overwrite "pod/$client" chuggy.dev/postgres-client=true

	# The label goes onto a pod the controller already knows, and this poll is
	# for the interval before it acts on it. It is not a retry of a refusal: an
	# unadmitted client cannot be told from an unlabelled one, so a pod that
	# never gets in is reported as never getting in.
	waited=0
	until echo "SELECT current_user, inet_client_addr()" | client_psql postgres "$database" 2> /dev/null; do
		[ "$waited" -lt 40 ] || die "the labelled client never reached the server"
		waited=$((waited + 1))
		sleep 2
	done
	say "the client is admitted, and the address it prints is a pod's rather than the loopback a forward would have shown"
}

stage_snapshot() {
	inventory "$database" > "$live_inventory"
	echo "SELECT ordinal, epoch FROM recovery_epoch ORDER BY ordinal" \
		| client_psql chuggy_owner "$database" > "$archive/epochs-before.txt"
	echo "SELECT tenant, project, lifecycle, lifecycle_generation, fencing_epoch, head, owner, lease_expires_at, recovery_epoch FROM project WHERE owner IS NOT NULL ORDER BY tenant, project" \
		| client_psql chuggy_owner "$database" > "$archive/leases-before.txt"
	held="$(grep -c '' < "$archive/leases-before.txt" || true)"
	[ "$held" -gt 0 ] || cannot "no project is under lease, so a restore here would fence nobody and prove nothing"
	say "the inventory, the epochs and the $held held lease(s) are recorded in $archive"
}

stage_dump() {
	kube exec "$client" -- env CHUG_HOST="$service" sh -c '
		set -eu
		export PGPASSWORD="$PGSUPERPASSWORD"
		exec pg_dumpall --globals-only -h "$CHUG_HOST" -U postgres
	' > "$globals_file"
	kube exec "$client" -- env CHUG_HOST="$service" CHUG_DB="$database" sh -c '
		set -eu
		export PGPASSWORD="$PGSUPERPASSWORD"
		exec pg_dump --format=custom --create -h "$CHUG_HOST" -U postgres -d "$CHUG_DB"
	' > "$dump_file"
	[ -s "$dump_file" ] || die "the dump is empty"
	[ -s "$globals_file" ] || die "the globals dump is empty"
	sha256sum "$dump_file" "$globals_file" > "$receipt_file"
	say "the dump is off the box, in $archive, and $receipt_file is its receipt"
	cat "$receipt_file"
}

stage_verify() {
	[ -s "$dump_file" ] || cannot "there is no dump in $archive to verify"
	[ -s "$live_inventory" ] || cannot "there is no live inventory to compare against; run snapshot first"
	rm -f "$verified_file"

	echo "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" | client_psql postgres postgres
	echo "CREATE DATABASE $scratch" | client_psql postgres postgres
	kube cp "$dump_file" "$namespace/$client:/tmp/verify.dump"
	kube exec "$client" -- env CHUG_HOST="$service" CHUG_DB="$scratch" sh -c '
		set -eu
		export PGPASSWORD="$PGSUPERPASSWORD"
		exec pg_restore --exit-on-error --dbname="$CHUG_DB" -h "$CHUG_HOST" -U postgres /tmp/verify.dump
	'
	inventory "$scratch" > "$scratch_inventory"
	if ! diff -u "$live_inventory" "$scratch_inventory"; then
		die "the dump restored into something the live database is not, and NOTHING HAS BEEN DESTROYED"
	fi
	echo "DROP DATABASE $scratch WITH (FORCE)" | client_psql postgres postgres

	{
		echo "this dump restored into a scratch database whose inventory matched the live one"
		date -u +%Y-%m-%dT%H:%M:%SZ
		cat "$receipt_file"
	} > "$verified_file"
	say "the dump is restorable, and $verified_file says so"
}

stage_destroy() {
	[ -s "$verified_file" ] || cannot "no receipt in $archive; a dump nobody has restored is not a backup"
	taken="$(sha256sum "$dump_file" | cut -d' ' -f1)"
	grep -q "$taken" "$verified_file" || cannot "the receipt in $archive was written for a different dump"

	echo "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$database' AND pid <> pg_backend_pid()" \
		| client_psql postgres postgres > /dev/null
	echo "DROP DATABASE $database WITH (FORCE)" | client_psql postgres postgres
	survivor="$(echo "SELECT datname FROM pg_database WHERE datname = '$database'" | client_psql postgres postgres)"
	if [ -n "$survivor" ]; then
		die "the database is still there"
	fi
	say "the database is gone, and the dump in $archive is now the only copy of it"
	echo "SELECT 1" | client_psql_refusable postgres "$database"
}

stage_restore() {
	[ -s "$dump_file" ] || cannot "there is no dump in $archive to restore"
	kube cp "$dump_file" "$namespace/$client:/tmp/restore.dump"
	kube exec "$client" -- env CHUG_HOST="$service" sh -c '
		set -eu
		export PGPASSWORD="$PGSUPERPASSWORD"
		exec pg_restore --exit-on-error --create --dbname=postgres -h "$CHUG_HOST" -U postgres /tmp/restore.dump
	'
	inventory "$database" > "$restored_inventory"
	diff -u "$live_inventory" "$restored_inventory" || die "what came back is not what was dumped"
	say "the database is back, and its inventory is the one $live_inventory recorded"
}

stage_epoch() {
	[ -s "$restored_inventory" ] || cannot "there is no post-restore inventory, so nothing can say what moved before the epoch"
	minted="epoch-$(cat /proc/sys/kernel/random/uuid 2> /dev/null || uuidgen)"
	[ -n "$minted" ] || cannot "no source of an unpredictable epoch on this host"

	# Non-reuse is the server's constraint, so it is put to the server rather
	# than asserted here: an epoch already on record has to come back refused.
	standing="$(head -n 1 "$archive/epochs-before.txt" | cut -d'|' -f2)"
	[ -n "$standing" ] || cannot "the snapshot recorded no epoch, so non-reuse cannot be put to the server"
	refusal="$(echo "INSERT INTO recovery_epoch (epoch) VALUES ('$standing')" | client_psql_refusable chuggy_owner "$database")"
	case "$refusal" in
	*duplicate*) say "an epoch already on record comes back refused: $refusal" ;;
	*) die "the server accepted an epoch it had already issued authority under" ;;
	esac

	echo "INSERT INTO recovery_epoch (epoch) VALUES ('$minted') RETURNING ordinal, epoch, established_at" \
		| client_psql chuggy_owner "$database" > "$archive/epoch-established.txt"
	cat "$archive/epoch-established.txt"

	inventory "$database" > "$epoched_inventory"
	say "everything the database did between coming back and the epoch being established:"
	diff -u "$restored_inventory" "$epoched_inventory" || true
	say "the fresh epoch is $minted"
}

stage_fence() {
	say "what each restored lease carries, read as the runtime role reads it:"
	echo "SELECT p.tenant, p.project, p.owner, p.fencing_epoch, p.recovery_epoch, e.epoch, (p.recovery_epoch = e.epoch), (p.lease_expires_at > now()) FROM project p CROSS JOIN ($latest_epoch) e (epoch) WHERE p.owner IS NOT NULL ORDER BY p.tenant, p.project" \
		| client_psql chuggy_dispatcher_login "$database"

	held="$(echo "SELECT count(*) FROM project WHERE owner IS NOT NULL" | client_psql chuggy_dispatcher_login "$database")"
	[ "$held" -gt 0 ] || cannot "the restored database holds no lease, so this stage would agree with itself"
	current="$(echo "SELECT count(*) FROM project WHERE owner IS NOT NULL AND recovery_epoch = ($latest_epoch)" | client_psql chuggy_dispatcher_login "$database")"
	[ "$current" = "0" ] || die "$current of the $held restored lease(s) still carry the current epoch, so the restore fenced nobody"
	say "none of the $held restored lease(s) carries the current epoch"

	# A fence is worth nothing if the writer it fences can mint its way past
	# it, and that refusal is the server's rather than the adapter's.
	refusal="$(echo "INSERT INTO recovery_epoch (epoch) VALUES ('epoch-minted-by-the-runtime')" | client_psql_refusable chuggy_dispatcher_login "$database")"
	case "$refusal" in
	*"permission denied"*) say "the runtime role cannot unfence itself: $refusal" ;;
	*) die "the runtime role was allowed to establish a recovery epoch" ;;
	esac
}

stage_teardown() {
	echo "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" | client_psql postgres postgres || true
	kube delete "pod/$client" --ignore-not-found
	say "the client pod and the scratch database are gone, and the archive in $archive is untouched"
}

case "${1:-}" in
client) stage_client ;;
snapshot) stage_snapshot ;;
dump) stage_dump ;;
verify) stage_verify ;;
destroy) stage_destroy ;;
restore) stage_restore ;;
epoch) stage_epoch ;;
fence) stage_fence ;;
teardown) stage_teardown ;;
*) cannot "name a stage: client, snapshot, dump, verify, destroy, restore, epoch, fence, teardown" ;;
esac
