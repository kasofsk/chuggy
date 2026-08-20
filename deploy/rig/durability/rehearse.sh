#!/bin/sh
# Row D2 of the deployment rehearsal: dump the rig's PostgreSQL, prove the dump
# restorable, destroy the database, restore it, and establish a fresh recovery
# epoch before anything may mutate what came back.
#
# THE ORDER IS THE CONTROL, and every stage that depends on an earlier one
# refuses without its receipt. `verify` restores the dump into a scratch
# database and refuses to agree unless the inventory matches; `destroy` refuses
# until `verify` has left a receipt naming the digest of the dump that is
# actually there; `epoch` and `fence` refuse until `restore` has left an
# inventory, because both are claims about a database that came back and
# neither can tell on its own that one did. The first of those is the one that
# matters most: a rehearsal that loses the data it was rehearsing the recovery
# of is the only failure here that cannot be walked back.
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
# the durable authority's own decision, and the adapter that makes it is not in
# this tree yet, nor are the suites that assert it.
#
# THE WITNESS IS WHAT MAKES `fence` MEAN ANYTHING. Read over every owned
# project, that stage's predicate comes true the moment a fresh epoch is
# minted, whether or not anything was dumped, destroyed or restored — and a rig
# that has been rehearsed against before is full of leases superseded long ago,
# which the predicate holds over for free. So `snapshot` picks out one lease
# that was BOTH under an unexpired term and under the epoch then current, and
# writes the row down. `restore` requires that exact row back out of the dump,
# owner and project-local fencing epoch and head and expiry alike, which is the
# comparison a row-count inventory cannot make. `fence` then requires it to be
# superseded while its term has still not run out, which is the state a
# stranded writer is actually in.
#
# NOTHING HERE ARMS A WITNESS, and `snapshot` refuses when the rig carries
# none. A control that manufactures the evidence it then checks is not a
# control, and what takes a lease is the durable authority.
#
# Stages, in the order they are run:
#   client    create the labelled client pod, and prove it reaches the server
#   snapshot  record what the live database holds, and pick the witness
#   dump      take the globals and the database off the box
#   verify    restore the dump into a scratch database and compare
#   destroy   drop the database
#   restore   recreate it from the dump, compare again, and re-read the witness
#   epoch     establish a fresh epoch, and require it to be all that moved
#   fence     report what the restored leases carry, and what the witness may do
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
# EXITS 0 CLEAN, 1 ON A FINDING, 2 WHEN IT COULD NOT RUN — and two is only
# ever this script's own preconditions: no kubectl, an archive that is unset or
# unwritable or readable by others, or a stage run before the one whose receipt
# it needs. Everything past those exits one, the cluster's own failures
# included. A statement the server refused and a statement that never reached
# it arrive here as the same status, and a script that cannot tell them apart
# must not print a verdict that says it can. So a one is read before it is
# believed: it says a finding, OR the rig went away under the run.
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

# The archive is credential material before it is anything else: `globals.sql`
# carries every login role's SCRAM verifier and the dump carries the record. So
# the umask is set here rather than inherited, and it covers the directory and
# every file written into it alike — a directory nobody else may open is the
# containment, and a file nobody else may read is what survives the directory
# being moved or opened up later. An archive that already exists is checked
# against that mode rather than assumed to have it. `mkdir -p` also agrees with
# a directory that is already there, which says nothing about whether this
# process may write in it, so that is asked separately.
umask 077
mkdir -p "$archive" || cannot "$archive could not be created"
archive_mode="$(stat -c '%a' "$archive" 2> /dev/null || true)"
[ -n "$archive_mode" ] || cannot "the mode of $archive could not be read, so nothing here can say who else may read the dump"
[ "$archive_mode" = "700" ] || cannot "$archive is mode $archive_mode, and what goes into it carries every login role's verifier"
: > "$archive/.writable" 2> /dev/null || cannot "$archive is not writable"
rm -f "$archive/.writable"

