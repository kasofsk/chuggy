# The rig's PostgreSQL

Two files and the order to apply them in. `postgres-roles.sql` creates the
identities a deployment owns and the migration cannot create for itself;
`postgres-network-policy.yaml` decides who on the cluster network may open a
connection to the server, and where the server may open one. Each argues itself
in its own header, and this is the procedure.

The migration is a command now: `npm run migrate` applies the schema this
checkout declares to the database `CHUG_MIGRATE_DATABASE_URL` names, and what
this procedure owes it is an identity to run as.

**A DATABASE WITH ANY OF 5, 12 AND 13 STILL PENDING CANNOT BE MIGRATED BY THAT
IDENTITY.** Each of those restates `NOSUPERUSER`, `NOREPLICATION` and
`NOBYPASSRLS` on a role, which `ALTER ROLE` refuses to a `CREATEROLE` role
however it holds that role, so the chain stops at the first of them still to
apply — see kasofsk/chuggy#241 for the two refusals and what has to be decided.
A database already carrying all three advances normally, and that is what the
Migrate step below is written for.

## Before you start

A server, and a database in it for chuggy to own. On the rig that is the
`postgres` StatefulSet in namespace `chuggy` and the `chuggy_rehearsal`
database inside it — the one `chuggy-api`'s `CHUG_API_DATABASE_URL` names, and
the one every step below names. The rig's `chuggy` database stopped at
migration 2 and is not it: pointing this procedure there runs the chain from 3
and stops on the refusal above.

You will need the superuser's password, and one password for each login role
`postgres-roles.sql` issues.

## Issue the credentials

Where a deployment keeps these is the secret source's question. The rig keeps
them in a Secret beside the server. The generated values reach it on stdin
rather than through `kubectl`'s argument list, for the reason `The pod` below
gives:

```sh
kubectl -n chuggy create secret generic chuggy-postgres-credentials \
  --from-env-file=/dev/stdin <<EOF
owner-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
ticket-service-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
api-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
selector-service-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
scheduler-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
finalizer-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
worker-plane-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
EOF
```

One per control-plane process, because every serving command under `src/roots/`
asserts at start-up that `current_user` is its own group role and refuses to
serve otherwise. A shared credential does not widen one process's reach; it
stops every process the credential does not belong to from starting. The
administrative commands — the migration and `provision:project-access` — are
outside that rule, and `postgres-roles.sql`'s header says what each asserts
instead.

## Create the roles

Through a forwarded port rather than `kubectl exec`, so that the passwords stay
in this host's environment instead of appearing in the server pod's argument
list, where anyone with a shell in that pod can read them. That shell is an
unauthenticated superuser on the server whatever this step does — this image's
`pg_hba.conf` matches the Unix socket with `local all all trust`, ahead of its
`scram-sha-256` catch-all — so what the choice keeps out of reach is the
passwords, not the server.

```sh
kubectl -n chuggy port-forward svc/postgres 55440:5432 & forward=$!

secret() { kubectl -n chuggy get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }
export PGPASSWORD="$(secret postgres-superuser password)"
export CHUG_PG_OWNER_PASSWORD="$(secret chuggy-postgres-credentials owner-password)"
export CHUG_PG_TICKET_SERVICE_PASSWORD="$(secret chuggy-postgres-credentials ticket-service-password)"
export CHUG_PG_API_PASSWORD="$(secret chuggy-postgres-credentials api-password)"
export CHUG_PG_SELECTOR_SERVICE_PASSWORD="$(secret chuggy-postgres-credentials selector-service-password)"
export CHUG_PG_SCHEDULER_PASSWORD="$(secret chuggy-postgres-credentials scheduler-password)"
export CHUG_PG_FINALIZER_PASSWORD="$(secret chuggy-postgres-credentials finalizer-password)"
export CHUG_PG_WORKER_PLANE_PASSWORD="$(secret chuggy-postgres-credentials worker-plane-password)"

: "${PGPASSWORD:?the superuser password did not read back}" \
  "${CHUG_PG_OWNER_PASSWORD:?owner-password did not read back}" \
  "${CHUG_PG_TICKET_SERVICE_PASSWORD:?ticket-service-password did not read back}" \
  "${CHUG_PG_API_PASSWORD:?api-password did not read back}" \
  "${CHUG_PG_SELECTOR_SERVICE_PASSWORD:?selector-service-password did not read back}" \
  "${CHUG_PG_SCHEDULER_PASSWORD:?scheduler-password did not read back}" \
  "${CHUG_PG_FINALIZER_PASSWORD:?finalizer-password did not read back}" \
  "${CHUG_PG_WORKER_PLANE_PASSWORD:?worker-plane-password did not read back}" &&
psql -h 127.0.0.1 -p 55440 -U postgres -d chuggy_rehearsal -f deploy/rig/postgres/postgres-roles.sql
```

