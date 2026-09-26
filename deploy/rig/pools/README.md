# The rig's worker pools

A worker pool is a machine or a cluster that claims work from a project and
runs it. This is what registering one means and the order an operator writes
in, neither of which a variable table can carry.

## Nothing reaches a pool yet

An execution is offered to a pool only where its `placement` is `Pool`, and no
code in this tree writes that: every execution is `InCluster` and the
scheduler places it itself, which is the launch read in
`src/adapters/postgres/scheduler.ts`. What is here is the plane, the registry,
the registration token and the Kubernetes backend — the seam a second fabric is
added at — and the slice that routes work to a pool (kasofsk/chuggy#687) is
what turns them on.

Two things that slice brings with it, each filed rather than found later:

- **A pool's attempt needs its invocation recorded.** A pool is handed a
  placement and nothing about the work, so its harness fetches the task from
  the worker plane under the attempt bearer, as it fetches its inputs and its
  credentials (`GET /v1/task`, `src/adapters/http/workerPlaneServer.ts`). The
  scheduler records that task only for an attempt it places itself, and a pool
  claims no attempt without one (kasofsk/chuggy#706).
- **A pool's refusal is not yet a terminal.** `pool_refusal` is a column a pool
  writes, and nothing reads it: turning it into the attempt's outcome belongs
  where every other terminal is decided (kasofsk/chuggy#707).

## What a pool is trusted with

A pool's principal holds `Execute` on one project. `pools` is a relation
`execute` follows from, so a pool holds that permit and nothing a person's
relation carries: it cannot read the project's threads or tickets through the
API, cannot propose or dispatch, and cannot widen its own access — the
registration command holds the issuer's admin address and the plane a pool
polls holds none, which `.dependency-cruiser.cjs` states as a rule.

With `Execute` a pool claims work whose required capabilities its declaration
covers, and mints a forge credential for any repository the project binds
(`src/interpreter/forgeCredentials.ts`). Both are revoked by taking the
relation back; the row the registry keeps is who the caller is and never what
it may do, so a revoked pool stops being admitted without anything being
deleted (`src/interpreter/workerPool.ts`).

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

## The order an operator writes in

**The deployed relation model gains `pools` first.** Keto writes a tuple naming
any relation whether or not the model declares one, so a registration against a
model without `pools` succeeds, answers nothing, and every poll that pool makes
is refused as though it were never registered. The deployed model is the
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
pool that loses it is registered again.