dump_file="$archive/$database.dump"
globals_file="$archive/globals.sql"
receipt_file="$archive/sha256.txt"
verified_file="$archive/verified.txt"
live_inventory="$archive/inventory-live.txt"
scratch_inventory="$archive/inventory-scratch.txt"
restored_inventory="$archive/inventory-restored.txt"
epoched_inventory="$archive/inventory-after-epoch.txt"
expected_inventory="$archive/inventory-expected-after-epoch.txt"
witness_partition_file="$archive/witness-partition.txt"
witness_before_file="$archive/witness-before.txt"
witness_restored_file="$archive/witness-restored.txt"
witness_fenced_file="$archive/witness-fenced.txt"
witness_standing_file="$archive/witness-standing.txt"

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

# The sha256 of a file that has to be there, left in `digest`.
#
# NOT A PIPELINE, and that is the whole of it. `sha256sum "$f" | cut …` takes
# the status of `cut`, which succeeds on the empty input a missing file gives
# it; `set -e` sees a successful command, and the caller is left holding an
# empty string it believes is a digest. Every comparison downstream then agrees
# with itself — an empty needle is one every haystack contains.
digest=""
read_digest() { # <path>
	[ -s "$1" ] || cannot "$1 is missing or empty, and nothing has a digest of nothing"
	digest="$(sha256sum "$1")" || cannot "sha256sum could not read $1"
	digest="${digest%% *}"
	case "$digest" in
	"" | *[!0-9a-f]*) cannot "sha256sum printed no digest for $1" ;;
	esac
}

# The partition `snapshot` chose, left in `witness_tenant` and
# `witness_project`.
witness_tenant=""
witness_project=""
read_witness_partition() {
	[ -s "$witness_partition_file" ] \
		|| cannot "there is no witness recorded in $archive; run snapshot first"
	witness_tenant=""
	witness_project=""
	while read -r field value; do
		case "$field" in
		tenant) witness_tenant="$value" ;;
		project) witness_project="$value" ;;
		esac
	done < "$witness_partition_file"
	{ [ -n "$witness_tenant" ] && [ -n "$witness_project" ]; } \
		|| cannot "the witness recorded in $archive names no partition"
}

# The witness row, one `field value` line per column, so a later stage can ask
# for the same block and diff it whole rather than compare fields it chose in
# advance. Read as the owner role: a row the restore lost entirely has to show
# up as a missing block and not as a privilege the runtime role lacks.
witness_row() { # <tenant> <project>
	client_psql chuggy_owner "$database" << SQL
SELECT u FROM project p, LATERAL unnest(ARRAY[
  'tenant ' || p.tenant::text,
  'project ' || p.project::text,
  'owner ' || coalesce(p.owner::text, '(none)'),
  'lifecycle ' || p.lifecycle::text,
  'lifecycle_generation ' || p.lifecycle_generation::text,
  'fencing_epoch ' || p.fencing_epoch::text,
  'head ' || p.head::text,
  'recovery_epoch ' || coalesce(p.recovery_epoch::text, '(none)'),
  'lease_expires_at ' || coalesce(p.lease_expires_at::text, '(none)')
]) AS u
 WHERE p.tenant = '$1' AND p.project = '$2'
 ORDER BY u
SQL
}

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

	# The witness: one lease that is BOTH unexpired and under the epoch now
	# current. A lease already superseded when the dump is taken is fenced by
	# nothing this procedure does, and one whose term has already run out is
	# held by nobody to fence — so a stage asserting over every held lease
	# asserts mostly over those, and the members that would refute it are the
	# ones that have to be there. The latest expiry is preferred so the term
	# outlasts the rehearsal.
	client_psql chuggy_owner "$database" > "$witness_partition_file" << SQL
SELECT unnest(ARRAY['tenant ' || w.tenant::text, 'project ' || w.project::text])
  FROM (SELECT tenant, project
          FROM project
         WHERE owner IS NOT NULL
           AND lease_expires_at > now()
           AND recovery_epoch = ($latest_epoch)
         ORDER BY lease_expires_at DESC
         LIMIT 1) w