It is one transaction: it lands whole or not at all, and re-running it rotates
the passwords.

A lookup that fails reaches psql as an empty password rather than as a failure:
a pipeline's status is its last command's, `base64 -d` exits 0 on the empty
stdin a failed `kubectl get` leaves, and `export` discards a command
substitution's status besides. `postgres-roles.sql` clears a role's password
when handed an empty one, so that transaction lands whole as well, over roles
that can then authenticate with nothing — and the step after it still connects,
because it reaches the server over this forwarded port, which `Prove it` shows
is trust-matched. So the emptiness is the failure, and the `:?` expansions
refuse it while psql is still unreached and the operator can still see which
lookup came back empty.

## Migrate

**MIGRATE AND ROLL OUT IN ONE WINDOW.** An image's contract sets `required` and
`compatible` both to the migrations its own source declares, and
`schemaContractAccepts` refuses an applied list longer than `compatible` — so a
database *ahead* of an image refuses it exactly as one behind it does. The
moment this step lands a version the serving image does not declare, that
image's `schema-compatible` precondition fails; on the rig `chuggy-api` re-runs
it on every readiness probe and leaves service until an image declaring that
version is Ready. A control-plane process already running is unaffected,
because its readiness is derived from state it holds, but it would refuse to
start again. So the images that declare the new version go out with this step
and not after it. kasofsk/chuggy#240 is where that contract shape is being
decided.

As `chuggy_owner` and as nobody else, over the same forwarded port:

```sh
owner_url="postgres://chuggy_owner:$CHUG_PG_OWNER_PASSWORD@127.0.0.1:55440/chuggy_rehearsal"
CHUG_MIGRATE_DATABASE_URL="$owner_url" npm run migrate
```

It prints the versions it applied, or says the schema was already current, and
running it twice is how you see the difference.

Migration 25 refuses a journal whose migration ledger already exists, because
silently assigning that history a new installation identity would change the
authority its local ticket identifiers belong to. To adopt such a journal,
the operator names its permanent canonical UUID for that one migration run:

```sh
installation_id="$(node -e "process.stdout.write(crypto.randomUUID())")"
CHUG_MIGRATE_ADOPT_INSTALLATION_ID="$installation_id" \
  CHUG_MIGRATE_DATABASE_URL="$owner_url" npm run migrate
```

Record that value with the installation's backup inventory. The command
refuses it for a fresh journal and after migration 25 has already landed, so a
persisted adoption setting cannot silently reassign an authority.

A ledger this checkout does not declare — a version it has never heard of, or
one under another name — is a **could-not-run** that applies nothing and exits
2. That is the case the command exists to refuse: the runner underneath it
subtracts the applied set and applies the difference, so against a database
ahead of this checkout it would fill the gaps it recognised and report the
success of a schema nobody has.

## Grant a project access

`src/roots/provisionProjectAccess.ts` is the only way a `project_membership`
row is written, and it runs as `chuggy_owner` because that role owns the table.
`chuggy_api` is refused every privilege on it, so the API process cannot widen
its own authorization and this command cannot be run with its credential.

Supply the issuer and the subject the token carries; the command derives the
stored principal with the same function the API derives it from, so neither
side has an encoding to get wrong.

