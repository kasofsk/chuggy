# The rig's git service and Flux loop

The git service and Flux loop for the local k3s rig: bare repositories served
over smart HTTP by their own single-replica service, and Flux reconciling the
cluster from a branch of one of them. A push to the default branch is the
deploy.

`bootstrap/` is applied by hand, out of band, because it is what carries the
loop and cannot be carried by it. `repo/deploy/` is a picture of the served
repository's `deploy/` directory — what `seed.sh` pushes onto its default
branch, and the one path the `Kustomization` reconciles.

## Stand it up

`bootstrap/` includes a `GitRepository` and a `Kustomization`, which are Flux
kinds. Flux's controllers must already be in the cluster and serving the API
versions `bootstrap/` names, or the apply errors on two unknown kinds, `seed.sh`
still succeeds, and the loop is silently absent. The check asks for the
versions, because a Flux old enough to carry the kinds but not those versions
fails the same way:

```sh
flux install
kubectl explain gitrepository --api-version=source.toolkit.fluxcd.io/v1
kubectl explain kustomization --api-version=kustomize.toolkit.fluxcd.io/v1
```

Then:

```sh
kubectl apply -k deploy/rig/git/bootstrap
./deploy/rig/git/seed.sh
```

The git pod stays unready until `seed.sh` creates the credential secret it
mounts. `seed.sh` mints the credentials, creates the bare repository inside the
pod — `git-http-backend` serves repositories and does not create them —
installs `pre-receive.sh` on every repository the pod carries, and pushes
`deploy/rig/git/repo/deploy/` onto `main`. It is safe to re-run: the
credentials are read back rather than rotated, and the push is skipped when the
served tree already matches.

## The credential classes

Static, validated by nginx against htpasswd files with no other party standing.
The sync reader may read; only the operator may move any branch. A push is any
request `git-http-backend` would dispatch as one — a URL ending in
`/git-receive-pack` — and nginx puts the writers file on exactly that location.
The reader validates against writers there and against readers on every other
path that reaches the backend; no query string enters the choice.

nginx decides who may push at all and cannot see a ref. What an admitted
credential may then do is `pre-receive.sh`'s, and it decides per repository:
`seed.sh` installs that one file on every repository under the served root, so
a repository pushed into the pod by hand is governed by the next seed rather
than by nothing.

| Secret | Who | May |
|---|---|---|
| `git-sync` | the sync reader, referenced by the `GitRepository` | read |
| `git-operator` | the operator's break-glass | read and push |
| `git-worker` | development workers | read and create-only under `chuggy/tickets/<ticket>/attempts/<attempt>` |
| `git-mirror` | the mirror sync | read, and move or rewrite `main` on every repository but `rig.git` |
| `git-credentials` | what nginx validates against | — |

`rig.git` is the mirror's exception because it mirrors nothing: it is what Flux
reconciles the cluster from, and a push to its default branch is the deploy.

Read a token back with:

```sh
kubectl -n chuggy-git get secret git-operator -o jsonpath='{.data.password}' | base64 -d
```

Per-job tokens are the ticket service's to mint at spawn, and the ticket service does
not exist yet. Neither does the backup bundle on default-branch movement.

`seed.sh` proves the wall on every run: `audit-credentials.sh` stands up a
throwaway repository and shows the read credential refused a push at the write
endpoint and at every nested and query-string disguise of one, and the mirror
credential accepted at that repository's `main`, refused at every other ref on
it, and refused at `rig.git`'s. Run it alone with
`./deploy/rig/git/audit-credentials.sh`.

## Give a namespace a copy

A workload in another namespace holds its own copy of a token, named
`chuggy-git-<user>` with a `password` key: that is what the scheduler mounts
for the worker, and what the mirror's CronJob projects. Make one from this
namespace's Secret with the token in a file rather than on a command line,
where it would be readable in `/proc` for that command's life — and with the
read checked before anything is created, because `base64 -d` exits 0 on the
empty stdin a failed `kubectl get` leaves, and a Secret holding an empty
password fails later as an authentication error rather than as the typo it
was:

```sh
token="$(mktemp)"   # private to you, removed at the end
kubectl -n chuggy-git get secret git-mirror -o jsonpath='{.data.password}' \
  | base64 -d > "$token"
if [ -s "$token" ]; then
  kubectl -n chuggy-work create secret generic chuggy-git-mirror \
    --from-file=password="$token"
else
  echo "no password read from git-mirror; nothing was created" >&2
fi
rm -f "$token"
```

## Deploy something

Edit `deploy/rig/git/repo/deploy/`, then re-run `./deploy/rig/git/seed.sh`. Flux polls
the repository and applies what it finds; to stop waiting for the poll:

```sh
kubectl -n chuggy-git annotate --overwrite gitrepository/rig \
  reconcile.fluxcd.io/requestedAt="$(date +%s)"
```

Watch it land:

```sh
kubectl get gitrepository,kustomization -n chuggy-git
```

The `Kustomization` reports the commit it last applied, and that commit is the
one `seed.sh` pushed.

## Reaching the service

The sync reader uses the in-cluster Service, so the read never traverses the
ingress. The operator push goes through the Traefik ingress at
`git.192.168.0.114.nip.io`, which resolves to the rig's node without a hosts
entry. When that name cannot be resolved, forward the Service instead:

```sh
kubectl -n chuggy-git port-forward service/git 8080:80
```

## What is worth knowing before changing it

- The nginx configuration is mounted by `subPath`, so a change to the
  `git-http` ConfigMap does not reach the running pod. Follow it with
  `kubectl -n chuggy-git rollout restart deployment/git`.
- The claim is `ReadWriteOnce` and the repositories are the record, so the
  Deployment's strategy is `Recreate`. Raising `replicas` would corrupt them.
- The image is a public one, pinned by digest. It is `nginx` plus `fcgiwrap`
  plus `git`, and this deployment replaces its entire nginx configuration; what
  is consumed from it is the binaries. Owning the image instead would need a
  registry the rig does not have, and is deferred.

## What this does not prove

- **No TLS.** There is no cert-manager on the rig, so the operator's token
  crosses the network in the clear. The ingress is plain HTTP.
- **The container runs as root**, and so does `git-http-backend` behind it.
- **One node, one replica, one directory-backed volume.** Nothing here says
  anything about surviving the loss of a machine.
- **The reconciled object is a marker.** A ConfigMap changing is evidence that
  the loop closes, not that any workload deploys.
- **Only repository paths are guarded.** Anything else falls through to nginx's
  built-in document root, so `GET /` is answered unauthenticated with whatever
  the image ships there. Nothing under `/git` is reachable that way — it is
  served only through the two locations above — but the surface is not nothing.
- **Nothing bounds the namespace.** `deploy/rig/git/bootstrap/namespace.yaml`
  carries no Pod Security labels and nothing here draws a NetworkPolicy, so the
  basic-auth wall is the whole of the control in either direction: every pod on
  the cluster network reaches that wall, and the git pod — root, above — reaches
  every destination the node does. Nothing refuses a privileged or host-network
  pod scheduled into the namespace, either. The rig's `chuggy-work` namespace
  draws both; this one draws neither.

## Undoing it

Everything this row created lives in one namespace, and the `Kustomization`
prunes what it applied when it is removed:

```sh
kubectl delete namespace chuggy-git
```

Nothing outside that namespace was created or altered — not the Flux
controllers, not `flux-system`, not `chuggy`, not the node, and nothing on the
host.