SQL
	[ -s "$witness_partition_file" ] \
		|| cannot "no project holds an unexpired lease under the current recovery epoch, so this rehearsal would fence nobody who was live when it began; arm one and run snapshot again"
	read_witness_partition
	witness_row "$witness_tenant" "$witness_project" > "$witness_before_file"
	[ -s "$witness_before_file" ] || cannot "the witness partition names no row"

	say "the inventory, the epochs and the $held held lease(s) are recorded in $archive"
	say "the witness is the lease this rehearsal has to fence:"
	cat "$witness_before_file"
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

	# The digest goes in on a line of its own and under a name, so `destroy` can
	# read back the one field it needs and compare it whole. A receipt whose
	# digest has to be found by searching the file is a receipt whose reader
	# decides what counts as a match.
	read_digest "$dump_file"
	{
		echo "this dump restored into a scratch database whose inventory matched the live one"
		date -u +%Y-%m-%dT%H:%M:%SZ
		echo "dump-sha256 $digest"
		cat "$receipt_file"
	} > "$verified_file"
	say "the dump is restorable, and $verified_file says so"
}

stage_destroy() {
	[ -s "$verified_file" ] || cannot "no receipt in $archive; a dump nobody has restored is not a backup"

	# `verify` and `restore` each refuse without a dump, and so does this: it is
	# the stage where the absence cannot be walked back, and the reachable way
	# in is ordinary — the archive is credential material, and deleting the dump
	# while leaving the receipt is exactly the half-tidy the warning invites.
	# `read_digest` refuses on a missing dump instead of returning an empty
	# string, and the receipt's digest is compared whole rather than looked for
	# inside the file.
	read_digest "$dump_file"
	recorded=""
	while read -r field value; do
		[ "$field" = "dump-sha256" ] || continue
		recorded="$value"
	done < "$verified_file"
	[ -n "$recorded" ] || cannot "the receipt in $archive names no digest; run verify again"
	[ "$recorded" = "$digest" ] || cannot "the receipt in $archive was written for a different dump"

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
	[ -s "$witness_before_file" ] || cannot "there is no witness recorded in $archive; run snapshot first"
	read_witness_partition
	kube cp "$dump_file" "$namespace/$client:/tmp/restore.dump"
	kube exec "$client" -- env CHUG_HOST="$service" sh -c '
		set -eu
		export PGPASSWORD="$PGSUPERPASSWORD"
		exec pg_restore --exit-on-error --create --dbname=postgres -h "$CHUG_HOST" -U postgres /tmp/restore.dump
	'
	inventory "$database" > "$restored_inventory"
	diff -u "$live_inventory" "$restored_inventory" || die "what came back is not what was dumped"

	# The inventory counts rows and cannot see an ownership row that came back
	# changed, because an UPDATE changes no count — and the ownership row is the
	# one the fencing argument is about. So the witness is asked for again and
	# compared whole, and this is the stage to do it in: the database it is read
	# out of did not exist a moment ago, so the row is the dump's or it is
	# nothing.
	witness_row "$witness_tenant" "$witness_project" > "$witness_restored_file"
	[ -s "$witness_restored_file" ] || die "the witness lease did not come back at all"
	diff -u "$witness_before_file" "$witness_restored_file" \
		|| die "the witness lease came back as something the dump did not hold"

	say "the database is back, its inventory is the one $live_inventory recorded, and the witness lease came out of the dump unchanged"
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

	# What the establish should have cost the inventory, worked out from the
	# inventory itself: one more row in `recovery_epoch`, and nothing else moved
	# at all. The first diff is the operator's view of the window and is
	# EXPECTED to be non-empty, which is the only reason its status is dropped;
	# the second is the assertion, and without it this stage prints the same
	# success line on a run where the database did other things too.
	grep -q '^rows|recovery_epoch|' "$restored_inventory" \
		|| cannot "the post-restore inventory carries no recovery_epoch row count, so nothing here can say what the establish added"
	awk -F'|' 'BEGIN { OFS = "|" } $1 == "rows" && $2 == "recovery_epoch" { $3 = $3 + 1 } { print }' \
		"$restored_inventory" > "$expected_inventory"

	say "everything the database did between coming back and the epoch being established:"
	diff -u "$restored_inventory" "$epoched_inventory" || true
	diff -u "$expected_inventory" "$epoched_inventory" \
		|| die "recording the epoch is not all the database did between the restore and now"
	say "the fresh epoch is $minted"
}