```sh
export CHUG_PROVISION_DATABASE_URL="$owner_url"
export CHUG_API_OIDC_ISSUER="https://accounts.example.test"
export CHUG_PROVISION_SUBJECT="the sub claim the provider issues"
export CHUG_PROVISION_TENANT="tenant" CHUG_PROVISION_PROJECT="project"
export CHUG_PROVISION_AUTHORITY_KIND="OidcUser"
export CHUG_PROVISION_AUTHORITY_SUBJECT="the internal subject submissions are audited to"
export CHUG_PROVISION_ACCESS="Read,Mutate"
CHUG_PROVISION_ACTION=grant npm run provision:project-access
```

`CHUG_PROVISION_ACCESS` names the kinds `authorize_project_access` knows —
`Read`, `Mutate`, `DispatchTicket`, `ProposeDispatch` — and a grant naming none
is refused before the row is. Re-running a grant is not an error: it replaces
whatever that principal held on that project, so narrowing access is the same
command with a shorter list.

The project has to exist first, and **no command in this tree creates one**.
The command says so rather than reporting a foreign-key violation.

### Reversing it

```sh
CHUG_PROVISION_ACTION=revoke npm run provision:project-access
```

Every access, taken back in one statement. A revocation reads only the issuer,
subject, tenant and project, and says whether there was a membership to
withdraw.

## Apply the policies

```sh
kubectl apply -f deploy/rig/postgres/postgres-network-policy.yaml
```

Two of them. A workload that needs the server carries
`chuggy.dev/postgres-client: "true"` and lives in namespace `chuggy`, no other
pod-network client may connect, and the server opens no connection to anywhere.
What still reaches it without the ingress policy being touched is what that
policy never gets to decide — a shell in its own containers, a forwarded port,
the node and anything sharing the node's network namespace — which its header
sets out in full and no NetworkPolicy on this CNI can change. Who can remove
the policy outright is in that header too.

## Prove it

### What the forwarded port is not evidence of

Every step above that reached the database ran through `kubectl port-forward` —
issuing the credentials never touched it — and two things follow from where the
kubelet serves it, inside the server pod's own network namespace.

It never crosses the boundary the ingress policy draws, so it witnesses nothing
about that policy. And PostgreSQL sees the connection arrive from `127.0.0.1`,
which this image's `pg_hba.conf` matches with `host all all 127.0.0.1/32 trust`
*ahead* of its `scram-sha-256` catch-all — so over that port every role is
admitted with any password, or none. Running the role script there is fine, and
the statements land; what it cannot do is tell you a password this procedure
issued is the password the role has.

So the two halves below that authenticate run from a pod instead, over the
cluster network, where the catch-all is the line that matches.

### The pod

One pod for both of them, and one rather than two: the policy controller learns
a *new* pod's labels on its own schedule, so a freshly created pod connecting
the instant it starts is refused whatever its label says, and the run reads as
a policy that admits nobody. Relabelling a pod the controller already knows
takes effect between one call and the next — and it holds the address, the
route and the credentials still, so the label is the only thing that changed.

```sh
kubectl -n chuggy apply -f - <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: probe
  namespace: chuggy
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: postgres:18.3-trixie
      command: [sleep, "900"]
      env:
        - name: CHUG_PG_OWNER_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: owner-password }
        - name: CHUG_PG_TICKET_SERVICE_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: ticket-service-password }
        - name: CHUG_PG_API_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: api-password }
        - name: CHUG_PG_SELECTOR_SERVICE_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: selector-service-password }
        - name: CHUG_PG_SCHEDULER_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: scheduler-password }
        - name: CHUG_PG_FINALIZER_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: finalizer-password }
        - name: CHUG_PG_WORKER_PLANE_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: worker-plane-password }
YAML
kubectl -n chuggy wait --for=condition=Ready pod/probe

as() {
  kubectl -n chuggy exec -i probe -- sh -c '
    PGPASSWORD="$(printenv "$2")" psql \
      "postgres://$1@postgres.chuggy.svc.cluster.local:5432/chuggy_rehearsal?connect_timeout=5" -At -f -
  ' _ "$1" "$2" <<SQL
SELECT 'admitted as ' || current_user
    || ' from ' || inet_client_addr()
    || ', in $3: ' || pg_has_role(current_user, '$3', 'USAGE')
SQL
}
```

