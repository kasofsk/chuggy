# The rig's container images

Two images and the one way they reach the rig. `images/api/Dockerfile` is the
native HTTP API; `images/chuggy-ui/Dockerfile` bundles the console and serves
the bundle from an nginx that does nothing else. Each argues itself in its own
header, and this is the procedure.

The rig has no registry, and on a single-node k3s it does not need one: the
kubelet reads the node's own containerd, so an archive imported there is an
image already present. `deploy/rig/images/build-and-import.sh` is the build and
that import, end to end.

The manifests are not here. They live in the `gdoteof/chuggy-fabric` repository
and reference these images by the tag this procedure puts on the node.

## Before you start

`docker` on the host you build from, and a k3s node you can reach with an
account that may `sudo`. For the API you also need the database this procedure
does not create: `deploy/rig/postgres/README.md` is that one.

## Build and import

```sh
deploy/rig/images/build-and-import.sh api
```

The tag is the short commit of HEAD, and a dirty working tree is refused rather
than tagged with a commit the image is not built from. `CHUG_IMAGE_TAG` names
one explicitly, which is how a build says out loud that it is naming something
else. `CHUG_RIG_SSH` sends the import to a node over ssh instead of this host's
own containerd.

The console image installs and bundles inside the build, so what it serves is a
function of the commit rather than of this host's Node:

```sh
deploy/rig/images/build-and-import.sh chuggy-ui
```

The bundle becomes the document root. `images/chuggy-ui/nginx.conf` states the
whole of what the image then answers, and the two paths a deployment has to act
on are these:

- **`/config.json` is mounted, never baked.** The image serves it from
  `/etc/chuggy/web/config.json`, outside the document root, with `no-store`. A
  copy of it inside the site is unreachable rather than merely overridden.
  Unmounted, it is a 404 and not the index, so a UI cannot mistake markup for
  its configuration.
- **`/api/v1/` is not proxied here.** The API is reached same-origin through the
  Ingress, which routes the two prefixes on one host. Nothing in this image
  proxies, and nobody should look for it in the nginx configuration.

Every other unresolved path answers with the document root's `index.html`,
because the routes belong to the client.

## What the manifests must reference

| Image | Reference | Serves on | Liveness | Readiness |
|---|---|---|---|---|
| API | `chuggy.invalid/api:<tag>` | 3000 | `GET /health/live` | `GET /health/ready` |
| Console | `chuggy.invalid/chuggy-ui:<tag>` | 8080 | `GET /healthz` | `GET /healthz` |

Both probe paths are unauthenticated. `/health/ready` asks the database whether
this process is connected as the role it must be and may call what it must
call, so a pod that cannot reach PostgreSQL leaves the endpoints rather than
serving errors from them.

`imagePullPolicy: IfNotPresent` is what makes the import matter. `chuggy.invalid`
is a name no resolver will ever answer, so a pod scheduled where the image is
absent fails loudly instead of pulling whatever stands at that name on a public
registry.

## What the pod spec must carry

Neither image needs to write to its own filesystem, so both run with:

```yaml
securityContext:
  runAsNonRoot: true
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities: { drop: [ALL] }
  seccompProfile: { type: RuntimeDefault }
```

The console image's nginx writes its pid and every temporary path under `/tmp`, so
it needs an `emptyDir` mounted there. Its other mount is the deployment's
`/config.json`, read-only at `/etc/chuggy/web/config.json`; neither the fallback
nor that file needs anything writable. The API deployment supplies writable
artifact and Git scratch roots, plus read-only repository credential files;
their locations are named by the variables below.

## Configuring the API

Every variable here is read by `src/roots/nativeHttp.ts` and the process refuses
to start without the required ones.