stage_fence() {
	[ -s "$witness_before_file" ] || cannot "there is no witness recorded in $archive; run snapshot first"
	[ -s "$restored_inventory" ] || cannot "there is no post-restore inventory, so no restore has been shown to have happened for this to be about"
	read_witness_partition

	say "what each restored lease carries, read as the runtime role reads it:"
	echo "SELECT p.tenant, p.project, p.owner, p.fencing_epoch, p.recovery_epoch, e.epoch, (p.recovery_epoch = e.epoch), (p.lease_expires_at > now()) FROM project p CROSS JOIN ($latest_epoch) e (epoch) WHERE p.owner IS NOT NULL ORDER BY p.tenant, p.project" \
		| client_psql chuggy_dispatcher_login "$database"

	held="$(echo "SELECT count(*) FROM project WHERE owner IS NOT NULL" | client_psql chuggy_dispatcher_login "$database")"
	[ "$held" -gt 0 ] || cannot "the restored database holds no lease, so this stage would agree with itself"
	current="$(echo "SELECT count(*) FROM project WHERE owner IS NOT NULL AND recovery_epoch = ($latest_epoch)" | client_psql chuggy_dispatcher_login "$database")"
	[ "$current" = "0" ] || die "$current of the $held restored lease(s) still carry the current epoch, so the restore fenced nobody"
	say "none of the $held restored lease(s) carries the current epoch"

	# That last sentence is nearly free, and here is the member it is not free
	# over. The witness was live and current when the dump was taken; `restore`
	# required it back out of the dump unchanged; it is read again here, after
	# the establish, because the window between those two is the one an
	# inventory of row counts cannot see into.
	witness_row "$witness_tenant" "$witness_project" > "$witness_fenced_file"
	[ -s "$witness_fenced_file" ] || die "the witness lease is gone from the restored database"
	diff -u "$witness_before_file" "$witness_fenced_file" \
		|| die "the witness lease is no longer the row the dump held, so something wrote to it after the restore"

	# Each predicate comes back as a word this file chose, not as a boolean. A
	# boolean reaches the shell spelled whichever way it was rendered — `t`
	# through psql's own display, `true` once anything casts it — and a guard
	# comparing against the wrong spelling reports the opposite of the row it
	# just read.
	client_psql chuggy_dispatcher_login "$database" > "$witness_standing_file" << SQL
SELECT unnest(ARRAY[
  'superseded ' || CASE WHEN p.recovery_epoch IS DISTINCT FROM e.epoch THEN 'yes' ELSE 'no' END,
  'unexpired ' || CASE WHEN p.lease_expires_at > now() THEN 'yes' ELSE 'no' END,
  'carries ' || coalesce(p.recovery_epoch::text, '(none)'),
  'issued_under ' || e.epoch::text])
  FROM project p CROSS JOIN ($latest_epoch) e (epoch)
 WHERE p.tenant = '$witness_tenant' AND p.project = '$witness_project'
SQL
	cat "$witness_standing_file"
	superseded=""
	unexpired=""
	while read -r field value; do
		case "$field" in
		superseded) superseded="$value" ;;
		unexpired) unexpired="$value" ;;
		esac
	done < "$witness_standing_file"
	case "$superseded" in
	yes) : ;;
	no) die "the witness lease still carries the epoch authority is issued under, so the one writer that was live is not fenced" ;;
	*) cannot "the server did not say whether the witness lease is superseded" ;;
	esac
	case "$unexpired" in
	yes) : ;;
	no) die "the witness lease ran out during the rehearsal, so what is fenced here is a term nobody was still holding" ;;
	*) cannot "the server did not say whether the witness lease has run out" ;;
	esac
	say "the witness came back from the dump holding an epoch no longer issued, and its term has still not run out"

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
