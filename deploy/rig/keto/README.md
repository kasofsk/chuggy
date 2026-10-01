# The rig's authority

Who may address a project is a relation tuple in Ory Keto, not a row in the
rig's PostgreSQL. `deploy/rig/postgres/README.md` is the procedure for the
database; this is the procedure for the authority beside it.

The namespaces the API asks about — `Project` and `Tenant` — are the model the
fabric deploys with the server, and nothing in this checkout applies it.
`.chug/tasks/keto/namespaces.ts` is the copy `check-keto.sh` drives its own
container with, so a model the rig runs and a model the gate proves against are
one file apart and are compared by nobody. The API's readiness answers false
until both namespaces exist and every permit the code asks for is declared,
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

## Grant a project access

The API writes the tuples its own routes create — a new tenant's `admins`, a
created project's `tenant` and a registered pool's `pools` — when
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

A grant is a PUT, so re-running it changes nothing and granting a second
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
