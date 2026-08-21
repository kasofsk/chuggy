# The durability rehearsal

Row D2 of the deployment rehearsal, on the local k3s rig: a real dump of the
rig's PostgreSQL, verified restorable before anything is destroyed; the
database destroyed; the database restored; a fresh recovery epoch established
before anything may mutate what came back; and one nominated lease — live, and
under the epoch that was current when the dump was taken — coming back out of
that dump unchanged and superseded, while its term has still not run out.

`rehearse.sh` is the procedure, one stage per verb, and this is the reading of
it — what each stage is evidence for, what it is not evidence for, and how to
put the rig back.

## Run it

```sh
CHUG_RIG_ARCHIVE=<a directory that is not on the rig> \
  ./deploy/rig/durability/rehearse.sh client
```

then `snapshot`, `dump`, `verify`, `destroy`, `restore`, `epoch`, `fence`,
`teardown`, in that order. The stages are separate verbs rather than one run
because the interval between `destroy` and `restore` is the one an operator
should be able to stop in, and because `verify` is the stage whose verdict the
next one depends on.

`CHUG_RIG_ARCHIVE` has no default. Between `destroy` and `restore` the archive
holds the only copy of the database, and a script that picked the directory
would be picking where a database lives while it does not exist anywhere else.
`destroy` refuses to run unless `verify` has left a receipt in that directory
naming the digest of the dump that is actually there.

`rehearse.test.sh` is the suite, and its own header names what it covers and no
more. It runs against a stub `kubectl`, and the cases whose subject is a refusal
that comes first require that nothing reached it.

```sh
./deploy/rig/durability/rehearse.test.sh
```

## What the rig has to be holding first

`snapshot` refuses unless the database already carries a **witness**: a project
under an unexpired lease, taken under the recovery epoch that is current at the
moment `snapshot` runs. It writes that lease down, and the later stages are
about that row.

Without one, `fence` has nothing to say. Its predicate — no held lease carries
the current epoch — comes true the instant a fresh epoch is minted, whether or
not anything was dumped, destroyed or restored, and a rig that has been
rehearsed against before is mostly leases superseded long ago, which satisfy it
for free. The witness is the one member the predicate is not free over: it was
live and under the current epoch going in, so it is the row whose standing the
operation actually changed. Supersession is still not evidence of a restore on
its own — nothing in this procedure writes `project.recovery_epoch`, so the
witness carries the epoch it was dumped under either way. What discriminates is
the pair: `restore` requires that row back out of a database that did not exist
a moment earlier, compared whole against what `snapshot` wrote down, and
`fence` requires it superseded with its term still running.

Nothing here arms a witness, and that is deliberate: a control that
manufactures the evidence it then checks is not a control. What takes a lease
is the durable authority, whose adapter is not in this tree yet — see below.

## What each stage is evidence for

| Stage | What it establishes |
|---|---|
| `client` | a pod, labelled for the server's network policy, reaching the server as a real client — the address the server reports for the session is required not to be the loopback one a port-forward gives |
| `snapshot` | what the live database held, as an inventory the later stages are compared against; the leases that were live when it was taken; and the witness, picked out of them and written down |
| `dump` | a custom-format dump and a globals dump, taken by the server's own tooling and written to a host that is not the rig |
| `verify` | that dump restored into a scratch database on the same server, and its inventory compared line for line against the live one |
| `destroy` | `DROP DATABASE`, the row required gone from `pg_database`, and a later connection asking for the database by name required to come back refused |
| `restore` | the database recreated from the dump, its inventory compared against the live one again, and the witness row required back out of the dump exactly as it was written down |
| `epoch` | an epoch already on record refused by the server, a fresh one established, and the post-establish inventory required to be the pre-establish one plus a row in `recovery_epoch` and nothing else |
| `fence` | the witness superseded by the new epoch with its term still running, its row still the one the dump held, every restored lease carrying an epoch that is not the current one, and the runtime role refused the write that would let it mint its way out |

The inventory is the comparison the verification rests on, so what is in it
matters: the relations and their kinds, their owners, the routines and whether
each is `SECURITY DEFINER`, the triggers, every constraint by name and kind,
every column privilege by grantee, and a row count per table. The row counts
are asked for through the catalog rather than from a list of tables in the
script, so a migration that adds a relation is covered without the script being
edited.

## What is proved, and what is only exercised

**Proved on a real server, by this procedure.** That a dump of this database
restores into a database with the same inventory, taken before the original was
destroyed. That `DROP DATABASE` removes it. That the dump restores it. That the
witness lease comes back out of that dump carrying the owner, project-local
fencing epoch, head and expiry it was written down with, and that the epoch
established after the restore supersedes it while its term has still not run
out — which is the state a stranded writer is in. Only the two together tell a
restore apart from an epoch advance; neither does on its own. That no lease the
restore brought back carries the current epoch. That the recovery epoch is
never reused, because the server refuses an epoch already on record rather than
the script deciding it is a repeat. That the runtime role cannot establish an
epoch, which is what stops a stranded writer from unfencing itself.

