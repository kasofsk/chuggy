# The durability rehearsal

Row D2 of the deployment rehearsal, on the local k3s rig: a real dump of the
rig's PostgreSQL, verified restorable before anything is destroyed; the
database destroyed; the database restored; a fresh recovery epoch established
before anything may mutate what came back; and every owner that was live before
the destruction still holding an epoch that is no longer the one authority is
issued under.

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

## What each stage is evidence for

| Stage | What it establishes |
|---|---|
| `client` | a pod, labelled for the server's network policy, reaching the server as a real client — the address it prints is a pod's, so the session is not the loopback one a port-forward gives |
| `snapshot` | what the live database held, as an inventory the later stages are compared against, and the leases that were live when it was taken |
| `dump` | a custom-format dump and a globals dump, taken by the server's own tooling and written to a host that is not the rig |
| `verify` | that dump restored into a scratch database on the same server, and its inventory compared line for line against the live one |
| `destroy` | `DROP DATABASE`, and the server answering a later connection with the database not existing |
| `restore` | the database recreated from the dump, and its inventory compared against the live one again |
| `epoch` | an epoch already on record refused by the server, a fresh one established, and a diff showing that the only thing the database did between coming back and that establish was record the epoch |
| `fence` | every restored lease carrying an epoch that is not the current one, and the runtime role refused the write that would let it mint its way out |

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
recovery epoch is never reused, because the server refuses an epoch already on
record rather than the script deciding it is a repeat. That a fresh epoch can
be established before any other write, because the inventory taken immediately
after the restore and the one taken immediately after the establish differ by
exactly the epoch row. That no lease the restore brought back carries the
current epoch. That the runtime role cannot establish an epoch, which is what
stops a stranded writer from unfencing itself.

**Proved, but by the durable authority rather than by this script.** That the
stranded owner's append and renewal come back `Fenced`, that a successor finds
the project `HeldByAnother` until the lease runs out, and that the
re-acquisition carries the epoch established after the restore. Those are
decisions the adapter makes by comparing the current epoch to the one the lease
carries, and the operations-inbox slice carries both the adapter and the suites
that assert them. What this rehearsal adds is that the comparison's two inputs
really do diverge across a real dump, a real destruction and a real restore,
rather than across an epoch advance standing in for one. Neither half is the
claim on its own.

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

`docs/design/006-durable-project-dispatch.md` says acknowledged commits have no
expected loss under process, instance and zonal failure. Nothing here is
evidence for any of that, and the rehearsal must not be read as if it were. The
deployment rehearsal's own design doc says why: that sentence is a claim about a
production deployment's failure domains rather than an invariant any code
satisfies, and it is bought at the apply.

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
credential material and a copy of the record, and nothing in this row encrypts
it, rotates it or expires it. Where a deployment keeps a backup and who may
read it is the secret source's question and not this rehearsal's.

## Undoing it

`teardown` removes the client pod and the scratch database, and deliberately
leaves the archive alone. Nothing else on the cluster or the host is created or
altered: no namespace, no secret, no policy, no manifest, and nothing on the
node.

The archive is removed by hand, because a script that offered to delete the
only copy of a database would be offering the one mistake this procedure is
built to prevent.

```sh
rm -rf "$CHUG_RIG_ARCHIVE"
```

The epoch the rehearsal established is not undone. Removing it would be reusing
a superseded one, which is the single thing the mechanism exists to refuse.
