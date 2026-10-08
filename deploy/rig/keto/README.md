# The rig's authority

Who may address a project is a relation tuple in Ory Keto, not a row in the
rig's PostgreSQL. `deploy/rig/postgres/README.md` is the procedure for the
database; this is the procedure for the authority beside it.

The namespaces the API asks about — `Project`, `Tenant` and `Site` — are the
model the fabric deploys with the server, and nothing in this checkout applies
it.
`.chug/tasks/keto/namespaces.ts` is the copy `check-keto.sh` drives its own
container with, so a model the rig runs and a model the gate proves against are
one file apart and are compared by nobody. The API's readiness answers false
until all three namespaces exist and every permit the code asks for is declared,
which is how a server carrying some other model, or one that renamed a permit,
is caught at a pod's door rather than by the first member it refuses. A permit
still declared under a changed meaning — a `develop` that no longer implies
`read` — passes readiness, so a change to the deployed model is still read
against `.chug/tasks/keto/namespaces.ts` by hand.

## Before migration 26

Link every project a person was granted on before
`src/roots/provisionProjectAccess.ts` wrote the link, then apply the migration
and roll out the images that declare it, which go out in one window
(`deploy/rig/postgres/README.md`, Migrate). From then the
API serves `POST /api/v1/projects`, and a project with neither a link nor a
row holds nothing: the first principal to ask for its tenant is given the
tenant, then creates that project and administers it. Keto's read API lists every project object
that carries a tuple (`GET /relation-tuples?namespace=Project`, following
`next_page_token`); each one with no `tenant` tuple is linked once, with the
command below and its write URL exported. An object is the tenant's length, a
colon, then the tenant and the project run together: `5:vtengchuggy` is tenant
`vteng`, project `chuggy`. The command writes whatever it is named, so a wrong
split links some other project, holding its tenant, and leaves this one
unlinked; that link is revoked as under [Reversing it](#reversing-it).

```sh
CHUG_PROVISION_TENANT="tenant" CHUG_PROVISION_PROJECT="project" \
  CHUG_PROVISION_RELATION=tenant CHUG_PROVISION_ACTION=grant \
  npm run provision:project-access
```

Then list again: every project object carries a `tenant` tuple.

## Default authority holders

Who may grant each role, make an account or change either is held as tuples
beside the roles. A creation writes its own: a new tenant's, and each new
project's. The site, and every tenant and project that existed before, are given
theirs by an operator, in this order. Until the site has an administrator and
its defaults, nobody holds `CreateAccount`.

**Name the site's first administrator.** The site is asked for by
`CHUG_PROVISION_LEVEL=site`, which writes only the site's `admins` and is
refused beside a tenant, a project or any other relation:

```sh
export CHUG_PROVISION_KETO_WRITE_URL="$keto_write_url"
CHUG_API_OIDC_ISSUER="https://accounts.example.test" \
  CHUG_PROVISION_SUBJECT="the sub claim the provider issues" \
  CHUG_PROVISION_LEVEL=site CHUG_PROVISION_RELATION=admins \
  CHUG_PROVISION_ACTION=grant npm run provision:project-access
```

`CHUG_PROVISION_ACTION=revoke` takes it back.

**Give defaults to what exists.** `src/roots/provisionAccessDefaults.ts`
reads and writes Keto and nothing else. It considers the site, and with
`CHUG_PROVISION_TENANT` that tenant and the projects linked to it, or without it
every tenant and project holding a tuple. Run it first without
`CHUG_PROVISION_APPLY`, which writes nothing, and read what it reports; then
with `CHUG_PROVISION_APPLY=1`, which writes and reports the same lines:

```sh
export CHUG_PROVISION_KETO_READ_URL="$keto_read_url"
export CHUG_PROVISION_KETO_WRITE_URL="$keto_write_url"
npm run provision:access-defaults
CHUG_PROVISION_APPLY=1 npm run provision:access-defaults
```

One line an object, naming it and no person:

- `defaults` — it holds no authority tuple and is given its defaults, all of
  them in one request.
- `left` — it holds an authority tuple and is left exactly as it is. This is
  what a second run says of everything the first gave defaults, and it never
  puts back a holder a person has since removed.
- `skipped …: no administrator holds it` — a tenant with no `admins`, written
  nothing because a tuple there would hold it while nobody administers it.
  Grant it an administrator, then run again.
- `skipped …: no tenant link names its own tenant` — a project its tenant's
  administrators do not reach. Link it as under
  [Before migration 26](#before-migration-26), then run again.
- `skipped …: its name is no tenant's or project's this tree writes` — an object
  nothing here reads. It is left for the operator to remove or keep.

Two cases a run does not tell from an object never given defaults, and gives
them again: a project, or the site, from which every holder of every authority
was removed.

A listing of a namespace, or of a tenant's projects, longer than its bound in
pages fails the run before anything is written, and
`CHUG_PROVISION_LISTING_PAGES_MAX` raises the bound.

## Grant a project access

The API writes the tuples its own routes create — a new tenant's `admins` and
defaults, a created project's `tenant` and defaults, and a registered pool's
`pools` — when
`CHUG_API_KETO_WRITE_URL` names Keto's **write** port. A grant to anyone else is
the operator's, through `src/roots/provisionProjectAccess.ts`, which reaches
that port and nothing else and needs no database at all.

Supply the issuer and the subject the token carries; the command derives the
principal with the same function the API derives it from, so neither side has
an encoding to get wrong.

```sh
export CHUG_PROVISION_KETO_WRITE_URL="$keto_write_url"
export CHUG_API_OIDC_ISSUER="https://accounts.example.test"
export CHUG_PROVISION_SUBJECT="the sub claim the provider issues"
export CHUG_PROVISION_TENANT="tenant" CHUG_PROVISION_PROJECT="project"
export CHUG_PROVISION_RELATION="developers"
CHUG_PROVISION_ACTION=grant npm run provision:project-access
```

`CHUG_PROVISION_RELATION` names one relation, and the model is what turns it
into the permits a route asks for: `admins`, `developers`, `dispatchers`,
`agents` and `pools` are the project's, and `admins`, `members` and
`hosted_execution` are the tenant's. A grant with `CHUG_PROVISION_PROJECT`
absent is a tenant grant, and one whose relation is `tenant` names the tenant
the project inherits from rather than a person — the one arm that reads no
issuer or subject. A person's project grant writes that `tenant` link beside
it, so the tenant's administrators administer the project, as they do every
project the API creates.

A grant is a PUT, so re-running it changes no answer and granting a second
relation adds to what the principal holds rather than replacing it. Narrowing
access is a revocation of the relation to be taken back.

**The project need not exist.** A tuple names an object rather than referencing
a row, so access written before the project is created starts answering when
the project does — which is what lets an operator write every member's access
before the release that reads it.

**Tuples hold a tenant.** The creation route gives a tenant only to a principal
that administers it once anything holds it: its row, a tuple on the tenant, or
a project whose `tenant` it is. A project granted to a person before the
command wrote the link holds nothing, and is linked under
[Before migration 26](#before-migration-26).

**The selector needs the hosted grant too.** A project's lead runs on the
shared credential as the principal the selector's `identity.principal` setting
names, and the selector passes over every project whose tenant does not grant
that principal `hosted_execution`. The rig's setting is the principal of issuer
`https://auth.vteng.io` and subject `chuggy-selector`, so with the write URL
exported as above, tenant `vteng` is granted with:

```sh
CHUG_API_OIDC_ISSUER=https://auth.vteng.io CHUG_PROVISION_SUBJECT=chuggy-selector \
  CHUG_PROVISION_TENANT=vteng CHUG_PROVISION_PROJECT= \
  CHUG_PROVISION_RELATION=hosted_execution CHUG_PROVISION_ACTION=grant \
  npm run provision:project-access
```

### Reversing it

```sh
CHUG_PROVISION_ACTION=revoke npm run provision:project-access
```

One relation, taken back. A revocation names the same tuple as the grant and
is idempotent: a tuple that was never there is not an error. Revoking a
person's project grant leaves the project's `tenant` link; a link written by
mistake is revoked on its own, once every person's grant on the project is
revoked, with `CHUG_PROVISION_TENANT` and `CHUG_PROVISION_PROJECT` naming the
project:

```sh
CHUG_PROVISION_RELATION=tenant CHUG_PROVISION_ACTION=revoke \
  npm run provision:project-access
```