**Proved as far as an inventory of row counts reaches, and no further.** That
between the restore and the establish the database gained a row in
`recovery_epoch` and changed nothing else the inventory holds — relations,
owners, routines, triggers, constraints, grants, and a count per table. That
comparison is asserted rather than printed: the expected post-establish
inventory is derived from the pre-establish one and required to match it, so a
run in which the database did other things fails instead of printing the same
success line. What the inventory cannot see is an `UPDATE` of a row already
there, which changes no count — and a mutation of the ownership row in that
window is exactly what
issue #180 exists to close. For the witness
that hole is shut, because `fence` reads its row again after the establish and
refuses if anything about it moved. For every other row it is open, and this
procedure does not close it.

**Not proved here at all, because this procedure never asks for it.** That the
stranded owner's append and renewal come back `Fenced`, that a successor finds
the project `HeldByAnother` until the term runs out, and that the re-acquisition
carries the epoch established after the restore. Those are decisions the durable
authority makes by comparing the current epoch to the one the lease carries.
**The adapter that decides them is on main and its suites run under
`.chug/tasks/check-postgres.sh`**, but nothing in `rehearse.sh` calls either: no
stage appends, renews or acquires. So a reader who runs the documented procedure
gets the two inputs to that comparison and never the comparison itself, and a
stage that acquired under the restored epoch is what would close it. What the procedure does carry is that those
inputs really do diverge across a real dump, a real destruction and a real
restore rather than across an epoch advance standing in for one, and the
witness is where that is carried. Neither half is the claim on its own.

**Exercised, not proved.**

- **The credentials, on every connection but the durable authority's.** Every
  stage here connects from a client pod with the role's own password, so the
  server checks a SCRAM verifier. A session opened through `kubectl
  port-forward` would not: the forward is served inside the server pod's
  network namespace, the server sees the loopback address, and the stock
  image's `pg_hba.conf` trusts it whatever password is offered.
- **Reachability.** The client pod carries the label the network policy admits,
  and it is labelled after it is running because the policy controller learns a
  new pod's labels on its own schedule. That the pod gets in is not evidence
  that the policy is what let it in.
- **The globals.** `dump` takes a `pg_dumpall --globals-only` beside the
  database dump, and nothing restores it, because the destruction here is the
  database's and the roles survive it. It is there so the archive is enough to
  rebuild from a loss that takes the cluster with it.

## What a single node cannot establish

issue #180 says acknowledged commits have no
expected loss under process, instance and zonal failure. Nothing here is
evidence for any of that, and the rehearsal must not be read as if it were.
That sentence is a claim about a production deployment's failure domains — how
many independent things have to fail together before an acknowledged commit is
lost — rather than an invariant any code satisfies. It is bought by what a
deployment replicates across, at the moment it is applied, and not by anything
a program does. This rig has one node, so it has one failure domain, and no
procedure run against it can establish that claim any more than it can conjure
the second machine.

What this rig leaves untouched, said plainly:

- **The storage was never lost.** The destruction is `DROP DATABASE` against a
  server that stayed up on a volume that stayed bound. A lost volume is a
  different recovery — the globals dump, an initialised server, and then this
  dump — and it is not what ran.
- **One node, one server, no replica.** There is no standby to fail over to,
  no second copy of the write-ahead log, and no second machine. Recovery here
  costs the whole interval since the dump, which is the opposite of the
  property 006 is claiming for production.
- **No point in time but the dump's.** This is a dump and restore, not a
  point-in-time restore: there is no archived write-ahead log to replay
  forward, so the only recoverable instant is the one the dump was taken at.
  006's argument about the epoch does not depend on which instant that is —
  what it needs is that the counters come back from the past and the epoch does
  not — but the recovery objective a production deployment would quote is not
  something this rig measures.

## What it costs the database it runs against

The rehearsal is not read-only and does not pretend to be. It leaves behind a
recovery epoch that did not exist before, and the identity of a second one that
was consumed by the refused establish and will never name a row. `fence` leaves
nothing: the write it attempts is refused. A rehearsal driven by the durable
authority — the part this script does not do — also leaves the project it armed
and the entry its successor committed.

Every one of those is a fact about a database that already carries a gate run's
residue, and none of it is something to point at a database anyone depends on.

## The dump is a secret

`globals.sql` carries `CREATE ROLE` with each login role's SCRAM verifier, and
the database dump carries everything in the database. The archive directory is
credential material and a copy of the record.

So `rehearse.sh` creates it readable and writable by its owner alone, at a mode
the ambient umask cannot widen, and an archive that already exists is checked
against that mode rather than trusted — one the rest of the host can read is
one it refuses to write a verifier into. Nothing beyond that: this row does not
encrypt the archive, rotate it or expire it. Where a deployment keeps a backup
and who may read it is the secret source's question and not this rehearsal's.

## Undoing it

`teardown` drops the scratch database, reads `pg_database` back to require it
gone, and then removes the client pod. Where no session can be opened to drop it
— a second teardown, or a client pod that has already slept out its command —
it says so rather than claiming the drop. It deliberately leaves the archive
alone. Nothing else on the cluster or the host is created or altered: no
namespace, no secret, no policy, no manifest, and nothing on the node.

The archive is removed by hand, because a script that offered to delete the
only copy of a database would be offering the one mistake this procedure is
built to prevent.

```sh
rm -rf "$CHUG_RIG_ARCHIVE"
```

The epoch the rehearsal established is not undone. Removing it would be reusing
a superseded one, which is the single thing the mechanism exists to refuse.
