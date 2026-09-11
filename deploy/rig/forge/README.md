# The rig's forge apps

The API mints a GitHub installation token for every repository act it serves,
from the portal App's own private key. `deploy/rig/keto/README.md` is the
procedure for who may ask; this is the procedure for what the API asks with.

Two Apps are installed on each account. The **portal** App is the API's, and
its key is the one this deployment mounts; the **worker** App is the fabric's,
and nothing in this checkout holds its key. Which tenant may mint under an
account is a row in the rig's PostgreSQL, written by the command below and read
by nothing else.

## Mount the portal App's key

The API reads the key from a file. Create a Secret from the PEM GitHub issued —
`-----BEGIN RSA PRIVATE KEY-----`, which is PKCS#1 and is accepted as it stands
— mount it into the API pod, and name it and the App:

```
CHUG_API_FORGE_APP_ID=<the App's numeric id>
CHUG_API_FORGE_APP_KEY_FILE=/etc/chuggy/forge/portal.pem
```

Both or neither: a deployment naming one of the two refuses to start, and one
naming neither mints nothing and reads every credential from
`CHUG_API_REPOSITORY_CREDENTIAL_SOURCES` as before. `deploy/rig/images/README.md`
carries these rows and the two bounds beside them.

The key is read once per mint rather than held, and the process refuses to start
unless the file it names is a readable RSA private key — so a Secret mounted at
the wrong path is a pod that never becomes ready rather than a route that
answers 503 for as long as it runs.

**The deployed authority must declare `execute` on `Project`.** The credential
route asks that permit, and the API's readiness probes every permit the code
asks for, so an authority carrying a model without it reports NOT READY at the
pod's door.

## Claim an account

`src/roots/provisionForgeInstallation.ts` is the only way a claim is written
from this tree. It connects as the boundary owner, because no runtime role
holds the door it goes through.

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
