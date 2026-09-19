# The rig's worker pools

A worker pool is a machine or a cluster that claims work from a project and
runs it. `deploy/rig/images/README.md` is where the variables are — the
registration command's and the plane's. This is what registering one means and
the order an operator writes in, neither of which a variable table can carry.

## What a pool is trusted with

A pool's principal holds `Execute` on one project. `pools` is the only relation
`execute` follows from, so a pool holds that permit and nothing a person's
relation carries: it cannot read the project's threads or tickets through the
API, cannot propose or dispatch, and cannot widen its own access — the
registration command holds the issuer's admin address and the plane a pool polls
holds none.

With `Execute` a pool claims work whose required capabilities its declaration
covers, and mints a forge credential for any repository the project binds
(`src/interpreter/forgeCredentials.ts`). Both are revoked by taking the relation
back; the row the registry keeps is who the caller is and never what it may do,
so a revoked pool stops being admitted without anything being deleted
(`src/interpreter/workerPool.ts`).

**The pool's host sees everything the harness sees.** This is not a gap waiting
on a fix — it is what running the work means. The machine executing a harness
holds the prompt, the ticket's inputs and whatever credential the work was given,
in its own memory and on its own filesystem, and no protocol between chuggy and
that machine can take it back. Keeping ticket content out of the placement
payload and minting git credentials through a callback bounds what the pool's
*backend* sees — a Nomad server, a Kubernetes API, a scheduler's object store —
and bounds nothing about the host.

So registering a pool extends the project's confidentiality boundary to that
machine and to whoever administers it. Two things follow, and they are the
policy rather than a control:

- A pool is registered by people who would be allowed to read the project's
  work themselves, and deregistered when that stops being true.
- A declaration of capabilities is a claim, not a proof. Nothing verifies that
  a pool declaring a token can deliver it, or that a pool runs the isolation its
  operator says it does; work requiring the token is offered on the strength of
  the declaration alone. The declaration is trusted exactly as far as the
  operator is.

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

**Then the scheduler's `capabilities` and `capabilityCredentials`**, before the
work that requires those tokens is released. A deployment's own claimant takes
only what it declares, and work naming a token nothing declares is claimed by
nobody and settled as unavailable once its window passes — so a token that
arrives after the release costs the tickets released in between.
`src/roots/schedulerConfig.ts` carries both fields and the argument for the
ordering.

**Then the pools.** An owner mints a single-use registration token for one
project over the API and an operator redeems it on the machine, or
`src/roots/registerWorkerPool.ts` makes the same writes where the owner is at
the machine already. The client secret is answered once and stored nowhere: a
pool that loses it is registered again.

**Then the release.** The worker image and the orchestrator roll together — the
envelope `src/adapters/runtime/ticketWorker.ts` reads is the one the orchestrator
writes, and a release that moves one and not the other is a worker that cannot
read what it is handed.
