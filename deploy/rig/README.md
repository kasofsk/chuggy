# The rig's PostgreSQL

Two files and the order to apply them in. `postgres-roles.sql` creates the
identities a deployment owns and the migration cannot create for itself;
`postgres-network-policy.yaml` decides who on the cluster network may open a
connection to the server. Each argues itself in its own header, and this is the
procedure.

The migration is not here. It runs at start-up from the slice that carries the
schema, and what this procedure owes it is an identity to run as.

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

psql -h 127.0.0.1 -p 55440 -U postgres -d chuggy -f deploy/rig/postgres-roles.sql
```

It is one transaction: it lands whole or not at all, and re-running it rotates
the passwords.

## Migrate

As `chuggy_owner` and as nobody else, over the same forwarded port:

```sh
CHUG_PG_URL="postgres://chuggy_owner:$CHUG_PG_OWNER_PASSWORD@127.0.0.1:55440/chuggy"
```

## Apply the policy

```sh
kubectl apply -f deploy/rig/postgres-network-policy.yaml
```

A workload that needs the server carries `chuggy.dev/postgres-client: "true"`
and lives in namespace `chuggy`. Nothing else may connect.

## Prove it

The database half is proved by running the PostgreSQL gate — the one the
operations-inbox slice carries — with `CHUG_PG_URL` set as above. It replays
every claim the adapter makes about what the server does, including the one
that matters here: what each group role is refused. It leaves its partitions
behind in whatever database it is pointed at, which is a rehearsal's residue
and not something to point at a database anyone depends on.

The network half is not proved that way, because `kubectl port-forward` is
served from inside the server pod's own network namespace and never crosses the
boundary the policy draws. It takes pods, and it takes one pod rather than two:
the label is toggled on a pod that is already running, so the address, the
route and the credentials are all held still and the label is the only thing
that changed.

```sh
kubectl -n chuggy run probe --image=postgres:18.3-trixie --restart=Never --command -- sleep 900
kubectl -n chuggy wait --for=condition=Ready pod/probe

reach() {
  kubectl -n chuggy exec probe -- env PGPASSWORD="$CHUG_PG_DISPATCHER_PASSWORD" \
    psql "postgres://chuggy_dispatcher_login@postgres.chuggy.svc.cluster.local:5432/chuggy?connect_timeout=5" \
    -At -c "SELECT 'admitted as ' || current_user"
}

reach                                                              # refused
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true
reach                                                              # admitted
kubectl -n chuggy label pod probe chuggy.dev/postgres-client-
reach                                                              # refused

kubectl -n chuggy delete pod probe
```

Two pods rather than one is the tempting shape and it is the unreliable one:
the policy controller learns a *new* pod's labels on its own schedule, so a
freshly created pod that connects the instant it starts is refused whatever its
label says, and the run reads as a policy that admits nobody. Relabelling a pod
the controller already knows takes effect between one call and the next.

## Reversing it

```sh
kubectl -n chuggy delete networkpolicy postgres-admits-labelled-clients
kubectl -n chuggy delete secret chuggy-postgres-credentials
```

The roles are deliberately not reversed by a command here. Dropping a role that
owns relations drops nothing and fails until the relations are reassigned, and
a runbook that offered a one-line undo for that would be offering to lose the
database.
