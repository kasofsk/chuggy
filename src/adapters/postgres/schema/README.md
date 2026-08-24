# PostgreSQL schema invariants

The relations the PostgreSQL foundation owns, as the migrations that create
them.

issue #180 requires 5 things of every
new mutable relation, so each one states them here rather than in a doc that
would drift from the DDL beside it.

`recovery_epoch` — the global, unpredictable, never-reused epoch a restore
advances before it permits any mutation. Owned by the control plane; the
ticket-service role may read it and may not write it, because a runtime that
could mint an epoch could unfence itself. It has no project key by design:
it is global authority, and a per-project counter restored from the past is
exactly what it exists to defeat. Identity is the epoch text, unique, so a
replayed establish is refused rather than absorbed. It is changed by
`establishRecoveryEpoch` alone, appending one row. Unfinished work after a
restore is found by comparing the current epoch to the one every live lease
and journal entry carries.

`project` — one authoritative lifecycle and ownership row per partition.
Owned by the control plane for insertion and by the ticket-service role for the
ownership columns, which is why the runtime is granted UPDATE and not
INSERT: provisioning is not a decision. Its composite key is
`(tenant, project)` and it is the parent every other relation here points
at. Ownership is changed by `acquire`, `renew`, `release` and `fence`, each
locking this row; the head is changed only by the decision transaction, in
the same transaction as the entry it counts. Unfinished work is found by selecting
active projects whose lease has expired by database time.

`journal_entry` — the append-only decision log, partitioned by the composite
key it carries into its own primary key `(tenant, project, seq)`. The
ticket-service role is granted INSERT and SELECT and deliberately not UPDATE or
DELETE: a runtime that could rewrite history would make replay an opinion.
Its identity is that primary key, and `seq` is the project's head plus one,
so the identity and the concurrency control are the same value. It is
changed by the decision transaction and by nothing else. Unfinished work
does not exist for it — an entry is committed or it was rolled back — which
is the whole point of putting the head in the same transaction.

WHY THE FENCE COLUMNS RIDE ON THE ENTRY. An entry records the owner, fencing
epoch and recovery epoch that authorized it, so a takeover or a restore can
be audited from the log rather than reconstructed from process memory. They
are not read back during replay: the domain event is the entry text, and
these are the envelope 006 keeps outside the pure event.

THE DIGEST CHAIN IS STRUCTURAL AND ARRIVES NOW rather than when integrity
containment does, because 006 makes this the production format version one
and a chain added later is a migration over authoritative history.

`project.ingress_next` — the per-project ingress counter, a column on the
lifecycle row rather than a relation of its own because 006 has acceptance
lock that row and allocate the ordinal in the same statement, and two rows
would be two locks with an order to get wrong. Owned by the API role, which
is granted UPDATE on this column and no other: allocating an ordinal is not
a licence to move the head, the owner or the lifecycle. It is changed by
acceptance alone, whose conditional UPDATE also decides admission, so a
lifecycle transition committing first leaves the counter untouched.

`operation` — one accepted mutation, its authority, its idempotency scope
and its terminal state. Owned by the API role for insertion and, from the
decision transaction onward, by the project ticket writer for its outcome. Its
composite key is `(tenant, project)` and it points at
`project`; its identity is `(tenant, project, operation)` with the opaque
operation identity unique globally, because 006 mints those outside any
partition and a reused one would answer another project's poll. Its
idempotency key is `(tenant, project, authority_kind, key_digest)`, unique
and permanent, which is what makes a retry find its original rather than
create a second. It is changed by acceptance, by cancellation and by the
decision transaction, and a trigger refuses any later change at all to a row
already terminal. Unfinished work is found by selecting `Pending` operations
for a partition.

