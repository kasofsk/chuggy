# The rig's container images

Two images and the one way they reach the rig. `images/api/Dockerfile` is the
native HTTP API; `images/web/Dockerfile` is an nginx that serves a directory of
static files and does nothing else. Each argues itself in its own header, and
this is the procedure.

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

The web image serves what it is pointed at and has no default:

```sh
CHUG_WEB_SITE=<directory> deploy/rig/images/build-and-import.sh web
```

That directory's contents become the document root. `images/web/Dockerfile`
states the whole of what the image then answers, and the two paths a deployment
has to act on are these:

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
| Web | `chuggy.invalid/web:<tag>` | 8080 | `GET /healthz` | `GET /healthz` |

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

The web image's nginx writes its pid and every temporary path under `/tmp`, so
it needs an `emptyDir` mounted there. Its other mount is the deployment's
`/config.json`, read-only at `/etc/chuggy/web/config.json`; neither the fallback
nor that file needs anything writable. The API image needs no mount of its own,
but `CHUG_API_ARTIFACT_ROOT` below names one.

## Configuring the API

Every variable here is read by `src/roots/nativeHttp.ts` and the process refuses
to start without the required ones.

| Variable | | |
|---|---|---|
| `CHUG_API_DATABASE_URL` | required | see below |
| `CHUG_API_IDEMPOTENCY_KEYING` | required | JSON: a `current` version and the `versions` that may still be verified |
| `CHUG_API_OIDC_ISSUER` | required | an HTTPS URL with no credentials, query or fragment |
| `CHUG_API_OIDC_AUDIENCE` | required | |
| `CHUG_API_OIDC_ALGORITHMS` | required | comma-separated, and `none` is refused |
| `CHUG_API_ARTIFACT_ROOT` | required | see below |
| `CHUG_API_HOST` | `0.0.0.0` in the image | the source default is loopback, which no kubelet can reach |
| `CHUG_API_PORT` | 3000 | |
| `CHUG_API_SHUTDOWN_DRAIN_MS` | | how long a drain runs before open connections are closed |
| `CHUG_API_OIDC_DISCOVERY_TIMEOUT_MS` | | |
| `CHUG_API_OIDC_JWKS_TIMEOUT_MS` | | |

**The database URL must become the group role.** The API authenticates as
`chuggy_api_login` and refuses to start unless `current_user` is `chuggy_api`,
which the login role holds by grant rather than by default. The connection
string carries the switch:

```
postgres://chuggy_api_login:<password>@postgres.chuggy.svc.cluster.local:5432/chuggy?options=-c%20role%3Dchuggy_api
```

**The artifact root is data, not image content.** It is a filesystem path the
API only ever reads — the web composition passes the store to one read port —
so the deployment mounts the artifact volume there and may mount it read-only.
Nothing creates the directory for the API, and a path that is not there reads as
an artifact that is missing rather than as a failure.

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
- **One architecture, and nothing here checks it.** `docker save` writes the
  build host's platform alone, and `ctr images import` takes a foreign-arch
  archive without complaint — after which the read-back passes and the kubelet
  fails at exec. Build on a host whose architecture is the node's, or say
  `--platform` and mean it.
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