The pod reads the Secret and the second argument names the variable to read
rather than carrying its value, because `postgres-roles.sql`'s rule about
argument lists is this host's rule too: an argument to `kubectl` is in this
host's process table for anyone to read, and in the exec request's query string
besides. The Secret's own key names are hyphenated and `sh` will not import
those, so the pod renames them one by one instead of taking them `envFrom`.

The third argument is the group the call asserts membership in, and it is there
because the rest of the line does not need one: `current_user` and
`inet_client_addr()` are executable by PUBLIC, and `CONNECT` is held directly,
so a call without `pg_has_role` prints the same text with every membership
revoked.

### The network half

```sh
as chuggy_ticket_service_login CHUG_PG_TICKET_SERVICE_PASSWORD chuggy_ticket_service  # refused
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true
as chuggy_ticket_service_login CHUG_PG_TICKET_SERVICE_PASSWORD chuggy_ticket_service  # admitted
kubectl -n chuggy label pod probe chuggy.dev/postgres-client-
as chuggy_ticket_service_login CHUG_PG_TICKET_SERVICE_PASSWORD chuggy_ticket_service  # refused
```

### The grant that removes the policy

The ingress policy's header ends on a bypass that is another repo's to change,
so it is the one claim in these two files that can go stale without this tree
moving. `auth can-i` asks the API server and applies nothing:

```sh
kubectl -n chuggy auth can-i delete networkpolicies \
  --as=system:serviceaccount:chuggy:dev2
kubectl -n chuggy auth can-i get secrets \
  --as=system:serviceaccount:chuggy:dev2
```

```
yes
yes
```

The first says an identity the rig declares can delete
`postgres-admits-labelled-clients`, after which nothing selects the server for
ingress and every pod-network client is admitted — `postgres-denies-egress`
names Egress alone, so it does not isolate the pod in this direction. The second
says the same identity reads both Secrets beside the server. A `no` on either
means chuggy-fabric moved the binding, and the header is what to re-read.

### The credentials

With the label back on, every login role with the password this procedure
issued it, and the API's twice because its second pool becomes a second group:

```sh
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true

as chuggy_owner CHUG_PG_OWNER_PASSWORD chuggy_boundary_owner
as chuggy_ticket_service_login CHUG_PG_TICKET_SERVICE_PASSWORD chuggy_ticket_service
as chuggy_api_login CHUG_PG_API_PASSWORD chuggy_api
as chuggy_api_login CHUG_PG_API_PASSWORD chuggy_selector_review
as chuggy_selector_service_login CHUG_PG_SELECTOR_SERVICE_PASSWORD chuggy_selector_service
as chuggy_scheduler_login CHUG_PG_SCHEDULER_PASSWORD chuggy_scheduler
as chuggy_finalizer_login CHUG_PG_FINALIZER_PASSWORD chuggy_finalizer
as chuggy_worker_plane_login CHUG_PG_WORKER_PLANE_PASSWORD chuggy_worker_plane
```

The owner's line asks about `chuggy_boundary_owner` rather than a service
group, because that is the membership a `GRANT` on a `SECURITY DEFINER`
function needs and the one whose absence a migration reports as applied.

Each names the role it authenticated as and a client address that is the
probe's rather than `127.0.0.1`, which is what makes it a password check rather
than a trust match; nothing else in this procedure is one, because the gates
below connect as the superuser and reach the group roles with `SET LOCAL ROLE`
on that connection, never authenticating as a login role at all. And each ends
in `true` for a group the role holds only through the grant
`postgres-roles.sql` made: revoke that grant and the same call prints `false`
with every other field unchanged. Without these calls the passwords, the LOGIN
attribute and the membership are exercised by nothing.

### The egress half

The second policy is proved on a pod that never restarts either — the server
itself. `Apply the policies` put it in force, so the state change starts by
taking it off again:

```sh
kubectl -n chuggy delete networkpolicy postgres-denies-egress
```