WHY NO ROLE MAY WRITE A SETTLEMENT, BY EITHER VERB, AND CANCELLATION IS A
FUNCTION. 006 lets the API insert authorized operations and decide none of
them, and allows one narrowly constrained transaction to move a
still-pending operation to cancelled. A grant on the column is not that
constraint, and the hole has two halves. `UPDATE operation SET state =
'Succeeded'` on a pending row satisfies every column-level grant a
cancellation needs, and the terminality trigger cannot refuse it because the
row it fires on is not yet terminal. A table-level `INSERT` is the same hole
spelled the other way: the settlement columns are columns like any other, no
CHECK refuses a row born `Succeeded`, and a `BEFORE UPDATE` trigger never
runs on an insert. So the API role holds no `UPDATE` on this relation at
all, its `INSERT` names the columns acceptance writes and not one more, and
cancellation is a `SECURITY DEFINER` function it is granted `EXECUTE` on — which also makes the transition, the settlement
columns and the inbox flag one call rather than three grants that only
together add up to a cancellation. A role-aware trigger would be the other
shape and it is broken in deployment: a service connects as a login role
that inherits `chuggy_api`, so `current_user` names the login role and the
check never fires.

WHY THE IDEMPOTENCY TOMBSTONE IS THIS ROW AND NOT A SECOND ONE. The scope,
the key digest and the payload digest belong to exactly one operation, and
standing rule 3 rejects the copy a second relation would keep. 006 compacts
a terminal operation's command body while the tombstone survives, which is a
change to this row rather than a row that outlives its parent — and
`command` is `NOT NULL` until the slice that compacts one makes it nullable,
because weakening a constraint for a caller that does not exist yet is
reaching forward into that slice.

`inbox_item` — the project's durable inbox, in the ordinal order acceptance
allocated. Owned by the API role for insertion and, through the cancellation
function alone, for making an item non-consumable, and by the ticket writer
role for the acknowledgement that does the same on the way out. Its composite key is `(tenant, project)`, its
identity is
`(tenant, project, ordinal)`, and its source key `(tenant, project,
operation)` is unique, which is the deduplication 006 requires before
ordinal allocation — every item I1 admits is an accepted operation's, and
a second source kind arrives with the slice that has one. It is changed by
acceptance, by cancellation and by the decision transaction. Unfinished work
is found by selecting
consumable items for a partition in ordinal order, which is also what
activation verifies the inbox with.

`project_readiness` — the discovery index over that inbox, and the only
thing fleet discovery reads. Owned by the API role, whose grant covers
`ready` and `generation`, and by the ticket-service role, whose grant covers
`ready` alone — so the separation the server holds is by column, and which
direction either role may move a column it holds is this adapter's. Its
composite key and identity are both `(tenant, project)`. It is changed by
acceptance, which raises readiness and advances the generation, and by an
idle owner clearing it. Unfinished work is found by selecting the ready rows
across the fleet.

WHY THE ROW IS NEVER DELETED AND THE GENERATION IS ONLY ADVANCED. Clearing
lowers a flag rather than removing the row, because a generation that
restarted at one would let an owner holding a stale one erase the wake-up
that reused it — the stale observation the generation exists to refuse. That
is a discipline every writer here keeps rather than a rule the server
applies, and the note beside `inboxGrants` says what the grant permits
instead.

`journal_entry.cause_operation` — the one durable cause an entry names, with
its uniqueness over the partition. 006 lets a cause authorize at most one
effective journal decision, and that constraint is what prevents a second
entry when a commit whose result the writer never learned is retried. Every
cause this tree admits yet is an accepted operation's, so the column names the
operation rather than a kind and an identity; the typed cause kind arrives
with the slice that has a second one.

`operation.outcome_code`, `operation.decided_seq`,
`operation.refused_head`, `operation.refused_lifecycle_generation` — what a
terminal operation says besides its state, and the columns the earlier
tranche deferred to the transaction that produces them. They are written by
the project ticket writer alone, in the decision transaction, and neither is a
duplicate of anything derivable: a client reads the sequence to read its own
write, and a writer resolving an ambiguous commit reads whichever of them
the recorded outcome carries.

