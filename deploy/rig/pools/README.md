# The rig's worker pools

The pool plane serves a member's personal runner and chat host. This is what
reaches them, what they are trusted with and the order an operator writes in,
none of which a variable table can carry.

**Nothing registers, lists or grants a project's pool.** The API serves no
route for one, and the pool plane admits a member's personal runner and chat
host and nothing else, so no pool is given work. A project's work runs in the
cluster or on its owner's personal runner.

## What reaches a personal runner

An execution is offered to a runner only where its `placement` is `Pool`, which
the scheduler writes once, when it registers the execution. The route is
`CHUG_SCHEDULER_EXECUTION_POLICY`'s: a `route` of `InCluster` or `Pool` on each
task kind, and `projectRoutes`, keyed by tenant and then project, for a project
that routes a kind otherwise. A kind that names no route runs in the cluster,
so a runner takes nothing until a policy sends it work, and a policy changed
later moves only what registers after it.

A thread is routed by `CHUG_SCHEDULER_SESSION_POLICY`'s `routes` on `Thread`,
and its `projectRoutes`, over the project's own session placement; a `Lead`
either names is ignored. A turn keeps the route it was admitted on, so a
placement changed later moves the next turn admitted and never one already
queued, and the cluster places and claims only turns admitted `InCluster`. On
`Pool` a thread is taken only by its member's chat host, and no pool takes a
session. A member with no chat host is refused a thread's turn on `Pool` as
`NoRunner`, and a `Pool` turn no chat host takes within
`sessionPoolTurnDwellSecs` (`src/interpreter/sessionPlacement.ts`) is
withdrawn by the scheduler.

A runner is handed a placement and nothing about the work, so its harness
fetches the task from the worker plane under the attempt bearer, as it fetches
its inputs and its credentials (`GET /v1/task`,
`src/adapters/http/workerPlaneServer.ts`). The scheduler records that task for
an attempt routed to a runner after the same policy check as one it places,
and does not place it: the runner claims it.

A `Pool` execution is taken by a personal runner of the member who wrote its
ticket, one serving the project and able to run it, and by nothing else. An
execution with no owner, or whose owner has no runner configured for it, is
blocked; one whose owner's runner is configured and not polling waits for it.

**A runner's refusal is final.** The scheduler withdraws the refused attempt
without spending the retry budget and blocks the execution; it does not offer
the work to another runner. `Unavailable` for an assignment a runner claimed
is as final: the execution concludes as a failed process.

## How a pool pulls

An assignment names the image its execution pinned, as its configuration
names it. A job's assignment also names the runtime image its attempt was
opened under, where the attempt kept one. The pool plane serves only releases
that read it (`workerPoolContractAccepted` in `src/interpreter/workerPool.ts`):
an earlier runner is refused at its poll, which chuggy-linux
before 0.5.0 logs as the plane not serving its worker contract, and exits.
Where either reference's host is a key of the pool plane's
`CHUG_POOL_PLANE_IMAGE_HOSTS`, a JSON object from an internal registry host to
its public one, the assignment names the public host instead, with the path and
digest unchanged. A malformed value refuses the plane's start; unset, every
reference is named as kept.

The public registry is read-only, and its front asks the pool plane at
`/registry/authorize`, outside the `/v1` its public address serves, about every
request. A pool presents a Basic credential of any user name whose password is
its own access token, the one its polls carry as a bearer. The base `/v2/`, and
a manifest or a blob by digest in the repository of an image or runtime that an
assignment the pool still holds names, are allowed, so an index's platform
manifests are pulled as its blobs are; everything
else is refused, including the catalog, tags, a manifest by tag, any write, and
a pull before a claim or after a release. The token is checked as each request
starts, so a pull's last request has to start before the token expires.

## What a runner is trusted with

A personal runner or a chat host holds no relation. It is admitted only while
its owner keeps the permit, cannot read the project's threads or tickets
through the API, and cannot widen its own access: the API holds the issuer's
admin address it is registered with, and the plane it polls holds none, which
`.dependency-cruiser.cjs` states as a rule.

**The runner's host sees everything the harness sees.** This is not a gap waiting
on a fix — it is what running the work means. The machine executing a harness
holds the prompt, the ticket's inputs and whatever credential the work was
given, in its own memory and on its own filesystem, and no protocol between
chuggy and that machine can take it back. Keeping ticket content out of the
placement payload bounds what the runner's *backend* sees — a Kubernetes API, a
scheduler's object store — and bounds nothing about the host.

So registering a runner extends the project's confidentiality boundary to that
machine and to whoever administers it. Two things follow, and they are the
policy rather than a control:

- A runner is registered by a member who may read the project's work
  themselves, and serves a project only while they may still read it.
- A declaration of capabilities is a claim, not a proof. Nothing verifies that
  a runner declaring a token can deliver it, or that a runner runs the isolation
  its operator says it does; work requiring the token is offered on the
  strength of the declaration alone. The declaration is trusted exactly as far
  as the operator is.

`deploy/rig/isolation/README.md` is the other half of this and does not replace
it: it bounds what work running *on the rig* reaches. A registered runner is a
host the rig does not run and those controls say nothing about.

## Personal runners

A personal runner is a member's own machine, and it takes nothing but that
member's executions, in the projects they allowlist
and may still read; their threads run on their chat host. A member may hold several in a
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

A member's chat host is their one machine for their threads, in
every project of the tenant they may read, under the same permit. It is
registered the same way, with a token from
`POST /api/v1/tenants/:tenant/chat-host-registration-tokens` and the runner's
`register --chat`; registering another replaces it, ending what it held.

A chat host runs its sessions in one container, started from the image its
poll is answered. That is the pool plane's `CHUG_POOL_PLANE_CHAT_IMAGE`, a
reference pinned by digest on the registry host the cluster names, which is
what a host's pull is allowed by, and where it is unset the image of
`CHUG_SCHEDULER_SESSION_POLICY`. The `chat` target of `images/worker/Dockerfile`
is built for it. A value that is not pinned by digest refuses the plane's
start.

## The order an operator writes in

**`chuggy_pool_plane` first.** The plane connects as that group and refuses
readiness under any other, so `deploy/rig/postgres/postgres-roles.sql` and the
migration it precedes both have to have run.

