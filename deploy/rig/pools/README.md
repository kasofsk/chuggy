# The rig's worker pools

A worker pool is a machine or a cluster that claims work from a project and
runs it. This is what registering one means and the order an operator writes
in, neither of which a variable table can carry.

## What reaches a pool

An execution is offered to a pool only where its `placement` is `Pool`, which
the scheduler writes once, when it registers the execution. The route is
`CHUG_SCHEDULER_EXECUTION_POLICY`'s: a `route` of `InCluster` or `Pool` on each
task kind, and `projectRoutes`, keyed by tenant and then project, for a project
that routes a kind otherwise. A kind that names no route runs in the cluster,
so a pool takes nothing until a policy sends it work, and a policy changed
later moves only what registers after it.

A session is routed by `CHUG_SCHEDULER_SESSION_POLICY`'s `routes`, on `Thread`
and `Lead`, and its `projectRoutes`, over the project's own session placement;
an inquiry runs where the lead does. A turn keeps the route it was admitted
on, so a placement changed later moves the next turn admitted and never one
already queued, and the cluster places and claims only turns admitted
`InCluster`. On `Pool` a thread is taken only by its member's personal runner,
an inquiry by a pool its member registered on the project, and the lead by any
of the project's pools. A member with no such runner for their thread or
inquiry is refused a turn on `Pool` as `NoRunner`, and a `Pool` turn no runner takes within
`sessionPoolTurnDwellSecs` (`src/interpreter/sessionPlacement.ts`) is withdrawn
by the scheduler.

A pool is handed a placement and nothing about the work, so its harness
fetches the task from the worker plane under the attempt bearer, as it fetches
its inputs and its credentials (`GET /v1/task`,
`src/adapters/http/workerPlaneServer.ts`). The scheduler records that task for
an attempt routed to a pool after the same policy check as one it places, and
does not place it: the pool claims it.

A project's owner fallback lets a member's personal runner take a `Pool`
execution of a ticket that member wrote; until an administrator writes it, no
personal runner takes the project's work. Under `Strict` no pool takes such an
execution while its owner has a runner serving the project and able to run it,
and under `Preferred` none takes it while that runner is live; otherwise it
reaches the pools as before. An execution keeps the fallback it was registered
under, so changing or removing it moves only what registers after.

**A pool's refusal is final.** The scheduler withdraws the refused attempt
without spending the retry budget and blocks the execution; it does not offer
the work to another pool. `Unavailable` for an assignment a pool claimed is
as final: the execution concludes as a failed process.

## How a pool pulls

An assignment names the image its execution pinned, as its configuration
names it. A job's assignment also names the runtime image its attempt was
opened under, where the attempt kept one. The pool plane serves only releases
that read it (`workerPoolContractAccepted` in `src/interpreter/workerPool.ts`):
an earlier pool or personal runner is refused at its poll, which chuggy-linux
before 0.5.0 logs as the plane not serving its worker contract, and exits.
Where either reference's host is a key of the pool plane's
`CHUG_POOL_PLANE_IMAGE_HOSTS`, a JSON object from an internal registry host to
its public one, the assignment names the public host instead, with the path and
digest unchanged. A malformed value refuses the plane's start; unset, every
reference is named as kept.

The public registry is read-only, and its front asks the pool plane at
`/registry/authorize`, outside the `/v1` its public address serves, about every
request. A pool presents a Basic credential of any user name whose password is
its own access token, the one its polls carry as a bearer. The base `/v2/`, a
manifest by the digest of an image or runtime that an assignment the pool still
holds names, and a blob of that reference's repository, are allowed; everything
else is refused, including the catalog, tags, a manifest by tag, any write, and
a pull before a claim or after a release. The token is checked as each request
starts, so a pull's last request has to start before the token expires. The
Kubernetes pool client sets no pull credential on the pods it makes, so a pool
pulling from the public registry supplies one to its container runtime itself.

## What a pool is trusted with