The verdict and the timing come from a TCP connect, and a connect that runs out
its own clock is reported as its own verdict rather than folded into either of
the other two:

```sh
kubectl -n chuggy exec postgres-0 -- bash -c '
  for t in 10.43.0.1:443 10.43.0.10:53 1.1.1.1:443 169.254.169.254:80; do
    h="${t%%:*}"; p="${t##*:}"; s="$(date +%s)"
    r="$(timeout 3 bash -c "exec 3<>/dev/tcp/$h/$p" 2>&1)" && rc=0 || rc=$?
    e="$(date +%s)"
    case "$rc" in 0) v=open;; 124) v=TIMEOUT;; *) v=REFUSED;; esac
    printf "tcp  %-20s %-8s %ss  %s\n" "$t" "$v" "$((e - s))" "${r##*: }"
  done
  s="$(date +%s)"
  d="$(timeout 3 getent hosts kubernetes.default.svc.cluster.local 2>&1)" || d="no answer"
  e="$(date +%s)"
  printf "dns  %-20s %-8s %ss  %s\n" kubernetes.default - "$((e - s))" "$d"'
```

Without the policy, the database reaches the API server, the cluster's DNS and
the open internet:

```
tcp  10.43.0.1:443        open     0s
tcp  10.43.0.10:53        open     0s
tcp  1.1.1.1:443          open     0s
tcp  169.254.169.254:80   TIMEOUT  3s
dns  kubernetes.default   -        0s  10.43.0.1       kubernetes.default.svc.cluster.local
```

Run the credentials block here too, then put the policy back — same pod, no
restart between them:

```sh
kubectl apply -f deploy/rig/postgres/postgres-network-policy.yaml
```

```
tcp  10.43.0.1:443        REFUSED  1s  Connection refused
tcp  10.43.0.10:53        REFUSED  1s  Connection refused
tcp  1.1.1.1:443          REFUSED  1s  Connection refused
tcp  169.254.169.254:80   REFUSED  1s  Connection refused
dns  kubernetes.default   -        3s  no answer
```

Nothing began or stopped listening at any of those addresses; the policy is
what changed. The metadata address is the one not to over-read — **this rig has
no metadata service**, so nothing answers there in either state. Its two lines
show the rule is destination-blind, not that a metadata service would have been
refused.

Then rerun the credentials block: every call is admitted, exactly as it was in
the window above with this policy absent. A connection the ingress policy
admits is answered whichever way this one stands, because the pod's chain
accepts an established flow before it consults either.

### The database half

Two gates read `CHUG_PG_URL`, and neither can be given the control plane's own
identity. `.chug/tasks/check-queries.sh` migrates the database it names and
leaves the schema behind; `.chug/tasks/check-postgres.sh` migrates a template
database beside it and clones one per worker, which is why its header requires
the role to be able to create and drop sibling databases. `chuggy_owner` can do
neither: it is `NOCREATEDB`, and the rig's `chuggy` — the other database this
file names — is at migration 2, which the top of this file says that identity
cannot advance. So the gates get the superuser and a database made for the run,
which is nobody's control plane:

```sh
psql -h 127.0.0.1 -p 55440 -U postgres -d postgres -c 'CREATE DATABASE chuggy_gate'
export CHUG_PG_URL="postgres://postgres:$(node -p 'encodeURIComponent(process.env.PGPASSWORD)')@127.0.0.1:55440/chuggy_gate"
.chug/tasks/check-queries.sh
.chug/tasks/check-postgres.sh
```

This is the one URL in this file whose password nothing here generated: every
other one interpolates a value `Issue the credentials` made and stripped `=+/`
from, and the superuser's comes from a Secret this procedure only reads. A `@`,
a `/`, a `:` or a `#` in it would silently make that line a different URL, so it
is percent-encoded rather than interpolated — with `node`, which
`.chug/tasks/_postgres.sh` requires of the two gates on the next lines anyway.

Between them they ask the server whether every tagged query and row type is
true, and replay every claim the adapter makes about what the server does —
including the one that matters here: what each group role is refused. What they
leave behind is a migrated schema and its partitions, which is why the database
is one made for the run and dropped with the rest.

