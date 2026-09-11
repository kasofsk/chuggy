# The rig's forge apps

The API mints a GitHub installation token for every repository act it serves,
from the portal App's own private key. `deploy/rig/keto/README.md` is the
procedure for who may ask; this is the procedure for what the API asks with.

Two Apps are installed on each account. The **portal** App is the API's, and it
is the one every act here mints under; the **worker** App is the plane's, and the
API holds its key only to verify a claim, never to mint. Which tenant may mint
under an account is a row in the rig's PostgreSQL, written by a route or by the
command below and read by nothing else.

## Mount the Apps' keys

The API reads the key from a file. Create a Secret from the PEM GitHub issued —
`-----BEGIN RSA PRIVATE KEY-----`, which is PKCS#1 and is accepted as it stands
— mount it into the API pod, and name it and the App:

```
CHUG_API_FORGE_APP_ID=<the App's numeric id>
CHUG_API_FORGE_APP_KEY_FILE=/etc/chuggy/forge/portal.pem
```

The worker App's key is mounted the same way and is optional:

```
CHUG_API_FORGE_WORKER_APP_ID=<the worker App's numeric id>
CHUG_API_FORGE_WORKER_APP_KEY_FILE=/etc/chuggy/forge/worker.pem
```

Both or neither, per pair: a deployment naming one half of either refuses to
start. A deployment naming no portal pair mints nothing and reads every
credential from `CHUG_API_REPOSITORY_CREDENTIAL_SOURCES` as before, and one
naming no worker pair answers a worker claim `ForgeNotConfigured`.
`deploy/rig/images/README.md` carries these rows and the two bounds beside
them.

The key is read once per mint rather than held, and the process refuses to start
unless the file it names is a readable RSA private key — so a Secret mounted at
the wrong path is a pod that never becomes ready rather than a route that
answers 503 for as long as it runs.

**The deployed authority must declare `execute` and `administer` on `Project`
and `administer` on `Tenant`.** The credential route asks the first, the
onboarding routes ask the other two, and the API's readiness probes every permit
the code asks for, so an authority carrying a model without one of them reports
NOT READY at the pod's door.

## Claim an account over the API

A tenant's administrator claims an installation through the API, which is the
path a console drives and the one that needs no operator:

```
POST /api/v1/tenants/<tenant>/forge-installations
{"forge": "github", "app": "portal", "installationId": "<that App's installation id>"}
```

Onboarding installs **two** Apps on the account, and the claim names which: the
portal App the API, finalizer, ticket service and importer act as, and the
worker App the plane mints under. Each has its own installation id on the same
account, so a claim is made twice — once per App.

It needs `administer` on the tenant, and the API verifies the installation with
GitHub as the App it is claimed for before recording it — an installation of
another App, or one that is not there, is refused. An App the API holds no key
for is `ForgeNotConfigured`: the worker key is `CHUG_API_FORGE_WORKER_APP_ID`
and `CHUG_API_FORGE_WORKER_APP_KEY_FILE`.

`GET /api/v1/forge/github` answers one row per App this deployment holds, each
with the address to install it from, and
`GET /api/v1/tenants/<tenant>/forge-installations/<id>/repositories` answers
what one claimed installation grants, read as the App the claim names.

A tenant administrator can claim any unclaimed installation of these Apps whose
id they know. The first claim wins, and there is no route that undoes one: a
wrong claim is the operator's to remove, as below.

Binding a repository to a project proves it against the **portal** claim,
because the API's own reads mint under the portal App. Whether the tenant also
claimed the worker App on that owner is the plane's question when it mints, not
this route's.

## Claim an account as the operator

`src/roots/provisionForgeInstallation.ts` writes a claim without a bearer, for a
tenant that has no administrator yet. It connects as the boundary owner, because
the route's role reaches the door and nothing else.

The installation id is the App's installation on that account, which is the last
path segment of the App's installation settings URL.

```sh
export CHUG_PROVISION_DATABASE_URL="$owner_database_url"
export CHUG_API_OIDC_ISSUER="https://accounts.example.test"
export CHUG_PROVISION_SUBJECT="the sub claim the provider issues"
export CHUG_PROVISION_FORGE=github
export CHUG_PROVISION_APP=portal
export CHUG_PROVISION_ACCOUNT=kasofsk
export CHUG_PROVISION_ACCOUNT_KIND=User
export CHUG_PROVISION_INSTALLATION_ID=156333284
export CHUG_PROVISION_TENANT=vteng
npm run provision:forge-installation
```

`CHUG_PROVISION_APP` is `portal` or `worker`, and `CHUG_PROVISION_ACCOUNT_KIND`
is `User` or `Organization`. The subject and the issuer record who claimed, and
authorize nothing.

The command reports what it did:

- `Recorded` — the account was unclaimed and now belongs to this tenant.
- `AlreadyRecorded` — the same claim already stands, so nothing changed.
- `Reinstalled` — the App was removed and installed again, so the standing claim
  now points at the new installation id.
- `ClaimedElsewhere` — another tenant holds this account. The command exits
  non-zero and changes nothing.

### Reversing it

There is none. An account claimed by a tenant is never released and never
changes hands: the trigger refuses a delete and refuses a change of tenant even
from the owner. An account claimed by the wrong tenant is a row an operator
removes with the migration that would let them.