A pool's principal holds `Execute` on one project. `pools` is a relation
`execute` follows from, so a pool holds that permit and nothing a person's
relation carries: it cannot read the project's threads or tickets through the
API, cannot propose or dispatch, and cannot widen its own access — the
registration command holds the issuer's admin address and the plane a pool
polls holds none, which `.dependency-cruiser.cjs` states as a rule.

With `Execute` a pool claims work whose platform and required capabilities its
declaration covers, a platform being declared as a token such as
`Platform:Linux:Amd64`, and mints a forge credential for any repository the
project binds (`src/interpreter/forgeCredentials.ts`). Both are revoked by
taking the relation back, so a revoked pool stops being admitted without
anything being deleted (`src/interpreter/workerPool.ts`). The scheduler asks
the authority the same question of every registered pool, so a revoked one is
not counted as able to run the project's work either: work that only it could
run is blocked, and an authority the scheduler cannot reach blocks nothing.

**The pool's host sees everything the harness sees.** This is not a gap waiting
on a fix — it is what running the work means. The machine executing a harness
holds the prompt, the ticket's inputs and whatever credential the work was
given, in its own memory and on its own filesystem, and no protocol between
chuggy and that machine can take it back. Keeping ticket content out of the
placement payload bounds what the pool's *backend* sees — a Kubernetes API, a
scheduler's object store — and bounds nothing about the host.

So registering a pool extends the project's confidentiality boundary to that
machine and to whoever administers it. Two things follow, and they are the
policy rather than a control:

- A pool is registered by people who would be allowed to read the project's
  work themselves, and deregistered when that stops being true.
- A declaration of capabilities is a claim, not a proof. Nothing verifies that
  a pool declaring a token can deliver it, or that a pool runs the isolation
  its operator says it does; work requiring the token is offered on the
  strength of the declaration alone. The declaration is trusted exactly as far
  as the operator is.

`deploy/rig/isolation/README.md` is the other half of this and does not replace
it: it bounds what work running *on the rig* reaches. A registered pool is a
host the rig does not run and those controls say nothing about.

## Personal runners

A personal runner is a member's own machine, and it takes nothing but that
member's threads and, under the owner fallback, their executions, in the
projects they allowlist and may still read. A member may hold several in a
tenant, each with its own room, and none until the tenant gives them personal
runners, which a new tenant's administrators may (an older tenant:
`deploy/rig/keto/README.md`, Default authority holders), save the person a
tenant is made for, who holds them from its making. The member mints a
single-use token for the tenant, under My runner in the console's workspace
settings or with
`POST /api/v1/tenants/:tenant/personal-runner-registration-tokens`, and
redeems it on the machine with the runner's `register --personal`; each
redemption adds a runner. A member's runners share one list of projects and
serve none until their owner adds one. The owner removes one runner by its id
or all of theirs, a tenant administrator all of a member's, and the list goes
with the last. A personal runner holds no relation and is admitted only while
its owner keeps the permit, and the forge credentials it is given are for the
project of work it holds.

## The order an operator writes in

**The deployed relation model gains `pools` first.** Keto writes a tuple naming
any relation whether or not the model declares one, so a registration against a
model without `pools` succeeds, answers nothing, and every poll that pool makes
is refused as though it were never registered; the scheduler reads that pool as
revoked, and blocks the work only it could run. The deployed model is the
fabric's; `.chug/tasks/keto/namespaces.ts` is the copy `check-keto.sh` drives
its own server with, and `deploy/rig/keto/README.md` is why reading one against
the other is a hand operation.

**Then `chuggy_pool_plane`.** The plane connects as that group and refuses
readiness under any other, so `deploy/rig/postgres/postgres-roles.sql` and the
migration it precedes both have to have run.

**Then the pools.** An owner mints a single-use registration token for one
project and an operator redeems it on the machine, or
`src/roots/registerWorkerPool.ts` makes the same writes where the owner is at
the machine already. The client secret is answered once and stored nowhere: a
pool that loses it is registered again. Registering a pool's name again ends
what the older registration held: its harnesses are refused at once, and each
attempt they ran ends `Lost` when its lease lapses, spending a retry.