| Variable | | |
|---|---|---|
| `CHUG_API_DATABASE_URL` | required | see below |
| `CHUG_API_IDEMPOTENCY_KEYING` | required | JSON: a `current` version and the `versions` that may still be verified |
| `CHUG_API_OIDC_ISSUER` | required | an HTTPS URL with no credentials, query or fragment |
| `CHUG_API_OIDC_AUDIENCE` | required | |
| `CHUG_API_OIDC_ALGORITHMS` | required | comma-separated, surrounding spaces trimmed; every entry must be one `oidcVerifiableAlgorithms` in `src/adapters/http/oidc.ts` admits, and anything else — a shared-secret algorithm, `none`, an empty entry, a name with a typo — refuses to start, naming what it refused |
| `CHUG_API_KETO_READ_URL` | required | the read API of the authority that answers project access, HTTP or HTTPS and carrying no credentials |
| `CHUG_API_ARTIFACT_ROOT` | required | see below |
| `CHUG_API_GIT_SCRATCH_ROOT` | required | writable scratch for exact-commit configuration reads |
| `CHUG_API_THREAD_CREDENTIAL_SLOT` | required | the named credential mount a member's thread speaks through |
| `CHUG_API_REPOSITORY_CREDENTIAL_SOURCES` | optional | JSON repository-to-credential-file mappings; a deployment that mints every credential it presents names none |
| `CHUG_API_FORGE_APP_ID` | with the key file, or neither | the GitHub App this deployment mints installation tokens under |
| `CHUG_API_FORGE_APP_KEY_FILE` | with the app id, or neither | a file holding that app's RSA private key, in either PEM encoding; the process refuses to start unless it can be read and used |
| `CHUG_API_FORGE_WORKER_APP_ID` | with the worker key file, or neither | the GitHub App the worker plane mints under, held here only so a tenant can claim its installations over the API |
| `CHUG_API_FORGE_WORKER_APP_KEY_FILE` | with the worker app id, or neither | a file holding that app's RSA private key; the process refuses to start unless it can be read and used, and a worker claim is `ForgeNotConfigured` without it |
| `CHUG_API_FORGE_API_URL` | `https://api.github.com` | where the mint request is sent |
| `CHUG_API_FORGE_TIMEOUT_MS` | | how long one mint request may take before it is an outage |
| `CHUG_API_FORGE_REPOSITORIES_MAX` | 500 | how many repositories one installation listing pages for before it answers `truncated`; it may not exceed what the response schema answers |
| `CHUG_API_FORGE_TEMPLATE_REPOSITORY` | | `<owner>/<name>`, the template a personal account's repository is generated from; a deployment naming none answers such a create `PersonalAccountCreatesOnGitHub` |
| `CHUG_API_HOST` | `0.0.0.0` in the image | the source default is loopback, which no kubelet can reach |
| `CHUG_API_PORT` | 3000 | |
| `CHUG_API_SHUTDOWN_DRAIN_MS` | | how long a drain runs before open connections are closed |
| `CHUG_API_OIDC_DISCOVERY_TIMEOUT_MS` | | |
| `CHUG_API_OIDC_JWKS_TIMEOUT_MS` | | |
| `CHUG_API_KETO_TIMEOUT_MS` | | how long one project access question may take before it is undecided |

**The app id and the key file are named together or not at all.** A deployment
naming neither mints nothing: every repository credential is read from
`CHUG_API_REPOSITORY_CREDENTIAL_SOURCES` as before, and the credential route
answers nothing. A deployment naming one of the two meant to mint and cannot, so
it refuses to start rather than reporting an outage at every mint for as long as
it runs. Where both are named, repositories on the forge the app is installed on
are minted for and every other repository is still read from the files.

**The database URL must select the API group role.** The API authenticates as
`chuggy_api_login` and requires `current_user` to be `chuggy_api`:

```
postgres://chuggy_api_login:<password>@postgres.chuggy.svc.cluster.local:5432/chuggy_rehearsal?options=-c%20role%3Dchuggy_api
```

**The artifact root is data, not image content.** It is a filesystem path the
API only ever reads — the web composition passes the store to one read port —
so the deployment mounts the artifact volume there and may mount it read-only.
Nothing creates the directory for the API, and a path that is not there reads as
an artifact that is missing rather than as a failure.

## Configuring the worker plane's minting

`src/roots/workerPlane.ts` reads the variables below beside the plane's own
database, artifact-root and session variables.

| Variable | | |
|---|---|---|
| `CHUG_WORKER_PLANE_FORGE_APP_ID` | with the key file, or neither | the id of the worker App, which is the one a pod's git credential is minted under |
| `CHUG_WORKER_PLANE_FORGE_APP_KEY_FILE` | with the app id, or neither | a file holding the worker App's RSA private key, in either PEM encoding; the plane refuses to start unless it can be read and used |
| `CHUG_WORKER_PLANE_FORGE_API_URL` | `https://api.github.com` | where the mint request is sent |
| `CHUG_WORKER_PLANE_FORGE_TIMEOUT_MS` | | how long one mint request may take before it is an outage |

