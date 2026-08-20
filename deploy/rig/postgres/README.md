# The rig's PostgreSQL

Two files and the order to apply them in. `postgres-roles.sql` creates the
identities a deployment owns and the migration cannot create for itself;
`postgres-network-policy.yaml` decides who on the cluster network may open a
connection to the server, and where the server may open one. Each argues itself
in its own header, and this is the procedure.

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
them in a Secret beside the server. The generated values reach it on stdin
rather than through `kubectl`'s argument list, for the reason `The pod` below
gives:

```sh
kubectl -n chuggy create secret generic chuggy-postgres-credentials \
  --from-env-file=/dev/stdin <<EOF
owner-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
dispatcher-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
api-password=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
EOF
```

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
export CHUG_PG_DISPATCHER_PASSWORD="$(secret chuggy-postgres-credentials dispatcher-password)"
export CHUG_PG_API_PASSWORD="$(secret chuggy-postgres-credentials api-password)"

: "${PGPASSWORD:?the superuser password did not read back}" \
  "${CHUG_PG_OWNER_PASSWORD:?owner-password did not read back}" \
  "${CHUG_PG_DISPATCHER_PASSWORD:?dispatcher-password did not read back}" \
  "${CHUG_PG_API_PASSWORD:?api-password did not read back}" &&
psql -h 127.0.0.1 -p 55440 -U postgres -d chuggy -f deploy/rig/postgres/postgres-roles.sql
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

**No command of its own, and none to borrow yet.** The migration ships with the
operations-inbox slice named above; until that lands, this step sets the
variable the next one reads and there is nothing here to invoke.

As `chuggy_owner` and as nobody else, over the same forwarded port:

```sh
export CHUG_PG_URL="postgres://chuggy_owner:$CHUG_PG_OWNER_PASSWORD@127.0.0.1:55440/chuggy"
```

## Apply the policies

```sh
kubectl apply -f deploy/rig/postgres/postgres-network-policy.yaml
```

Two of them. A workload that needs the server carries
`chuggy.dev/postgres-client: "true"` and lives in namespace `chuggy`, no other
pod-network client may connect, and the server opens no connection to anywhere.
What still reaches it without the policy being touched is what never crosses
the pod network — a shell in its own containers, a forwarded port, the node and
anything sharing the node's network namespace — which the ingress policy's
header sets out in full and no NetworkPolicy on this CNI can change. Who can
remove the policy instead of evading it is in that header too.

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
        - name: CHUG_PG_DISPATCHER_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: dispatcher-password }
        - name: CHUG_PG_API_PASSWORD
          valueFrom:
            secretKeyRef: { name: chuggy-postgres-credentials, key: api-password }
YAML
kubectl -n chuggy wait --for=condition=Ready pod/probe

as() {
  kubectl -n chuggy exec -i probe -- sh -c '
    PGPASSWORD="$(printenv "$2")" psql \
      "postgres://$1@postgres.chuggy.svc.cluster.local:5432/chuggy?connect_timeout=5" -At -f -
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
as chuggy_dispatcher_login CHUG_PG_DISPATCHER_PASSWORD chuggy_dispatcher  # refused
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true
as chuggy_dispatcher_login CHUG_PG_DISPATCHER_PASSWORD chuggy_dispatcher  # admitted
kubectl -n chuggy label pod probe chuggy.dev/postgres-client-
as chuggy_dispatcher_login CHUG_PG_DISPATCHER_PASSWORD chuggy_dispatcher  # refused
```

### The credentials

With the label back on, each login role once, with the password this procedure
issued it:

```sh
kubectl -n chuggy label pod probe chuggy.dev/postgres-client=true

as chuggy_owner CHUG_PG_OWNER_PASSWORD chuggy_dispatcher
as chuggy_dispatcher_login CHUG_PG_DISPATCHER_PASSWORD chuggy_dispatcher
as chuggy_api_login CHUG_PG_API_PASSWORD chuggy_api
```

Each names the role it authenticated as and a client address that is the
probe's rather than `127.0.0.1`, which is what makes it a password check rather
than a trust match; nothing else in this procedure is one, because the gate
below reaches the group roles with `SET LOCAL ROLE` on a connection it already
holds and never authenticates as a login role at all. And each ends in `true`
for a group the role holds only through the grant `postgres-roles.sql` made:
revoke that grant and the same call prints `false` with every other field
unchanged. Without these three calls the passwords, the LOGIN attribute and the
membership are exercised by nothing.

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

**Not runnable from a checkout of main** — the gate ships with the
operations-inbox slice. With `CHUG_PG_URL` set as above it replays every claim
the adapter makes about what the server does, including the one that matters
here: what each group role is refused. It leaves its partitions behind in
whatever database it is pointed at, which is a rehearsal's residue and not
something to point at a database anyone depends on.

### Done with them

The probe carries the Secret, so it does not outlive the proofs; the forwarded
port is this host's rather than the cluster's, so nothing below reverses it.

```sh
kubectl -n chuggy delete pod probe
kill "$forward"
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
only copy of a password three roles still have — recoverable only by re-running
`Issue the credentials` and `Create the roles`, which issues different ones.
