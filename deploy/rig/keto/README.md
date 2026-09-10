# The rig's authority

Who may address a project is a relation tuple in Ory Keto, not a row in the
rig's PostgreSQL. `deploy/rig/postgres/README.md` is the procedure for the
database; this is the procedure for the authority beside it.

The namespaces the API asks about — `Project` and `Tenant` — are the model the
fabric deploys with the server, and nothing in this checkout applies it. The
API's readiness answers false until both namespaces exist, which is how a
server carrying some other model is caught at the door rather than by the first
member it refuses.

## Grant a project access

`src/roots/provisionProjectAccess.ts` is the only way a tuple is written from
this tree. It reaches Keto's **write** port and nothing else: the API holds no
credential for that port, so the API process cannot widen its own
authorization, and this command needs no database at all.

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
into the permits a route asks for: `admins`, `developers`, `dispatchers` and
`agents` are the project's, and `admins`, `members` and `hosted_execution` are
the tenant's. A grant with `CHUG_PROVISION_PROJECT` absent is a tenant grant,
and one whose relation is `tenant` names the tenant the project inherits from
rather than a person — the one arm that reads no issuer or subject.

A grant is a PUT and writes one tuple, so re-running it changes nothing and
granting a second relation adds to what the principal holds rather than
replacing it. Narrowing access is a revocation of the relation to be taken
back.

**The project need not exist.** A tuple names an object rather than referencing
a row, so access written before the project is created starts answering when
the project does — which is what lets an operator write every member's access
before the release that reads it.

### Reversing it

```sh
CHUG_PROVISION_ACTION=revoke npm run provision:project-access
```

One relation, taken back. A revocation names the same tuple as the grant and
is idempotent: a tuple that was never there is not an error.