**A plane naming neither mints nothing, and no pod stops working.** Both
credential routes answer not found, and a pod resolves `CHUG_WORKER_REPOSITORIES`
and `CHUG_WORKER_CREDENTIAL_FILES` exactly as it did before the plane minted
anything. The same not-found is what a pod gets for a repository whose owner this
pod's own tenant has not claimed — a claim by some other tenant is a not-found
too — so a deployment can mint for some of its repositories and mount the rest.
A plane naming one of the two meant to mint and cannot, so it refuses to start.

**The key is the worker App's, and deliberately not the one the API mints
with.** The branch ruleset admits the portal App to update protected `main`, so
a work attempt's write token minted under it would let an agent-executed pod
push there; the worker App is the one the ruleset refuses. Mounting the portal
App's key here does not widen anything, because which app a claim is looked up
under is the code's and not this variable's: the claim row found is the worker
App's installation, and GitHub refuses a token for it to a request the portal
App signed. It is a deployment that meant to mint and does not.

**A minted token never rests on a node's disk.** The scheduler gives every
worker and session pod a memory-backed volume at `/var/run/chuggy/minted`, which
is where the image writes the password it is answered with, at mode `0600`. That
volume is the pod document's, so nothing about it is configured here; a
deployment that mints nothing simply never writes to it.

## Ticket service

`CHUG_TICKET_SERVICE_CONFIG` contains `database`, `runtime`, `owner` and `pass`.
The pass configuration includes `projectsPerPassMax`, `projectLeaseSeconds`,
`inputsPerProjectMax` and `obligationsPerProjectMax`. The ticket service
processes immutable accepted commands and delivers their obligations; catalog
and source resolution happen at the API and execution boundaries.

The scheduler requires `CHUG_SCHEDULER_TICKET_EXECUTION` for the adopted ticket
worker. It is a JSON object whose `image` is pinned as
`<reference>@sha256:<64 lowercase hexadecimal characters>`. The optional
`capabilities` array defaults to empty. `capabilities`
is what the scheduler claims against: it takes only tasks whose required set it
covers, and a task no capability list covers waits out `unclaimedWindowSecs` and
is then reported execution-unavailable against evidence naming what it asked
for.

The scheduler names no git credential: a harness fetches its own from the
worker plane, which mints it under `CHUG_WORKER_PLANE_FORGE_APP_ID` and
`CHUG_WORKER_PLANE_FORGE_APP_KEY_FILE`, so a deployment that runs ticket work
against a private repository names those. Worker controls and their defaults are defined in
[src/roots/schedulerConfig.ts](../../../src/roots/schedulerConfig.ts).

The ticket launcher applies a frozen execution profile directly to its pod:
`cpu` is Kubernetes millicores and `memory_mb` is MiB. How the process starts is
the image's, not the ticket's: the pod keeps the image entrypoint, which serves
a ticket when `CHUG_TICKET_WORKER_TASK` is set and starts the root
`CHUG_TICKET_WORKER_ENTRYPOINT` names. Codex receives only `codex-auth` and
Claude receives only `claude-code`, each as its configured projected Secret
file. Publishing runs the adopted comment removal and bounded pre-commit hooks
before committing. Cloud identity is reported unavailable because this
deployment has no worker cloud-assertion boundary. A resumed attempt starts
without a prior agent session because the ticket worker has no session store.

## Configuring the control plane's minting

The finalizer requires `CHUG_FINALIZER_RECOVERY_EPOCH` naming the issued
recovery epoch. Claims and subsequent mutations are fenced by that epoch.

The finalizer holds the portal App key
and mints for itself, exactly as the API does. It reads whatever
credential files it is given, and the host in a repository's own address is what
selects between the two: a repository on the forge the key covers is minted for,
and every other repository is read from a file as before.

