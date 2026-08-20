# The rig's PostgreSQL

Two files and the order to apply them in. `postgres-roles.sql` creates the
identities a deployment owns and the migration cannot create for itself;
`postgres-network-policy.yaml` decides who on the cluster network may open a
connection to the server. Each argues itself in its own header, and this is the
procedure.

The migration is not here. It runs at start-up from the slice that carries the
schema, and what this procedure owes it is an identity to run as. That slice is
not on main: it is the operations-inbox work, on branch dc/i1-operations-inbox.
So from a checkout of main the Migrate step has no command to issue and the
database half of Prove it has no gate to run, and each says so where it stands.

## Before you start

A server, and a database in it for chuggy to own. On the rig that is the
`postgres` StatefulSet in namespace `chuggy` and the `chuggy` database inside
it. You will need the superuser's password and three passwords to issue.

## Issue the credentials

Where a deployment keeps these is the secret source's question. The rig keeps
them in a Secret beside the server:

```sh
kubectl -n chuggy create secret generic chuggy-postgres-credentials \
  --from-literal=owner-password="$(head -c 32 /dev/urandom | base64 | tr -d '=+/')" \
  --from-literal=dispatcher-password="$(head -c 32 /dev/urandom | base64 | tr -d '=+/')" \
  --from-literal=api-password="$(head -c 32 /dev/urandom | base64 | tr -d '=+/')"
```

## Create the roles

Through a forwarded port rather than `kubectl exec`, so that the passwords stay
in this host's environment instead of appearing in the server pod's argument
list, where anyone with a shell in that pod can read them.

```sh
kubectl -n chuggy port-forward svc/postgres 55440:5432 &

secret() { kubectl -n chuggy get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }
export PGPASSWORD="$(secret postgres-superuser password)"
export CHUG_PG_OWNER_PASSWORD="$(secret chuggy-postgres-credentials owner-password)"
export CHUG_PG_DISPATCHER_PASSWORD="$(secret chuggy-postgres-credentials dispatcher-password)"
export CHUG_PG_API_PASSWORD="$(secret chuggy-postgres-credentials api-password)"

psql -h 127.0.0.1 -p 55440 -U postgres -d chuggy -f deploy/rig/postgres/postgres-roles.sql
```

It is one transaction: it lands whole or not at all, and re-running it rotates
the passwords.

## Migrate

**No command of its own, and none to borrow yet.** The migration ships with the
operations-inbox slice named above; until that lands, this step sets the
variable the next one reads and there is nothing here to invoke.

As `chuggy_owner` and as nobody else, over the same forwarded port:

```sh
CHUG_PG_URL="postgres://chuggy_owner:$CHUG_PG_OWNER_PASSWORD@127.0.0.1:55440/chuggy"
```

## Apply the policy

```sh
kubectl apply -f deploy/rig/postgres/postgres-network-policy.yaml
```

A workload that needs the server carries `chuggy.dev/postgres-client: "true"`
and lives in namespace `chuggy`. No other pod-network client may connect, and
that is the whole of what the policy decides: the node and anything sharing its
network namespace reach the server regardless, which the policy's own header
sets out and no NetworkPolicy on this CNI can change.

## Prove it

### What the forwarded port is not evidence of

Every step above ran through `kubectl port-forward`, and two things follow from
where the kubelet serves it — inside the server pod's own network namespace.

It never crosses the boundary the policy draws, so it witnesses nothing about
the policy. And PostgreSQL sees the connection arrive from `127.0.0.1`, which
this image's `pg_hba.conf` matches with `host all all 127.0.0.1/32 trust`
*ahead* of its `scram-sha-256` catch-all — so over that port every role is
admitted with any password, or none. Running the role script there is fine, and
the statements land; what it cannot do is tell you a password this procedure
issued is the password the role has.

So both halves below run from a pod instead, over the cluster network, where
the catch-all is the line that matches.

### The pod

One pod, used for both, and one rather than two: the policy controller learns a
*new* pod's labels on its own schedule, so a freshly created pod that connects
the instant it starts is refused whatever its label says, and the run reads as
a policy that admits nobody. Relabelling a pod the controller already knows
takes effect between one call and the next — and it holds the address, the
route and the credentials still, so the label is the only thing that changed.

```sh
kubectl -n chuggy run probe --image=postgres:18.3-trixie --restart=Never --command -- sleep 900
kubectl -n chuggy wait --for=condition=Ready pod/probe

as() {
  kubectl -n chuggy exec probe -- env PGPASSWORD="$2" \
    psql "postgres://$1@postgres.chuggy.svc.cluster.local:5432/chuggy?connect_timeout=5" \
    -At -c "SELECT 'admitted as ' || current_user || ' from ' || inet_client_addr()"
}
```

### The network half

```sh
as chuggy_dispatcher_login "$CHUG_PG_DISPATCHER_PASSWORD"          # refused
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true
as chuggy_dispatcher_login "$CHUG_PG_DISPATCHER_PASSWORD"          # admitted
kubectl -n chuggy label pod probe chuggy.dev/postgres-client-
as chuggy_dispatcher_login "$CHUG_PG_DISPATCHER_PASSWORD"          # refused
```

### The credentials

With the label back on, each login role once, with the password this procedure
issued it:

```sh
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true

as chuggy_owner "$CHUG_PG_OWNER_PASSWORD"
as chuggy_dispatcher_login "$CHUG_PG_DISPATCHER_PASSWORD"
as chuggy_api_login "$CHUG_PG_API_PASSWORD"

kubectl -n chuggy delete pod probe
```

Each names the role it authenticated as and a client address that is the
probe's rather than `127.0.0.1`, which is what makes it a password check rather
than a trust match. Nothing else in this procedure is: the gate below reaches
the group roles with `SET LOCAL ROLE` on a connection it already holds, so it
never authenticates as a login role at all. Without these three calls the
passwords, the LOGIN attribute and the membership are exercised by nothing.

### The database half

**Not runnable from a checkout of main** — the gate ships with the
operations-inbox slice. With `CHUG_PG_URL` set as above it replays every claim
the adapter makes about what the server does, including the one that matters
here: what each group role is refused. It leaves its partitions behind in
whatever database it is pointed at, which is a rehearsal's residue and not
something to point at a database anyone depends on.

## Reversing it

```sh
kubectl -n chuggy delete networkpolicy postgres-admits-labelled-clients
kubectl -n chuggy delete secret chuggy-postgres-credentials
```

The roles are deliberately not reversed by a command here. Dropping a role that
owns relations drops nothing and fails until the relations are reassigned, and
a runbook that offered a one-line undo for that would be offering to lose the
database.