### Done with them

The probe carries the Secret, so it does not outlive the proofs, and the gates'
database is a rehearsal's residue; the forwarded port is this host's rather than
the cluster's, so nothing below reverses it.

`chuggy_gate` is not the only database a run can leave in this cluster.
`check-postgres.sh` migrates `chuggy_template_<pid>` beside it and clones a
`chuggy_worker_<pid>_<n>` per worker, and drops both on the way out — its trap
covers an interrupt, so what survives is a signal the trap cannot catch, and
that same signal leaves a connection an unforced drop refuses over. So the drop
is forced, and it drops what the run left rather than the one name this file
chose:

```sh
psql -h 127.0.0.1 -p 55440 -U postgres -d postgres <<'SQL'
SELECT format('DROP DATABASE %I WITH (FORCE)', datname)
  FROM pg_database
 WHERE datname = 'chuggy_gate'
    OR datname LIKE 'chuggy\_template\_%'
    OR datname LIKE 'chuggy\_worker\_%'
\gexec
SQL
kubectl -n chuggy delete pod probe
kill "$forward"
```

`chuggy` and `chuggy_rehearsal` match none of those three, which is what keeps
this from being a command that drops the deployment.

## The workers' server

**A second server, not this one.** Work runs agent-authored code and needs a
database to run this tree's own gates against; the server above holds the rows
that decide whether that work is accepted. `worker-database-roles.sql` argues
why those cannot be one server, and it is the only file here that belongs to
the other one. The StatefulSet and Service are chuggy-fabric's, like every other
manifest; what this repository owns is the identity workers reach it as and what
an attempt does with that identity.

Issue its credential and create the role the same way as above, against the
workers' server rather than this one:

```sh
kubectl -n chuggy create secret generic chuggy-worker-database \
  --from-env-file=/dev/stdin <<EOF
password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
EOF

CHUG_PG_WORKER_PASSWORD=... \
  psql -h 127.0.0.1 -p <the forwarded port> -U postgres \
    -f deploy/rig/postgres/worker-database-roles.sql
```

**The scheduler names a Secret and never a URL.** `CHUG_SCHEDULER_WORKER_DATABASE`
carries `{"secretName": ..., "key": ...}`, and the key holds a whole connection
URL for `chuggy_worker`. Every worker pod then gets that key as a `secretKeyRef`
and the name of the one database it may make as a plain value, so the URL is
read by the kubelet and passes through neither the scheduler nor the pod spec it
submits. A site that names no such Secret places workers that are told of no
server, and work that then needs one fails in the container.

**The URL must be reachable without resolving a name.** A worker namespace
denies what it is not given, and the rehearsal in `deploy/rig/isolation/` denies
DNS along with the rest — deliberately, and `work-denies-all.yaml` says why. So
the destination is added there as an egress rule naming this server, and the URL
in the Secret names an address rather than a name unless that namespace also
admits a resolver.

**What an attempt leaves behind.** `images/worker/postgres.mjs` makes a role
named for the attempt, gives it one database, and drops every database that role
owns when the attempt ends. A pod killed before that runs leaves them, and they
are attributable: every name carries the attempt's own, which is also what keeps
two attempts running `.chug/tasks/check-postgres.sh` at once from colliding.
A sweep is by owner:

```sh
psql -c "SELECT rolname FROM pg_roles WHERE rolname LIKE 'chug\_%'"
```

## Reversing it

```sh
kubectl -n chuggy delete networkpolicy postgres-admits-labelled-clients postgres-denies-egress
kubectl -n chuggy delete secret chuggy-postgres-credentials
```

The roles are deliberately not reversed by a command here. Dropping a role that
owns relations drops nothing and fails until the relations are reassigned, and
a runbook that offered a one-line undo for that would be offering to lose the
database. So the Secret goes and the roles stay, and deleting it discards the
only copy of every password the login roles still have — recoverable only by
re-running `Issue the credentials` and `Create the roles`, which issues
different ones.