| Variable | | |
|---|---|---|
| `CHUG_FINALIZER_FORGE_APP_ID` | with the key file, or neither | the portal App the finalizer pushes and proposes under |
| `CHUG_FINALIZER_FORGE_APP_KEY_FILE` | with the app id, or neither | a file holding that app's RSA private key, in either PEM encoding; the finalizer refuses to start unless it can be read and used |
| `CHUG_FINALIZER_FORGE_API_URL` | `https://api.github.com` | where the mint request is sent |
| `CHUG_FINALIZER_FORGE_TIMEOUT_MS` | | how long one mint request may take before it is an outage |
| `CHUG_FINALIZER_CREDENTIAL_SOURCES` | with the app key, or either | JSON repository-to-credential-file mappings; absent or `[]` is a finalizer that mounts nothing |
| `CHUG_FINALIZER_FORGE_BINDINGS` | | JSON forge bindings; an entry's `path` is named where the forge credential is mounted and left out where it is minted |

**A service naming neither a key nor a file list is refused at start-up**, in
each case by the configuration rather than at the first act: it could resolve no
credential for any repository, which is not an outage that might clear.

**Each service mints only what it does.** The finalizer mints `write` for its git promotion and `propose` for its pull-request path.
It mints under the portal App, which the branch
ruleset admits to protected `main` — a promotion and a proposal both need that,
and `deploy/rig/forge/README.md` says which pods now hold that key.

**A worker or session pod needs no roster.** `CHUG_WORKER_REPOSITORIES` is
optional for both pods: on the minted arm a repository the map does not name is
cloned at its own identity, which on this deployment is its clone URL. The map
still overrides where it names one, which is how a mirror is configured. The
mounted arm is unchanged and still refuses a repository the map leaves out.
`CHUG_WORKER_CREDENTIAL_FILES` stays required as a variable, and `{}` is an
admissible value: a pod that mints every credential it presents reads nothing
out of it.

## Prove it

### The image, before any cluster is involved

Run the API image against a database and an issuer, and ask it the two probe
paths. A container's loopback is its own, so this is also where the `0.0.0.0`
in the image is either right or the whole thing is unreachable:

```sh
docker run --rm -d --name api-probe -p 13000:3000 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --env-file <your env file> chuggy.invalid/api:<tag>
curl -s -w ' %{http_code}\n' http://127.0.0.1:13000/health/live
curl -s -w ' %{http_code}\n' http://127.0.0.1:13000/health/ready
```

```
{"status":"live"} 200
{"status":"ready"} 200
```

`--read-only` is the claim that the image needs no writable root, and it is
made here rather than asserted in the manifest, where a wrong answer is a
CrashLoopBackOff on the rig instead of a failure on a desk.

Then stop it. `docker stop` sends SIGTERM, which the process handles by
draining, so it exits promptly and with a zero status rather than being killed
when the client's patience runs out:

```sh
docker stop api-probe; docker inspect -f '{{.State.ExitCode}}' api-probe
```

### The node holds it

`build-and-import.sh` asks after every import, because an import's exit status
is not the claim being made — and it keeps the status too, because a reference
the node lists under a tag you chose yourself may be the build that was already
there. A node it could not ask at all exits 2 rather than reporting an absence
it never established. By hand:

```sh
sudo k3s ctr --namespace k8s.io images ls -q | grep chuggy.invalid
```

### What none of that is evidence of

- **One node.** There is no registry, so nothing replicates the image. A second
  node would not have it, and neither would this one after the node's image
  store is reset.
- **One architecture, named rather than checked.** The build says
  `--platform linux/amd64`, which is the rig node's, because `docker save`
  writes the build host's platform alone and `ctr images import` takes a
  foreign-arch archive without complaint — after which the read-back passes and
  the kubelet fails at exec. A node of another architecture wants
  `CHUG_IMAGE_PLATFORM`; nothing here reads the node to find out.
- **The read-back is containerd's, not the kubelet's.** It says the reference is
  there to be found; it says nothing about a pod starting, a probe passing, or a
  secret being mounted.
- **The base digests pin what the build started from, and only that.** Two
  builds of the same commit install the same dependency versions, because the
  lockfile decides them, but they are not bit-identical images and no step here
  claims they are.
- **The probes above ran against whatever database and issuer the env file
  named.** A green `/health/ready` on a desk says the process and its
  configuration agree; it says nothing about the rig's PostgreSQL or the rig's
  issuer.

## Reversing it

```sh
sudo k3s ctr --namespace k8s.io images rm chuggy.invalid/api:<tag>
```

Removing a tag the node is still running a pod from removes the reference and
not the layers, and the pod keeps running. Deleting the workload first is what
makes the removal mean anything. Nothing else on the node was created or
altered: no namespace, no configuration, no service.