`ticket_projection` — the project-primary projection, one row per ticket,
carrying the sequence that produced it. Owned by the ticket-service role, which
is granted INSERT and UPDATE on the phase and the sequence and not on the
key. Its composite key is `(tenant, project)` and its identity is
`(tenant, project, ticket)`. It is changed by the decision transaction and
by nothing else, and it has no unfinished work of its own: it commits with
the entry that moved it, and it is rebuilt from the journal rather than
repaired.

WHY A PROJECTION AT ALL, WHEN STANDING RULE 3 REJECTS A STORED DUPLICATE.
Because the fact it duplicates is derivable only by replaying a project
partition into memory, and 006 requires normal reads to use PostgreSQL
rather than enter the in-memory actor. It is explicitly not a second
semantic authority: nothing decides from it, and a disagreement between it
and a replay is the projection being wrong.

WHY THE TICKET WRITER READS `operation` AT ALL. It decides one, so it reads the
command it carries and the state it is in; the read is table-wide because a
column-level SELECT makes every query name its columns and the row it may
not read is one this partition's own writer already holds the journal for.

WHY THE TICKET WRITER MAY WRITE A SETTLEMENT WHERE THE API MAY NOT. The API
accepts work and decides none, so a grant that let it settle an operation
would be a grant to decide one — which is why cancellation is a function.
The `ProjectTicketWriter` is the single writer: settling an operation is its own
authority rather than a boundary it would be crossing, and a domain refusal
settles one with no journal entry to pair the write against, so there is no
pairing a constraint could enforce.

WHY A TENURE CANNOT BE REINSTATED BY HAND. The ticket-service role needs UPDATE
on `owner`, `fencing_epoch` and `lease_expires_at` because any replica may
acquire a partition, and those columns are also what it takes
to write a fenced owner back into an active project (kasofsk/chuggy#115). A
grant cannot say which values a column may take, so the rule is the server's
own: the fencing epoch never moves backwards, and any update leaving a live
lease that is not the continuation of the live tenure already there must
advance it. Acquisition advances it, renewal continues one, release and
fencing leave none — so the adapter is unchanged and the composed statement
is refused.

`FinalizationResult` IS NOT A COMMAND THE MAILBOX TAKES FROM A CALLER. The
public grammar keeps the event out of a `Decide` the way it has always kept
`ReleaseTicket` out, and `submit_finalization_result` writes its own envelope
naming the request, its generation and the epoch instead — so the event a
writer journals is one it derives from durable rows rather than one anybody
supplied. `public_ticket_command_is_valid` is the grammar migration 5
wrote, unchanged and renamed, and the validator of that name is now the
wrapper around it that both rules live in.

WHICH LOCKS THIS FILE'S BODIES TAKE. `submit_finalization_result` takes two —
the finalization request it is answering, then the project whose mailbox it
writes into — and `request_finalization_approval` takes the first of those
alone, both in the global order `src/interpreter/finalizer.ts` declares.

WHY AN APPROVAL SUPERSEDES RATHER THAN QUEUES. `native_action_one_open`
admits one open action per ticket, and the revision fence prepares again when
the observed target moves, so the ask a person is holding is about a
candidate that no longer exists. Withdrawing it is what keeps that invariant
and the question in agreement, and it is the same `Withdrawn` a phase exit
writes. The uniqueness the same relation carried over an effect position
moves with it: an effect materializes one action, and an approval no effect
produced is unique by the attempt it names instead.

A QUESTION AND ITS ANSWERS ARE ONE ROSTER, AND THE SERVER HOLDS THEM TO IT.
`src/interpreter/ticketCommand.ts` pairs each action kind with the answers it
admits, and `native_action_resolution_pairs_with_its_kind` refuses a row
offering the other kind's answer — which a CHECK cannot see, because the kind
is on the action and the answer is on a row of its own.

AN ANSWERED OPERATION IS TERMINAL WITH NO ENTRY BEHIND IT. `Approve` and
`Decline` name no domain command, so the input that carried one settles
`Answered`: the state a decision input reaches without a decided sequence, and
the one public operation state that carries no sequence for a client to read.
