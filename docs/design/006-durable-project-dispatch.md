# Durable project dispatch

**Status: M0, G0, I0, I1, I2, I3 AND I4 LANDED** — issue #92 agreed these decisions and
the tree carries the rows the table below marks landed: `model/` proves
the project-scoped `Core`, `src/generated/model-api.ts` is generated from
`model/api.qnt`, and `src/adapters/postgres/` holds the lifecycle row, the
ownership lease, the authority-scoped operation with its permanent
idempotency, the ingress ordinal, the durable inbox and the readiness
generation that indexes it, and the decision transaction that fences a writer,
writes the entry under its one durable cause, settles the operation,
acknowledges the item and moves the primary projection, under
`.chug/tasks/check-postgres.sh`. I6's execution service is written too — its
migration, its scheduler adapter and its one completion boundary are driven
against a real server under that same gate, and the briefing a launched worker
is handed composes above them — so its row waits on review rather than on code.
The selection service is not built, so the body below still argues it. The
revision fences a decision rechecks arrive with the slices that have a revision
to name.

Clients submit authenticated mutations to a durable PostgreSQL inbox. They do
not locate or call a ticket-service process. A successful submission creates an
asynchronous operation; a `ProjectTicketWriter` later evaluates it at the project's
serialized position. PostgreSQL is the durable authority, while Kubernetes
places and supervises processes and workloads.

## Project is the serialization boundary

Each project owns one `Core`, one ordered journal and one active writer.
Different projects may decide concurrently, including projects belonging to the
same tenant. Project-scoped ticket writers are multiplexed across a shared
runtime fleet: one replica may host many active project writers, but each writer
loads and mutates only its project partition. There is no pod per project and no
installation-wide decision loop.

A hot project remains intentionally single-writer. Slow external work stays
outside its decision loop, task execution scales independently, and transaction
latency, mailbox depth and oldest-input age are measured. The system first
optimizes decisions, adjusts product project boundaries or introduces a
model-led batch transition for a measured hot path; it does not transparently
add concurrent writers inside one project. The guarantee is that one project
does not serialize another, not unlimited mutation throughput within a project.

The initial `Core` retains complete ticket and task history. Snapshots reduce
replay work but do not compact memory. Measured project bytes, ticket count,
retained task history and decision latency drive explicit safety ceilings which
block new growth or dispatch before memory becomes unsafe while still allowing
revocation, completion and cleanup. Accepted or journaled history is never
dropped. Terminal-ticket compaction is a later model-led optimization with
trace-equivalence evidence, not an initial abstraction.

Every decision transaction is confined to one `(tenant, project)` partition.
Tickets remain in the project that created them, and ticket dependencies are
strictly project-local. The command envelope, rather than a release payload,
selects the authenticated project partition. Composite storage keys retain the
tenant and project at every mutable seam.

Project-owned resources are exclusive to one project. Initially each project
owns exactly one repository, and configuration revisions, credentials,
workspaces, artifacts and native action records likewise cannot be shared or
referenced across projects. A user may be a member of several projects, but
that grants separate access to each rather than creating shared project state.
Shared control-plane infrastructure and tenant-level capacity accounting are
explicit services above this ownership boundary, not project resources.

Tenant and project use globally unique opaque identities. Ticket identity is
project-local, and task identity is ticket-local; every API, storage, effect,
completion, log and trace boundary carries the enclosing composite identity and
never accepts a bare ticket or task ID. Infrastructure correlation resources
such as operations, executions and selector decisions may use globally unique
opaque identities. No global ticket allocator or second public ticket identity
is introduced.

The native draft receives its never-reused project-local ticket ID at creation
and retains it through release, retention or deletion. Abandoned drafts may
leave gaps. `ReleaseTicket` inserts that existing identity into `Core`; journal
sequence records release order. Dependencies must already be released in the
same project, so acyclicity follows from history rather than numeric ticket
ordering, and cascade logic uses graph traversal rather than an ascending-ID
pass. Ticket-local task IDs remain monotone model-minted identities.

This sparsity is global to the ticket model: bounds constrain map size rather
than maximum ID; `Core` never mints a ticket ID; every traversal uses actual
keys; and sorting is only deterministic presentation. Dense-ID invariants and
numeric-order proof premises leave the model, generators, shrinkers, fixtures
and implementation. Dependency closure uses a bounded fixpoint/worklist, with
tests covering gaps and edges from a lower ID to an already-released higher ID.
Task IDs alone remain dense and monotone within their ticket.

Deleting an unreleased draft leaves a minimal tombstone for its ticket ID, so
the ID is never reused and a stale release request cannot resurrect the draft.
A released ticket is never physically deleted on its own. It may be revoked
and hidden or archived in the product, but its journal, dependency history and
artifact provenance remain authoritative until the whole project is erased by
the project-deletion lifecycle.

Archival is native product presentation metadata outside `Core`. It does not
change dependency validation, eligibility, dispatch, retention or replay, and
an archived ticket may be referenced exactly as if it were unarchived.
Revocation is instead an authoritative domain state. Releasing a new ticket
with an already-revoked dependency is refused because that dependency cannot
become satisfied.

Release may otherwise reference an already-released dependency in `Pending`,
an active phase, `Escalated` or `Done`. Graph admission is distinct from
readiness: a ticket is eligible only after every dependency is `Done`, while an
`Escalated` dependency may still recover. If a dependency is later revoked,
the existing dependency-revocation cascade moves its nonterminal dependents to
`Escalated` rather than allowing them to become eligible.

Revocation propagates across the complete transitive downstream closure as one
atomic domain decision. Every affected nonterminal ticket moves to
`Escalated`; observers see either the complete cascade or none of it. `Done` is
absorbing and cannot later be revoked, so an active ticket cannot lose a
prerequisite after legitimately becoming eligible. Project-size ceilings bound
the transaction cost. A future need to batch cascades requires an explicit
safe revocation-in-progress design rather than exposing a partial graph.

An escalation caused by a revoked dependency is irreversible for that ticket:
`ResumeTicket` refuses it because the prerequisite can never reach `Done`. The
user may revoke the dependent and create a replacement with corrected
dependencies. Other escalation reasons remain resumable only under their typed
rules. The ticket writer never mutates a released ticket's dependency graph to
repair the condition.

Release freezes the complete execution-relevant ticket contract: dependencies,
resolved configuration, repository base, acceptance criteria, task policy and
artifact inputs. Those fields cannot be edited afterward. A correction revokes
the ticket and releases a new ticket, which may carry a non-semantic successor
link. Presentation-only metadata may remain editable outside `Core`, but it
must not influence selection, execution, evaluation or finalization; any
field that does belongs in the immutable released revision.

`ReleaseTicket` names the expected native draft revision. Its transaction locks
the draft and refuses a changed, deleted or already-released revision. It
validates and freezes exactly that revision, appends the first ticket journal
entry and marks the draft released atomically. Identical concurrent requests
converge through operation idempotency; different keys produce one success and
an `already_released` refusal that identifies the ticket and release sequence.

Release preparation performs Git, blob, template and policy reads outside the
project decision transaction and produces an immutable candidate bundle with
all input identities, versions, digests and provenance. The short writer
transaction verifies the expected draft and authoritative input revision
fences, then atomically stores or pins the bundle, appends `ReleaseTicket` and
marks the draft released. A mismatch follows an explicit bounded stale-input
policy; external I/O and partially resolved release state never enter the
decision transaction.

Automatic preparation retries preserve the semantic identities selected at
submission. Mutable aliases such as a template's latest version or a repository
branch are resolved to expected concrete identities; replacement or digest
drift yields `release_input_changed` and requires review and resubmission.
Current mandatory safety policy may block the commit but cannot silently
rewrite the contract. Only provably non-semantic infrastructure metadata may
change across a transparent retry.

A draft is releaseable only when every semantic reference is concrete and
immutable. Authoring conveniences may resolve a branch head or latest template
while saving a reviewed draft revision, but release itself accepts only commit
hashes and immutable revision identities. Refreshing an alias creates a new
draft revision that requires review; release needs no mutable lookup or preview
token.

Before commit, preparation copies every non-repository input into
project-owned, content-addressed immutable staging storage under an
operation-scoped retention lease. The decision transaction verifies the
recorded digests and atomically creates permanent project references with
`ReleaseTicket`. Terminal unsuccessful operations leave only staged objects,
which are garbage-collected after a conservative retention window. Released
repository commits are pinned in the project's exclusive repository. Missing
objects prevent release rather than surfacing later during execution.

Cancellation and release commit lock the same operation row. If cancellation
wins, preparation may finish in-flight I/O but cannot promote objects or invoke
`ReleaseTicket`; workers observe cancellation opportunistically to save work.
If release wins, cancellation is refused and the resulting ticket must be
revoked separately. Correctness does not rely on promptly interrupting a
preparer, and cancelled-operation staging cleanup is idempotent.

Release failures preserve the boundary between domain refusal and
infrastructure retry. Invalid or incomplete configuration, missing immutable
inputs, digest mismatch, unsupported versions and changed selected inputs are
terminal `Refused` outcomes with stable codes and evidence. Temporary Git,
PostgreSQL, object-storage, policy-service or preparer outages leave the
accepted operation `Pending` and retry with bounded backoff. The bound limits
retry frequency and resource consumption, not durability: the operation
remains until success, deterministic refusal, user cancellation or explicit
administrative resolution. Repeated failure alerts operators and appears in
project diagnostics; an infrastructure timeout is never reclassified as a
domain refusal.

Pending release preparation is at-least-once. An operation has a renewable
preparation lease and monotone preparation generation; takeover follows lease
expiry. Content-addressed staging makes overlapping writes idempotent. A
candidate may be published only while the operation remains `Pending` and its
generation is current, so a stale worker may finish I/O but cannot invoke the
project writer. Lease expiry is recoverable coordination state, and only the
project writer can commit `ReleaseTicket`.

PostgreSQL metadata is authoritative for staging-object liveness. Promotion and
garbage-collection marking lock the same reference row. Promotion accepts only
`Staged` and creates the permanent reference atomically with release; GC changes
an expired unreferenced object to `Deleting`, after which preparation must
restage it. Physical deletion follows a grace period and is idempotent. Object
store listings alone never establish liveness, and metadata-free orphan blobs
are swept only under a longer safety window.

Administrative resolution cannot fabricate domain truth. An authorized
operator may cancel a `Pending` operation through the ordinary cancellation
race, recording actor, reason, time and administrative origin. The operator
cannot force `Succeeded`, manufacture `Refused` or append the intended event.
Repairable dependencies are repaired and the original operation retries;
journal repair remains the separate manifest-backed integrity protocol.

During shutdown a pod becomes unready and stops claiming new leases and work,
but may finish an open short decision transaction. Selector calls and monitors
belong to the selector service and do not block ticket-service drain; a proposal
accepted before shutdown is already a durable ordinary operation. Late
proposals must pass their recovery-epoch, view-digest, ticket-version and
current-validity fences. Detached preparation calls remain recoverable from
their durable request state. Opportunistic lease release improves takeover;
lease expiry and database fencing provide correctness. A forced kill rolls
back an incomplete transaction, while Kubernetes lifecycle hooks affect
latency only.

The public operation state is limited to `Pending`, `Succeeded`, `Refused` and
`Cancelled`. Pending responses may include coarse non-authoritative progress,
an update time and optional retry-after hint, but no ETA or internal lease,
generation, provider or stack details. Success returns the resulting project
sequence and resource links; refusal returns a stable safe code and decision
evidence. Every response carries operation identity and acceptance time.
Progress is operational metadata rather than journal state, and polling—not
lossy SSE—is canonical.

Operation reads, SSE and cancellation reauthorize current project access. A
caller without access receives the same not-found-style response as an unknown
operation, preventing identifier probing. Elevated audit access is an explicit
permission. Losing access does not alter accepted intent, and result
notifications recheck authorization before including details. Audit retains
the original actor identity subject to the privacy and retention policy.

Durable audit records store a non-reassignable internal actor subject and
authority context, not copied profile data, tokens or credentials. Authorized
views resolve current human-readable identity from the identity directory.
Account deletion removes or pseudonymizes that mapping while history displays a
deleted-user marker. Exceptional legally required erasure and separately
governed security evidence follow explicit retention processes rather than
casual journal rewriting.

When a database commit result is ambiguous, the ticket service reconnects and
reads the operation rather than assuming failure. Journal append, operation
outcome, inbox acknowledgement, projections and durable consumer requests are
one transaction. A terminal operation proves the commit; a still-`Pending`
operation retries through the idempotent decision path. Unique cause
constraints prevent a second effective entry. Because the transaction performs
no external irreversible I/O, the rule remains safe through PostgreSQL
failover.

Deduplication is enforced structurally. Journal cause keys are unique over
project, typed cause kind and cause identity; inbox source keys are unique
before ordinal allocation. Focused consumer-request identities derive from the
authorizing journal sequence and effect position. A refused operation writes
its terminal outcome once without a journal entry. A retry that finds an
existing cause returns the recorded outcome and never reruns the decider
against a newer project head.

Ordinary submissions are rejected synchronously before durable acceptance when
retention, backlog, project-size, suspension or integrity limits make safe
retention impossible. This is retryable admission failure, not an accepted
operation's domain refusal. Cancellation, revocation, completion, repair,
safety and administrative reduction paths remain admissible. Once acceptance
returns an operation ID, overload may delay but never discard or retract it.
Rejected idempotency responses are retained for a bounded retry window; only
accepted keys enter permanent project-scoped idempotency retention.

Ordinary admission stops with explicit headroom remaining. Separate storage
and processing reservations protect completion, revocation, cancellation,
integrity and administrative-reduction traffic, with alerts before either pool
is exhausted. A true inability to write durable storage returns unavailable;
workers retain and retry reports. Recovery restores correctness traffic before
reopening ordinary admission.

An `Outstanding` task may have multiple sequential infrastructure execution
attempts without exposing those attempts to `Core`. Each has a distinct
identity and credential, and only one unfenced attempt may report
authoritatively. Lost pods, eviction and similar pre-result failures retry
under a bounded scheduler policy while the one logical task slot remains
occupied. Workers store and verify immutable results before reporting;
duplicates return the recorded result and conflicting digests raise an alert.
Only definitive work failure, exhausted safe retry policy or inability to retry
safely produces the single authoritative `TaskDone(Failed)`. Later domain
rework creates a new task rather than resurrecting an attempt.

Transparent retry is limited to workers whose enforced contract confines writes
to attempt-scoped immutable output storage. They may read the pinned input
bundle but cannot mutate the project repository, deploy, message or alter
external services. Finalization retains its distinct prepare/commit permit
because it can mutate Git. A future effectful task type requires its own
idempotency and reconciliation protocol; ordinary retry safety is enforced by
credentials and network policy, not worker instructions.

Worker result manifests use a strict versioned schema with bounded counts and
sizes, normalized paths and verified digests. Attempt credentials allow only
create-only writes in that attempt namespace. Control-plane services treat
artifacts as opaque and never execute or unsafely render them. Evaluation uses
the same sandboxed bundle boundary, and the finalizer constructs and validates
a candidate in isolation rather than copying a workspace blindly. Resolved policy
may require malware, secret or other scans as recorded evidence. Invalid or
conflicting output fails the attempt and may raise a security alert without
altering project state.

Artifact identity and authorization are project-scoped; raw digests are not a
globally probeable namespace. Initial storage performs no cross-project
deduplication. Access requires a project-owned reference and current
authorization, with short-lived scoped download capability. Encryption,
service credentials, deletion and billing preserve the project boundary, and
logs or metrics do not expose contents or globally correlatable raw digests.

Results distinguish declared handoff artifacts from attempt diagnostics. Only
schema-valid, policy-approved handoffs become authoritative passed-task output
and may enter the exact immutable input bundle of downstream work. Logs,
traces, caches and raw workspaces do not flow through dependencies. Final
ticket output contracts and evaluation or finalization validate required
handoffs; large objects remain project-scoped digest references rather than
journal payloads. New work consumes outputs only from dependencies that
reached `Done`.

Artifacts referenced by journal state, released bundles, handoffs, evaluation
or finalization remain for the project's authoritative lifetime. Replay verifies
their stable project identities and digests without fetching bytes merely to
reconstruct `Core`. Raw workspaces, staging objects, verbose logs and other
diagnostics have shorter explicit retention classes, with bounded audit,
billing, security and failure summaries retained. Ordinary cleanup cannot
break a live authoritative reference; deletion and backup policy cover the
metadata and bytes required to resume or verify authoritative work.

A project's owning tenant is immutable. A cross-tenant move suspends and closes
the source and creates a new destination project identity, importing only
explicitly supported authoring, configuration or repository material after no
active journal work remains. It never rewrites journal partition keys,
historical authority, capacity attribution or unresolved execution identity.

Tenant-wide execution capacity is a separate scheduling authority. It may
coordinate work from several projects without joining their journals or
guarding their ticket transitions. Its slot accounting is modeled separately
in `model/capacity.qnt`, below the ticket grain.

Tenant-wide suspension, deletion, access response and policy rollout are
audited control-plane sagas, never cross-project domain transactions. Admission
may stop immediately at the tenant boundary while each immutable project is
fenced, held or deleted independently with retryable progress. Scheduler
admission observes the tenant hold throughout convergence. Accepted project
intent retains its agreed authority unless explicitly cancelled, and no project
journal is rewritten for tenant policy or capacity changes.

Project creation is a small tenant-control-plane provisioning lifecycle outside
`Core`. It reserves the immutable project and repository identities, creates an
idempotent repository-provisioning request, verifies the exclusive repository
and scoped credentials, and only then marks the project active for ordinary
mutations and ticket-writer acquisition. Failure remains visible and retryable
under the same identities; no ticket journal begins before activation.

## Durable ownership and fencing

PostgreSQL grants time-bounded ownership of an active project to a ticket writer
instance. Acquisition advances a project fencing epoch; renewal preserves it.
Database time determines lease validity. The owner replays the project, creates
one bounded in-process mailbox and retains the project while it is active.
Idle projects may be relinquished and unloaded.

Every authority-bearing lease, credential, callback, preparation, finalization
attempt/permit, signed capability and external-resource label also carries a
global unpredictable recovery epoch. A point-in-time restore creates a fresh,
never-reused epoch before mutation; project-local counters restored from the
past therefore cannot revive authority issued in the lost interval. Old-epoch
work may finish physically but cannot report authoritatively, and lost-window
identities are never recreated. Git refs and orphan uploads are inventoried and
reconciled as external evidence before new authority is issued; ambiguous
projects remain blocked.

Every decision commit checks both the observed journal head and the current
fencing epoch. A former owner therefore cannot commit after takeover, even if
it resumes after a pause. PostgreSQL ownership is the correctness mechanism;
Kubernetes supervision and placement are not. Inputs remain durable while no
owner is active, and any replica may discover and acquire a partition with
pending work.

Fleet discovery reads only durable project-readiness metadata, not other
projects' journals or ticket contents. Acceptance locks the project ingress
counter/lifecycle row and atomically allocates the inbox ordinal, inserts the
operation and inbox item, and upserts a new readiness generation. The inbox is
authoritative and readiness is its discovery index. Activation verifies the
inbox. Clearing readiness locks the readiness row and proves no consumable item
remains, and that lock is what orders it against a concurrent acceptance rather
than letting an idle owner erase a wake-up: an acceptance either commits first,
leaving its item visible to the proof and its generation raised, or it has not
yet reached its readiness upsert and blocks on the lock the clearing holds —
where the proof finds nothing consumable, the clear commits, and the blocked
upsert raises readiness again behind it. A generation additionally refuses a
clear whose
observation predates an acceptance, which matters because that observation is
taken outside the clearing transaction, and is conservative where the operations
accepted since have all been cancelled. A repair
scan detects any inbox-bearing project missing readiness but is not required
for correctness. Optional database notifications reduce latency but never
replace bounded polling of the durable readiness relation.

Project partitioning is logical over shared PostgreSQL tables with mandatory
composite tenant/project keys. It does not create a schema, table, connection
pool or database partition per project. Physical table partitioning, archival
layout and index changes follow measured storage behavior later and cannot
alter project ownership or authorization semantics.

Logical project ownership also holds no dedicated database connection.
Ticket-service replicas use bounded pools and borrow connections only for short
replay reads, ownership operations and decision transactions. Leases live in
durable rows rather than connection-scoped locks. API, ticket service, scheduler,
effect and analytical workloads have separate pool budgets, and pool pressure
limits actor activation before unbounded mailbox growth.

## Submission, authority and operations

The API authenticates and authorizes a structurally valid request before
atomically creating its operation and project-inbox row. Authorization at that
durable acceptance point is authoritative. A later permission change prevents
new submissions but does not reinterpret accepted work; cancellation is a
separate audited operation.

Every project has one authoritative lifecycle row with state and generation.
Acceptance locks it before inbox allocation and checks both its current
generation and the operation-class admission matrix. Ordinary work enters only
in `Active`; explicitly listed correctness-reducing classes may enter other
states. Suspension, deletion and closure lock the same row, advance the
generation and fence the ownership epoch atomically. Thus a racing acceptance
either commits first and must be accounted for or observes the new lifecycle
and creates nothing. Closure cannot enter retention until every earlier
accepted operation is terminal or handled by the deletion protocol.

That frozen authority governs execution only. Reading an operation, reading
resulting project state or cancelling pending intent requires current
authorization. Idempotency lookup still precedes quota rejection but discloses
no existing operation until current access is verified; an unauthorized retry
does not reveal whether its key exists.

Before accepting new work, the API applies bounded payload, rate and pending
backlog limits by principal, project, tenant and control plane. Idempotency
lookup precedes those checks so a retry of accepted work still returns its
operation during overload. Work not yet accepted may receive a retryable
throttle or unavailable result; oversized malformed input is refused. Once
accepted, an operation is never silently dropped or retroactively rejected
because a quota was crossed.

Idempotency is permanent and scoped by project and authority kind. Repeating a
key with the same canonical behavioral payload returns the original operation.
Repeating it with a different payload is an idempotency conflict. Transport
metadata such as tracing does not enter the payload digest. Stored authority
evidence is bounded and excludes credentials.

Client idempotency keys are normalized and stored only as versioned keyed
digests scoped to project and authority kind. Plaintext keys and unkeyed hashes
do not enter long-lived storage, logs, traces or metrics. Rotation retains
lookup support for every key version still referenced by permanent tombstones;
the behavioral payload digest remains a separate value.

Pending operations retain only their typed command or immutable content
references and the metadata needed to decide them. After terminal completion
and its audit period, large or sensitive command bodies may be compacted while
the permanent tombstone retains operation identity, idempotency scope, payload
digest, terminal outcome, decided sequence and bounded audit. Conflicting key
reuse remains detectable without duplicating project-owned authored content
forever.

An operation begins pending and ends succeeded, refused or cancelled. Loss of
an owner, temporary storage contention and other recoverable infrastructure
failures leave it pending. Domain legality is evaluated only by the project
writer at the operation's serialized position.

When project authority is suspended or integrity-blocked, accepted operations
remain pending with a structured visible hold reason rather than being silently
discarded or terminally failed. Users may cancel them. Verified reactivation
reconsiders them in preserved order and still applies resource-version guards;
project deletion cancels them through its explicit lifecycle.

Cancellation is an authorized, idempotent and audited infrastructure transaction
which remains available without a healthy project writer. It locks the target
operation and may mark it cancelled and make its inbox item non-consumable only
while it remains pending. The writer locks and rechecks that same row in its
decision transaction, so whichever transaction wins determines cancellation or
a terminal decision; precomputation and inbox claim are not points of no return.
Cancellation creates no ticket-domain event and is distinct from revoking a
ticket whose lifecycle has already advanced.

User-authored draft edits carry the authoring version the caller observed;
release also names that version and the exact task-configuration revision. A
stale edit or release is durably refused rather than merged or allowed to
overwrite newer intent. Typed command-specific patches are preferred to a
generic patch language. Manual dispatch uses the observed ticket version and
current eligibility; agentic dispatch uses a canonical selection-view digest.
Urgent revocation evaluates current serialized state without requiring a
caller version. These intent guards are distinct from the journal head and
fencing epoch that protect storage concurrency.

Task configuration is authored as immutable project-owned revisions with
canonical content, digest, parent and bounded authorship metadata. Creating a
revision does not change ticket-service state. Attaching one as a draft's current
revision is an authoring operation guarded by authoring version;
the attachment and its history never exist only as an unversioned mutable
pointer.

Every stored revision is structurally valid, bounded, canonicalizable and free
of prohibited secret-bearing fields, but a draft may remain semantically
incomplete. Preflight readiness findings are advisory. Only validation at the
serialized release position is authoritative, and a failure refuses release
without a domain journal entry.

Release names the authoring version and attached configuration revision the caller
observed. At the serialized position, its transaction verifies ownership,
revision and digest, parses and validates the configuration, pins it to the
released ticket and then invokes the pure `ReleaseTicket` decider, which creates
the configured ticket directly in `Pending`. A concurrent edit
therefore conflicts rather than causing release to pin unseen content. Draft
authoring history and state remain outside `Core`; the successful release marks
the native draft released in the same transaction, and the pinned revision
enters the journal envelope and every later concrete execution effect that
needs it. `ReleaseTicket` is the ticket's first domain journal entry.

Release resolves project-authored configuration, implementation template,
applicable tenant policy and approved practices into one immutable project-owned
release revision with canonical digest and source provenance. Later consumers
read that resolved revision rather than mutable sources. Tenant defaults and
platform versions affect future releases, not historical briefing content;
current non-overridable execution safety policy may still prevent an unsafe
launch without rewriting the pinned revision.

If the applicable shared policy revision cannot be read and verified, release
remains pending under a visible policy hold and does not invoke the pure
decider. New execution admission likewise holds rather than guessing or
downgrading safety. Reads, completions, reductions, revocations and other
project decisions continue unless they specifically require unavailable policy;
a shared-policy outage is not a global project freeze.

A successful decision transaction atomically checks ownership and journal
head, appends the journal entry, completes the operation, acknowledges its
inbox item, updates project-primary projections, materializes native actions and
focused immutable consumer requests, and creates any required continuation. A
domain refusal atomically completes and acknowledges the operation without a
journal entry or external-work request.
Memory advances only after commit.

A refused operation retains a stable bounded code, project generation/head at
evaluation, relevant resource and version evidence, applicable configuration
revision/digest, deciding semantics/build and audit metadata. It retains no
arbitrary exception, stack, secret, selector reasoning or duplicate large
payload. Lifecycle illegality, version conflict, invalid release, stale
selection, backlog safety and too-late boundaries remain distinguishable.
Authentication failure occurs before operation acceptance; infrastructure
unavailability remains a visible pending hold rather than a domain refusal.

The transaction locks the project partition row and rechecks active status,
lease by database time, fencing epoch, journal head and every resource revision
used by the pure decision. The decision may be computed before locking to keep
the transaction short, but a failed recheck discards it and reloads state. No
agent, authorization, Git, Kubernetes or other network call occurs while the
transaction is open.

Project-row locking, conditional writes, unique composite identities and
foreign keys provide the initial isolation contract; correctness does not rely
on a globally strongest isolation level or on the lease preventing all races.
Stale head and fencing are typed outcomes. Deadlock, serialization failure,
connection loss and ambiguous commit are retried only after reading the durable
operation and journal identity.

## Mailbox policy and durable continuations

All decision-bearing inputs enter the owning project's bounded mailbox, but
they need not share strict FIFO across authority classes. Revocation and safety
controls, definitive task completions and deterministic continuations may
outrank ordinary user mutations and selection proposals. Acceptance order is
preserved within a class, and aging prevents starvation. This policy changes
latency, never domain enablement or replay.

Acceptance assigns a stable project-local inbox ordinal through a short locked
ingress-counter update separate from the project journal head. Different
projects accept concurrently; same-project operations obtain a precise durable
order without waiting for a ticket writer. Priority and aging may process a later
higher-class item first, while the lowest eligible ordinal wins within a class.
Aborted or cancelled operations may leave harmless ordinal gaps, and an
idempotent retry retains the original operation and ordinal.

A committed decision that enables a required deterministic transition creates
an idempotent internal inbox item in the same transaction. Each continuation is
then a separate journaled decision and transaction. A crash after either commit
therefore loses no automatic progress, and no transaction contains an
unbounded transition chain. A continuation made irrelevant by valid intervening
state is acknowledged as stale; contradictory state is an integrity failure.

Durable scheduling uses persisted deadlines interpreted by database time.
Ownership expiry, retries, idle unloading, alerts and retention remain
operational timers outside `Core`; the independent selector likewise owns its
monitoring and reconsideration clocks. Polling always recovers overdue records,
while notifications and local timers only reduce latency. If time later changes
ticket meaning, expiration arrives as a typed project input and any resulting
transition is journaled. Pure deciders never consult a wall clock.

## Agentic and manual dispatch selection

Deterministic code derives the complete set of legally dispatchable tickets at
one project journal head. The ticket service maintains that normalized current
view as a replayable projection with a watermark and versioned canonical
digest. Bounded deterministic pages expose one complete logical snapshot;
ticket-identity order makes paging stable and expresses no dispatch preference.
Every later page repeats the watermark; if the current projection advanced,
the API returns reset and the selector restarts rather than mixing versions or
requiring retained per-selector snapshots. The projection is an API read model,
never a second eligibility authority.

Automatic selection is exclusively agentic and independently operated. The
ticket service does not ask a selector to choose, schedule its reconsideration,
or own its attempts and deferrals. It transactionally publishes bounded project
change notifications and answers current dispatchable-view reads. The selector
durably tracks those feeds, polls and sets monitors as it chooses, observes
current work and available advisory capacity, and submits a dispatch proposal
only when its internal policy wants work to begin. A missed notification is
recovered by polling; a cursor outside retained notification history resets to
the current view. There is no algorithmic fallback, and selector unavailability
pauses new automatic dispatch while existing tasks, completions, reductions and
revocations continue.

I5 extends the notification vocabulary with `Project`. A lifecycle transition
that changes selector-visible availability publishes it in the lifecycle
transaction, while every journal decision that changes a ticket continues to
publish `Ticket`. Notifications need not enumerate derived eligibility changes:
either kind tells the selector to refresh the complete current view. Polling
still recovers every missed notification.

An agentic proposal names the ticket, its observed ticket version, the observed
view token and a globally opaque selector decision reference. The view token
binds tenant, project, recovery epoch, view schema version, projection watermark
and strict digest. The watermark identifies the observation and its paging
snapshot but is not an expected-head fence. Strict equality covers the complete
eligible candidate set, candidate versions, readiness and every immutable
execution-relevant briefing fact exposed by the ticket service. It excludes the observed journal head,
selector policy and implementation state, timestamps, provider accounting and
fast-moving capacity, queue and cluster observations. The writer reconstructs
the current view from replayed `Core` and the pinned immutable contract
references named by its journal; an unrelated decision may advance the head
without invalidating an equal view, while a recovery-epoch, digest,
ticket-version or eligibility mismatch refuses the proposal as
`SelectionChanged` without a journal entry.

Current lifecycle and integrity controls are rechecked at commit. The existing
ordinary mailbox limits protect proposal acceptance; the scheduler-owned hard
execution-backlog guard becomes authoritative when I6 lands and is not
simulated by I5. Capacity and active-work observations guide the selector but
do not reserve capacity, alter ticket eligibility or become a hidden ticket
service dispatch policy. The execution scheduler remains the only authority
that admits spawned tasks against current capacity.

The selector has a narrow service capability to submit `ProposeDispatch` and
no general ticket-command authority. Its operation enters the ordinary project
mailbox like other authenticated mutations, and only the project writer may
translate it to the existing pure `Dispatch(ticket)` transition after
reconstructing the strict view from replayed state and its pinned immutable
contract references. The selector has no PostgreSQL credential to the
ticket-service schema. Losing a connection, restarting, observing a stale view
or waiting deliberately affects latency only; the selector decides
independently when to observe or propose again.

Selector calls consume neither ticket gas nor execution-scheduler task slots.
They use separate bounded control-plane concurrency and cost quotas, with
tenant/project operational usage accounting. Any later commercial billing for
selection remains outside `Core` unless deliberately made ticket semantics.
Projects do not configure selection prompts, providers, models, profiles or a
scheduling-policy schema. The selector is a black-box product component whose
deployment, safety, privacy, retention, region, cost and concurrency policy is
platform-owned.

The selector nevertheless provides full project-visible provenance for each
bounded semantic interaction: exact versioned instructions and prompt content,
the observed view, active-work and capacity context, tool calls and bounded
returned resources, its choice or reason for waiting, timing and accounting,
and implementation, model and internal-policy revisions. Credentials and data
the project may not read are never supplied or exposed; cross-project capacity
facts are reduced to safe aggregate advisory context. Hidden chain-of-thought
is neither requested nor retained. Anyone with current project read access may
read this history under the ordinary not-found-style authorization rule.

The selector may publish a current planned-next ticket, ordered shortlist or
other bounded planning intent for interest and planning. It belongs only to the
selector's transparent read model and may change whenever the selector observes
new facts. It is not a reservation, promise, queue position, eligibility fact
or input to the ticket service, scheduler or `Core`; it neither blocks manual
dispatch nor gives a later proposal precedence. A proposal always means
“dispatch this ticket now if its fences and current guards pass.”

An authorized user may issue one-shot
`ManualDispatch(ticket, expectedTicketVersion)`. Ordinary project mutation
access includes its distinct `DispatchTicket` capability by default, while
read-only access does not. It is not a persistent manual mode and does not
disable later agentic selection. The writer refuses a mismatched version as
`TicketChanged`, refuses a matching but non-dispatchable ticket as `NotEnabled`,
and otherwise translates manual and agentic choices to the same pure
`Dispatch(ticket)` transition.

Several tickets in one project may be logically working concurrently. Each
additional dispatch requires a fresh agentic choice or manual override. The
ticket domain does not order their physical tasks: it publishes outstanding
logical tasks, and the execution scheduler admits them under its separate
capacity policy.

Commercial capacity is advisory context for agentic selection and authoritative
only in the execution scheduler. A separate high operational backlog ceiling
protects storage and, once I6 supplies its authority, pauses both automatic and
manual dispatch. That ceiling is retryable infrastructure backpressure, not
ticket state or a commercial entitlement. Before I6, I5 neither fabricates a
capacity value nor treats the existing ticket-service mailbox as scheduler
capacity.

Release also pins a stable capacity-account identity, initially the project or
an explicit account reference. Concrete spawn effects carry that identity, but
not reserved slots, maximums, borrowing or cluster availability. The scheduler
applies current versioned entitlement policy at admission, so allocation may
change without rewriting ticket history. Reassigning a project's default
account is explicit and affects later releases; already released tickets retain
their pinned attribution.

## Journal and replay

Each journal entry pins immutable configuration revision and digest, event
schema version and decision-semantics version. Historical configuration
revisions remain available while referenced. Replay compares the canonical
complete entry, including event payload and record; equal records do not make
different events the same history.

The journal retains both the decision event and its `StepRecord`. The record is
a domain-grain integrity witness, not another authority: replay under the pinned
versions must reproduce its transitions, obligations and observations exactly.
It never grows infrastructure, selector, Kubernetes or rendered-configuration
payloads.

Every entry also names exactly one durable direct cause: an accepted operation
or deterministic continuation. Agentic and manual dispatch are accepted
operations whose typed commands preserve their distinct authority and audit
evidence. A cause can authorize at most one effective journal decision;
refusal, duplicate and staleness complete or acknowledge it without an entry.
Continuations retain their causing sequence,
while observational trace IDs remain non-authoritative. Cause references are
outside the pure event but inside complete-entry integrity and audit.

Entries form a per-project digest chain so recovery can detect altered payloads,
truncation and mismatched restores. Unknown versions and replay disagreement
fail the affected project closed without stopping unrelated projects. Ordinary
runtime database roles cannot update or delete historical entries.

Journal identity and compatibility fields are relational columns, while the
versioned decision event and step record are strict structured payloads read
only through the journal adapter. Product queries use projections rather than
the journal. Entry digests are computed from an application-defined canonical
wire encoding of the complete entry, never database JSON rendering; the
versioned encoder fixes object, set, numeric and string representation and is
pinned by test vectors.

New binaries must replay the supported historical vocabulary. An incompatible
semantic change requires an explicit migration or a verified journal-generation
boundary; the system does not retain every historical decider implementation as
live code. Rollback is unavailable after a writer emits a vocabulary the old
binary cannot read.

Rolling upgrades gate project acquisition and renewal by runtime read, write
and decision-semantics compatibility. A vocabulary change first deploys readers
that still write the old form; writing the new form begins only after the fleet
and downstream consumers can read it, and older writers are then barred from
ownership. Incompatible project semantics require suspension, explicit
migration or generation transition, replay verification and compatible
reacquisition. Automatic rollback stops being valid once an older binary cannot
read an entry already emitted.

Full replay from project genesis is the initial recovery path. Snapshotting is
added only when measured journal length or activation latency earns it. A
snapshot is a disposable accelerator bound to project, journal generation,
sequence, entry digest and semantics version; recovery verifies it and replays
the suffix, or falls back to an older snapshot or genesis. Snapshots never
authorize effects, replace configuration history or become a second authority.

## Projections and reads

Project-local current-state projections commit with the journal decision and
carry the sequence that produced them. When an operation succeeds at a project
sequence, a subsequent primary project read can observe at least that sequence.
These projections are rebuildable from the journal and its immutable referenced
configuration; they are not a second semantic authority.

Tenant-wide feeds, search and analytical views update asynchronously. They
carry per-project watermarks and make no claim of a total order across projects.
Normal reads use PostgreSQL projections rather than entering the in-memory
project actor.

Operation polling is the durable client completion contract. Mutation
submission returns an operation resource, and an identical idempotent retry
returns the same resource. The API may wait briefly for a terminal result as a
latency optimization without changing the asynchronous contract.

An optional project Server-Sent Events stream may accelerate the UI. Its
bounded notifications carry resource identity and project sequence/version,
not sensitive bodies or authority. Loss, duplication, reordering or retention
gaps cause clients to refresh ordinary projections; the stream never replaces
operation polling. A terminal operation exposes its committed project sequence
so primary reads provide read-your-write behavior.

## Effects and execution completion

Chuggy's PostgreSQL projections and authenticated API are the native desk.
Draft authoring is native application state outside `Core`; released-ticket
revocation and completion visibility commit with the journal rather than
waiting for an asynchronous desk adapter. Human actions and gates are explicit
native records materialized in that transaction. There is no
external `DeskPort`; optional issue-tracker, email or webhook synchronization is
a secondary integration and never ticket authority.

Each native action is single-use and identified by its authorizing project
sequence and effect position. Its bounded record names the ticket, action kind,
permitted resolution, required capability and lifecycle. An authorized
version-guarded resolution re-enters the project inbox and atomically journals
the corresponding domain decision while resolving the action. Leaving the
owning ticket phase cancels an open action transactionally; late resolution is
refused and prior history remains auditable.

Only work outside the project transaction becomes an immutable focused consumer
request identified by project, journal sequence, effect position and item
position. The PostgreSQL adapter inserts execution registration, execution
cancellation and finalizer requests directly into their consumer-specific durable
tables in the deciding transaction; it does not relay them through a generic
in-database outbox. A spawn request names each exact logical task, kind, stable
capacity account and pinned task-configuration revision needed downstream; a
consumer never reconstructs historical intent from a moving ticket row.

Every effective `TaskDone` journal input also pins the logical task, immutable
result-manifest identity and digest, verdict and result-schema version. An
explicit empty manifest represents no handoffs. Infrastructure verifies and
retains the manifest before submission; the decider may treat its reference as
opaque. Transactional projections rebuild exact authoritative handoffs from
the journal, and later spawn requests pin those references rather than reading
a mutable latest-result row. Artifact bytes and attempt details remain outside
`Core`.

Consumption state is per request. Independent claiming and retry allow
unrelated work to proceed around a poisoned request. Redelivery with identical
identity and payload is absorbed; conflicting payload is an integrity incident.
Causal constraints are explicit rather than inferred from journal order.
Operation success means the decision and its external-work requests are
durable, not that the external work has completed. If a consumer later moves to
another database, an outbox/relay adapter implements the same focused port.

Correctness-bearing registration, cancellation, preparation and commit requests
retain immutable identity, payload, digest and terminal status for the project
lifetime. Retry attempts and diagnostic detail may be compacted; the authorized
instruction cannot. Later archival may move it to cheaper integrity-verifiable
storage, while optional non-authoritative notifications may use a shorter
declared retention contract.

Workers report physical results to the execution scheduler. Only the scheduler
may submit an authoritative logical completion to a project. Its envelope binds
the project, ticket, logical task, execution and source spawn effect. The writer
authenticates that authority and validates the binding before reducing it to
the pure `TaskDone` event.

Before submission, the scheduler verifies that every result required by the
task kind is durably present in project-owned immutable storage with matching
digest and schema. Its terminal transaction pins those references, releases the
capacity slot and inserts completion together. An incomplete upload cannot
produce a successful logical verdict; transient reconciliation continues, and
permanent loss eventually becomes a definitive execution failure. `Core` uses
only the logical outcome while the journaled input retains the bounded result
references from which projections rebuild.

Completion submission is a semantic port, not necessarily another message hop.
In the initial shared-PostgreSQL adapter, the scheduler's terminal transaction
atomically persists terminal execution state, releases the capacity slot and
inserts the idempotent authority-scoped completion operation into the project
inbox. The scheduler cannot complete that operation or mutate project state. A
separate completion outbox and relay is reserved for a future adapter whose
scheduler and project inbox do not share a transaction boundary.

Current mandatory execution policy is evaluated separately from the pinned
release briefing. Temporary inability leaves execution queued with a visible
hold. A definitive inability to run the immutable contract—such as policy
denial, unavailable execution profile, unsupported runtime or unavailable
pinned configuration—submits `ExecutionBlocked`, not a fabricated failed-work
verdict. It retires the outstanding set as `Cancelled`, moves the ticket to
`Escalated`, opens a native action and consumes no evaluation/rework budget.
The bounded reasons include `TicketConfigIncompatible` when an intact, valid
pinned ticket configuration cannot be supported by current execution
infrastructure or mandatory policy.
Resume requires current admission and creates fresh logical tasks; a permanently
obsolete contract is revoked and replaced. Missing or corrupt retained input is
an integrity block. Policy may drain or terminate running work only after its
attempt is fenced, and never silently weakens the execution profile.

Identical completion redelivery is absorbed. A late result for retired or
revoked work is retained operationally but does not change the domain. A
contradictory terminal result preserves the first domain outcome and raises a
scheduler integrity incident. Infrastructure launch attempts remain below one
logical task identity.

Each effective logical task completion is one project input, journal entry and
transaction. Transport may deliver a bounded batch, but the writer decomposes
it into independently idempotent decisions. A batch domain event is introduced
only if measured project throughput earns a model-first change.

Whenever a decision spawns another logical task set, the same transaction
materializes one immutable project-owned input-bundle revision from the exact
upstream result and artifact references, bounded handoffs, pinned release
configuration and relevant repository identities at that decision. Every new
scheduler registration request pins its bundle and digest. Evaluation, later
stages and rework therefore consume the evidence that caused them rather than a
moving latest-ticket view. Bundles remain outside `Core` and contain references,
not unrestricted logs or secrets.

Revocation and completion races resolve by journal order, with revocation given
mailbox priority while both await processing. A committed revocation retires
unresolved logical tasks and emits exact idempotent cancellation instructions;
it does not wait for Kubernetes termination. The scheduler persists cancellation
and releases its logical slot before reconciling physical workload deletion.

Finalization is one narrow `Core` boundary. A released ticket declares
`NoFinalizer | ManagedFinalizer`, frozen with the rest of its contract.
Evaluation completion either reaches `Done` directly or enters the single
non-revocable `Finalizing` phase and emits `RunFinalizer`. The only subsequent
domain input is `FinalizationResult(Succeeded | Failed)`: success reaches
`Done`, and conclusive failure takes the existing priced rework/escalation
path under the ticket's finalization pricing. Entering `Finalizing` is the
domain point of no return; revocation is legal before that entry and refused
after it, and a revocation racing the evaluation completion that would enter
`Finalizing` resolves by journal order like every other mailbox race.

Everything else about finalization is the finalizer service's durable,
project-scoped operational state: queue order, preparation, approval, permits,
Git operations, reconciliation and repository exclusivity. The platform
exposes only constrained, platform-owned finalizers; the phase never runs
arbitrary further work. Git promotion of the produced branch is the initial
implementation, not a model type.

The service keeps a distinct irreversible boundary at the Git grain. After
reversible preparation, its executor must obtain a project-scoped commit
permit before the exact conditional ref update; the permit serializes the
update against project closure and deletion, and fences stale executors by
generation and recovery epoch. An ambiguous Git response is reconciled from
the target ref and the immutable candidate commit identity before any outcome
is accepted. A granted permit cannot expire into safety or be abandoned until
that reconciliation proves whether the ref advanced.

Only conclusive evidence enters the project. `FinalizationSucceeded` requires
the target ref to prove the authorized commit. `FinalizationFailed` requires
proof that the ref did not advance and that abandoning the attempt is safe; a
deterministic preparation failure or merge conflict concludes the same way and
is priced as ordinary finalization failure, entering rework when affordable or
`Escalated` with a native action when exhausted. Timeout, an unreadable ref or
contradictory evidence is an operational hold under attention, not a `Core`
event: ambiguity cannot expire the permit or authorize another attempt, and
the ticket remains in `Finalizing` until reconciliation concludes.

The I7 finalization-result envelope distinguishes a bounded typed failure kind
from the pure `FinalizationFailed` outcome and pins immutable evidence sufficient
for any resulting rework. For `MergeConflict`, that evidence names the
finalization request and attempt with digest, candidate commit, observed target
commit and merge base, and a project-owned structured conflict manifest with
identity and digest. The decision that returns the ticket to `Working`
materializes the fresh work set's input bundle from that exact evidence,
together with the existing artifact, handoff and release-briefing references.
Workers therefore receive a precise reconciliation objective against immutable
Git identities; they never reconstruct it from current refs, finalizer logs or
the bare `FinalizationFailed` value in `Core`. Large conflict detail remains in
the referenced manifest rather than the journal or request row. Other typed
finalization failures carry the evidence schema their rework requires, while
all continue to reduce to the same priced domain outcome.

Each preparation creates an immutable finalization attempt containing the
exact candidate commit, observed target ref and base, relevant digests and its
own digest. Preparation cannot mutate an existing attempt; re-preparation
creates another identity. Where a platform finalizer requires human approval,
the approval is a native action referencing that attempt identity and digest,
owned by the service's records rather than a `Core` phase. Journal envelope
metadata pins the attempt reference without placing Git identifiers in `Core`.

Attempt, candidate, action and permit identities remain in durable focused
request/native-action records rather than `Core`. At most one current
finalizer request is authorized per ticket. Only the finalizer service may
submit `FinalizationResult`, and the project writer validates that submission
against the authorizing `RunFinalizer` request, its generation and recovery
epoch before constructing a semantic decision input. Stale, duplicate,
cancelled or mismatched results produce no journal entry. Only the validated
logical outcome reaches the decider, and the journal cause retains the
authorizing request identity. Takeover reconstructs this correlation from
PostgreSQL rather than process memory.

The service orders its work in deterministic FIFO by the project sequence that
entered `Finalizing`, with repository/ref exclusivity serializing attempts on
the project's one repository. Agentic selection governs which ready ticket
begins work, not the continuation order of already-finalizing tickets. A
ticket that fails into rework and later returns receives a new queue position;
no manual finalization reorder exists initially. The order is a durable
service policy rather than a `Core` invariant: a transactional projection
derives it from the journal, replay rebuilds it, and PostgreSQL concurrency
tests—not ticket state—prove the policy.

Each project's sole repository belongs only to it, so finalization never
coordinates a Git ref across project journals. Repository/ref serialization
remains local to that project's finalization work. A repository cannot be
attached to another project, and moving it requires closing/exporting the
source and importing it under a new project identity rather than sharing live
authority. Multi-repository projects require a later explicit project-local
design rather than a generic resource graph now.

The permit is finalization-specific rather than a generic irreversible-effect
framework. The reusable rule is only that an external point of no return which
determines domain truth requires a serialized permit; any future integration
must earn its own typed protocol and reconciliation semantics.

Finalization does not consume the execution scheduler's commercial task slots.
Its service has separate bounded concurrency and repository/ref exclusivity;
its operational retries create neither new logical tasks nor additional
task-slot usage. Any later commercial merge/deploy throughput is a distinct
entitlement rather than an overloaded task-capacity rule.

## Ticket-model impact

One `Core` represents one project partition rather than the installation.
Draft and `Arrive` leave it entirely. The authenticated `ReleaseTicket` command
supplies the enclosing partition and final resolved lifecycle configuration,
creates the ticket directly in `Pending`, and accepts only dependencies already
released in that project. Tenant policy, ownership leases, operation state,
selector state, capacity, execution status and delivery retries remain outside
`Core`.

`Core` stores no opaque release-contract reference merely for provenance.
`ReleaseTicket` materializes every value that can affect later domain decisions
into the new ticket: its work fan-out, evaluation program, accounts and pricing
rules, and finalizer kind. Later deciders read those immutable ticket values and
do not accept a mutable ambient `Config`. Repository, template, artifact and
configuration identities and digests remain in the immutable release bundle
and journal envelope outside `Core`.

Phase constructors lose type-letter prefixes and state their role directly:
`Pending`, `Working`, `Evaluating`, `Finalizing`, `Done`, `Escalated` and
`Revoked`. The proposal does not introduce prefixed names for new states while
leaving the old phase vocabulary inconsistent.

Task vocabulary follows the same rule: `Outstanding` and `Resolved` states;
`Passed`, `Failed` and `Cancelled` outcomes; `Work` and `Evaluation` kinds; and
`Pass` and `Fail` verdicts replace the `TS`, `T`, `TK` and `V` constructors.
Where the formal language requires globally distinct constructors, semantic
compound names replace type-letter prefixes.

The rule applies to every model constructor, not only states: constructors name
their meaning rather than abbreviating their type. Finalizer, artifact,
resume, reason, combinator and pricing variants use names such as
`NoFinalizer`, `ManagedFinalizer`, `FinalizationSucceeded`, `ProducedArtifact`,
`UnanimousPass` and `BudgetedRework`. Descriptive qualification
needed for globally unique Quint constructors is retained; opaque `W`, `WO`,
`A`, `R`, `Rs`, `C` and `RW` prefixes are not.

Project identity therefore leaves each ticket and the pure release event. With
one exclusively owned repository per project, the resource-bearing finalizer
declaration becomes the nullary `NoFinalizer | ManagedFinalizer`; repository
exclusivity is the finalizer service's own durable record rather than a lease
derived from ticket phases. Project/resource constants and attempt attribution
inside `Core` disappear, while infrastructure envelopes retain the
tenant/project partition for routing, authorization and audit.

`CompleteDuplicate` leaves the actor's persisted decision vocabulary. It models
redelivery of a completion effect, which the immutable per-effect identity now
absorbs before any project input or journal append. The model and refinement
suites retain the actual claim at that boundary: repeating an identical effect
changes no domain state and conflicting reuse is an integrity failure. Ticket
`Done` remains absorbing independently of a production no-op decision.

`TaskDone` likewise enters the model only for an effective completion of an
`Outstanding` logical task and always resolves it. Scheduler/project submission
uniqueness absorbs identical redelivery, flags contradictory terminal payload,
and records retired or revoked work as auditable staleness without another
journal entry. Defensive helper idempotence may remain, but transport no-ops
leave the actor action vocabulary and are proved at the refinement boundary.

`RevalFail` also leaves the model. Release pins resolved immutable configuration,
dispatch rechecks eligibility, temporary policy/resource trouble is an
operational hold, definitive execution prohibition becomes a logical task
failure, and corrupt immutable input blocks project integrity. The generic
pre-work “world changed” escalation and its pending operator-resume branch no
longer represent one coherent domain fact.

`OpRetry` remains a domain transition because it resumes an escalated ticket,
may spend gas and may create new logical work, but it becomes `ResumeTicket`.
Its remaining targets are `NoResume`, `ResumeWorking`, `ResumeEvaluating` and
`ResumeFinalizing`; infrastructure retry never invokes this event.

The external effect vocabulary loses native-desk `CreateDraft` and `Complete`;
the former disappears with domain arrival, including the interpreter's special
rule for recovering its subject from post-state. `Revoke` becomes the explicit
`CancelTicketWork` scheduler obligation, from which the transaction materializes
exact cancellation requests. `OpenHumanTask` remains an explicit model
obligation but creates a native action record in the decision transaction;
`OpenGate` disappears with the wrap-up phases, since any approval a platform
finalizer needs is the service's own native action. `EnqueueWrapUp` and the
queue-shaped `Dequeue` input disappear with the service-owned durable queue;
entry to `Finalizing` emits the single `RunFinalizer` obligation instead.

Finalization keeps an explicit point-of-no-return refinement, moved to the
phase boundary. Entering `Finalizing` is the domain point of no return: the
model makes revocation legal before that entry and refused after it, so ticket
state cannot claim revocation once the finalizer has been authorized to run.
`RunFinalizer` is the sole authorization for the service's work, and only a
validated `FinalizationResult` moves the ticket out—success to `Done`,
conclusive failure to the priced rework path. The finer Git-grain
discipline—reversible preparation, the commit permit, reconciliation of
ambiguity—lives in the finalizer service's durable records and its own
concurrency tests. The termination measure and finalization proofs change
model-first with the single phase.

The existing unpartitioned in-memory journal, cursor, wire bytes and golden
fixtures are pre-production scaffolding rather than customer authority. They
may be replaced as one intentional breaking change led by the Quint model and
followed through conformance, wire, replay and crash tests. No live-data
migration framework is built for that format; the first PostgreSQL schema is
production format version one. Compatibility and explicit migration become
mandatory after production authority exists.

## State authorities

The active project writer alone appends its journal and changes ticket, logical
task and project-primary projection state. The API and internal submitters may
insert authorized operations but cannot decide them. A narrowly constrained API
transaction may move a still-pending operation to cancelled while racing on the
same row lock as the writer. The project writer creates immutable external-work
requests for execution and finalization consumers; consumers update only their
owned operational state. The selector instead owns its monitoring, observations
and planning state and may submit only a fenced dispatch proposal. The execution
scheduler alone owns execution and capacity state and may submit completions,
but it cannot resolve logical tasks directly.

Separate PostgreSQL roles and workload identities enforce these boundaries.
Runtime services do not share an omnipotent database credential.

Semantic ports do not require one network service each. The initial deployment
has an authenticated web service for submission, reads, configuration and SSE;
a ticket service for multiplexed project actors, continuations, dispatchable
views and decision transactions; an independent selector service for project
feed consumption, monitoring, transparent planning and fenced proposals; an
execution service for registration, capacity, Kubernetes and completion; and a
finalizer service for Git preparation, commit permit and reconciliation. The
selector may share a deployable initially but retains its own service identity,
durable state and concurrency budget and reaches the ticket service only through
authenticated application ports. No shared process grants it a ticket-service
database credential or lower-level command authority. These module boundaries
permit later physical separation without changing authority.

The shared ticket-service fleet is a trusted multi-tenant control-plane component.
Project-scoped repositories, composite keys, transaction context and adversarial
tests prevent accidental cross-project access, but the initial deployment does
not claim that a fully compromised ticket-service process is confined to one
tenant. Ticket-service pods run no user code, receive no worker credentials, use
restricted network access and audit the instance and fencing epoch responsible
for each decision. Agent and user-authored execution remains in separately
isolated worker workloads. Hard per-tenant ticket-service identities or deployments
are a future option rather than an initial guarantee.

Workers form an untrusted execution plane. Each execution receives a short-lived
task identity, project-scoped credentials, default-deny network access, bounded
resources and a hardened non-privileged pod; it receives no control-plane
database credential. Trusted control-plane workloads and workers occupy
separate scheduling and network boundaries.

The scheduler resolves a finite execution profile from structured policy.
Profiles may select stronger runtime sandboxes, dedicated worker pools or
tenant-dedicated placement without changing ticket `Core`. Prompt text and
user-authored task configuration cannot weaken the selected profile. Namespace,
workload-identity and storage isolation may be tightened per tenant or project
as scale and customer requirements earn it; dedicated ticket-service pools remain
a compatible future deployment option.

## Integrity containment

Authoritative journal corruption, an unreadable journal version, digest-chain
failure or replay disagreement places only the affected project in an
operational `IntegrityBlocked` state. New decisions and dispatch stop, pending
completions remain durable, safe reads remain available, evidence is preserved
and unrelated projects continue. The runtime never skips or edits an
authoritative entry automatically.

An audited administrative suspension uses the same fail-closed operational
boundary without claiming corruption. It rejects new ordinary mutations, holds
accepted operations and completions, stops all project decisions and new
execution admission, and requires explicit resume. Running executions continue
and their outcomes wait durably unless revocation or deletion explicitly asks
for cancellation. There is no initial user-facing persistent pause of agentic
dispatch; one-shot manual dispatch is not a project mode.

Suspension is a narrow out-of-band administrative transaction because an
unhealthy project writer cannot be trusted to process its own stop command. It
locks the partition, changes operational availability, advances the fencing
epoch, clears ownership, records immutable audit and stops scheduler admission
without appending a domain event. Reactivation advances the epoch again and
wakes clean acquisition; an integrity block additionally requires a verified
repair manifest.

Not every anomaly blocks a project. Identical duplicates are benign, late
completion after retirement is auditable staleness, and a contradictory second
terminal result is a scheduler incident while the first domain outcome remains
authoritative. A poison effect blocks its own delivery unless safe progress
explicitly depends on it. Cross-project identity mismatch is rejected and
alerted without blocking a project unless stored authority may be corrupt.

Recovery is an audited administrative workflow: freeze the project, classify
authority versus derived damage, rebuild disposable state where sufficient,
reconcile effects and executions, record a repair manifest, advance the
applicable epoch and verify replay before reactivation. User-visible project
status distinguishes temporary ownership wait, selector delay, backlog
protection, suspension and integrity block without exposing sensitive evidence.

Fleet metrics use bounded dimensions such as operation kind, reason code,
priority class, request state and execution profile; tenant, project, ticket,
task, operation and principal identities are not metric labels. Opaque
correlation identities may appear in access-controlled structured logs and
traces, without user content, prompts, credentials or raw model output.
Authenticated project diagnostics expose ownership, journal head, backlog,
selection, execution and integrity state. Administrative and security actions
write a separately retained append-only audit stream.

## PostgreSQL deployment and recovery

Managed PostgreSQL is the recommended production authority so loss of the Talos
cluster does not also remove the record needed to reconstruct it. The production
deployment uses regional high availability, automated backups, point-in-time
recovery and a rehearsed restore. Backups may be retained in another region,
but synchronous cross-region replication and automatic regional failover are
out of scope. Database unavailability stops acceptance and decisions; no
component continues from memory as authority.

A restore may leave Kubernetes and other external systems ahead of PostgreSQL.
Recovery therefore establishes a new deployment epoch, fences pre-restore
writers, verifies project journals, rebuilds scheduler allocations, inventories
external resources by immutable Chuggy identity, rebuilds current
dispatchable-view projections, reconciles unknown or known work and redelivers
durable consumer requests before enabling mutations. Selector observations
from the old epoch cannot authorize a proposal; its independent recovery
resets project cursors through the restored notification and current-view APIs.

The recovery set also includes every exclusive Git repository and immutable
configuration/artifact blob referenced by PostgreSQL. Recovery verifies content
digests and required commits, reconciles restored expected refs against actual
Git refs, and blocks only projects with missing or unexplained authority. It
never substitutes mutable latest content. Cross-region retention covers the
database, repositories, immutable blobs and required encryption keys; their
recovery points need not be one fictitious atomic snapshot, but referenced
immutable content must outlive every database recovery point that names it.

Acknowledged commits have no expected loss under process, instance and zonal
failure. Complete regional loss may lose a bounded recent window. Recovery in
another region is operator-controlled and fail-closed rather than an automatic
failover claim; the service describes operations as durable in the active
regional control plane, not globally durable.

## Verification

The formal model leads the project-scoped `Core`, local dependencies and the
replacement of transport duplicate decisions with an idempotent effect-boundary
claim. Port tests cover expected-head and epoch refusal, project isolation,
complete-entry equality, operations, continuations, manual-versus-agentic
dispatch races, stale and old-epoch proposals, notification reset and
immutable effects.

The PostgreSQL adapter is tested against a real server rather than only mocks.
Competing owners, concurrent independent projects, lease takeover, stale-writer
commit, composite constraints, ambiguous commit, wake-up races, per-effect
claims, projection atomicity and separate database roles are acceptance work
for this boundary. Focused process-kill tests cover every durable seam and prove
no accepted operation, domain decision or effect is lost or duplicated.
Deployment issue #74 later rehearses the integrated system; it is not the first
evidence that the storage contract survives concurrency and process death.

## Project deletion and retention

`Deleting` is distinct from ordinary suspension. Entry blocks ordinary
admission and dispatch, publishes the project-lifecycle wake-up, advances
lifecycle and ownership epochs, fences the old owner and credentials, and
permits one newly fenced logical writer to run only deletion-approved commands.
The selector stops monitoring and moves its project-owned audit and planning
state into the deletion retention workflow. The closure writer journals modeled revocations,
requests execution cancellation and reversible finalization abort, consumes
terminal resource-releasing reports, administratively cancels remaining pending
operations and reconciles irreversible finalization. It cannot release,
dispatch, resume or create work. After closure invariants hold, immutable
`Retention` admits no writer.

An `IntegrityBlocked` project is not replayed merely to delete it and receives
no fabricated terminal `Core`. Infrastructure quiesces its credentials,
workers, allocations and external resources out of band; an audited deletion
manifest records that domain closure could not be established. The frozen
journal then follows the retention and erasure policy as untrusted evidence.

Entering `Deleting` fences the ordinary ticket-writer owner. The closure writer
revokes nonterminal tickets outside `Finalizing`, requests cancellation of
every execution that has not crossed an irreversible boundary, removes worker
credentials and waits for scheduler attempts to become terminal and release
capacity. A `Finalizing` ticket cannot be revoked: an attempt that never
obtained the commit permit aborts safely and concludes `FinalizationFailed`,
after which the closure writer revokes the ticket; an attempt past the permit
must reconcile to a conclusive `FinalizationResult` before repository evidence
is removed. The deletion operation remains visibly pending during that hold.
Retention and physical erasure begin only after authoritative work is
quiescent.

Project deletion proceeds through `Deleting`, domain closure, operational
cleanup, retention and final physical erasure. Suspension rejects new work and
prevents dispatch while preserving selector audit; closure prevents a writer
or selector from reactivating the project; cleanup cancels executions and
revokes project credentials. During its retention
period the project cannot be mutated and is readable only through explicitly
authorized administrative paths. Final erasure is audited, and an erased
project's immutable identity is never reused even when a display name is.

Final erasure retains one non-sensitive entry in a global project-identity
registry outside project-owned storage. It contains only the opaque project
identity, `Erased` state, final generation and minimal deletion audit evidence;
it contains no tenant, user, name, repository, credential or operation data.
The identity is never reassigned. Every callback capability binds project and
generation, and callback admission rejects erased or stale-generation identity
before project lookup. Project-scoped idempotency may still be erased because
the tombstone fences identity rather than replaying requests.

Permanent operation idempotency lasts through the project lifetime and
retention period. Once the entire project namespace is erased, its scoped
idempotency tombstones may be erased with it. Late callbacks for that identity
are rejected and audited.

The journal minimizes sensitive payloads: it retains no credentials, rendered
prompts, unrestricted logs, arbitrary exceptions, identity-provider assertions
or model reasoning. Large user-authored and runtime material belongs in
separately governed storage; the journal keeps immutable references and digests
only where the decision requires them. Backup expiration remains part of the
documented erasure window. Cryptographic erasure is not claimed until a
project-key scheme is implemented and tested.

## Implementation handoff

The prose above is normative. Names of SQL tables, indexes and deployments may
change, but an implementation is incomplete if it weakens an authority,
transaction, fencing or replay rule below.

The model tranche landed first, carrying only semantics plus the mirrors that
keep the repository coherent. What it decided, `model/` now states and proves,
and the generated API declarations that followed under issue #98 are
`docs/design/007-quint-model-api-generation.md`'s. Neither tranche built
PostgreSQL operations, leases, mailboxes, selectors, attempts, capacity,
artifacts, native actions or project lifecycle, which is what the rest of this
section hands off.

The infrastructure tranche must provide durable relations equivalent to:

- project identity/lifecycle, lifecycle generation, ownership lease/epoch and
  discovery readiness generation, plus bounded authenticated project inventory
  for the selector service;
- authority-scoped idempotency, operation outcome/progress, project ingress
  counter and project inbox;
- expected-head journal entries, current project state/projections and durable
  continuations;
- current digest-fenced dispatchable views, native actions/gates and
  access-controlled selector audit and planning state;
- focused execution registration/cancellation, finalizer preparation/commit and
  optional-integration requests;
- scheduler logical tasks, physical attempts, capacity allocation and terminal
  result manifests;
- immutable release bundles, input bundles, staging/permanent artifacts and
  their retention references;
- the global recovery epoch and permanent erased-project identity registry.

At minimum, database constraints enforce composite project ownership, one
effective journal cause, unique inbox source, permanent accepted idempotency,
one terminal operation outcome, one current finalizer request per authorized
ticket, deterministic effect/request identity, one terminal logical task result
and non-reuse of project, ticket, task, execution, attempt, permit and selector
decision/delivery identity in their declared scopes.

The following commits are indivisible transactions:

1. Acceptance locks lifecycle/ingress and writes operation, inbox ordinal/item
   and readiness generation.
2. A project decision checks lifecycle, lease epoch, expected head and relevant
   revision fences, then writes journal entry, operation outcome, inbox
   acknowledgement, native state, primary and dispatchable-view projections,
   project notifications, continuations and focused requests.
3. Scheduler terminalization writes the immutable result reference, terminal
   logical outcome, capacity release and project completion operation.
4. Cancellation locks the pending operation and makes its inbox item
   non-consumable before a writer can decide it.
5. Staged release-object promotion locks the same metadata raced by garbage
   collection and creates permanent references with release.
6. Lifecycle transitions advance their generation and fencing epoch while
   changing the operation-class admission matrix and publishing any required
   selector-visible `Project` notification.
7. A selector observation advances its owned project cursor only with the
   bounded provenance and resulting wait or planning state it observed; a
   choice also creates its idempotent proposal-delivery record in that selector
   transaction before any ticket-service API call.

Implementation order follows the landing table. Each slice includes real
PostgreSQL concurrency/process-death tests for its transaction before a later
slice depends on it. Restore, deletion and irreversible Git tests use old-epoch
actors that remain alive after takeover; a happy-path mock does not satisfy the
contract.

Lease durations, retry backoff, retention periods, quota values, selector
provider, physical table partitioning, deployment grouping and optional worker
isolation profiles are configuration choices. They may be selected from
operational evidence without a model change as long as they preserve the
boundedness, authority, project isolation and fail-closed rules here. A new
domain transition, shared project resource, external irreversible effect or
second writer is not such a choice and requires a model and design revision
first.

## Landing

Landing was deliberately split: the formal model and the mirrors required to
keep it coherent first, model-API generation separately under issue #98 second,
and the durable PostgreSQL, API, ticket service, scheduler and recovery
infrastructure only after both. That infrastructure work must not drive an
unreviewed semantic change back into the model.

### Implementor contract

The table is an implementation order, not a menu. A later slice may add only
the interfaces named by an earlier slice; it must not simulate a missing
authority in memory, in a queue, or in an adapter. Each slice owns its schema
migration, typed ports, metrics and real-PostgreSQL concurrency/process-death
tests. A slice is complete only when its stated durable boundary works after a
fresh process reconnects, and no caller can bypass it with a direct table write.

For every new mutable relation, the implementing change must state: its owning
service role; its composite project key and foreign keys; its immutable
identity/idempotency key; the transaction that changes it; and the recovery
query that finds unfinished work. Those are required design-review artifacts,
not implementation detail. A new transition, an external irreversible action,
or a change to the pure event payload goes back through model and design review
first.

### I3 decision record

Issue #142 tracks implementation. The following decisions were agreed before
implementation of I3. They refine
the I3 landing row without changing the model. The deployable previously called
the deployable is the **ticket service**, and its fenced project-local actor is
the **`ProjectTicketWriter`**. PostgreSQL remains the durable authority. The
selector proposes, the scheduler executes, and the finalizer concludes Git
work; none of them writes ticket state.

The project decision mailbox has four base priority classes, highest first:
`Safety`, `Completion`, `Continuation` and `Ordinary`. Safety is the closed set
of revocation and correctness-reducing controls; completion is an authorized
task, execution-blocked or finalization result; continuation is internal only;
and ordinary contains release, resume, native-action resolution, manual
dispatch and selector proposals. The ticket service derives both priority and
lifecycle admission from the authenticated typed ingress path. Neither is a
caller-selected value or a consequence of authority kind alone. This policy is
only for ticket decisions; it does not govern the execution scheduler.

Ingress parses a versioned typed command envelope and validates its bounded
structure before acceptance. Its closed command tag is what trusted policy maps
to admission and priority, and the narrow acceptance function cross-checks the
combination; callers supply none of those classifications. A malformed or
unknown envelope creates no operation. A structurally valid command whose
domain transition is not enabled is still accepted and refused only by the
`ProjectTicketWriter` at its serialized position. I3 therefore removes the
temporary path that accepted an opaque unreadable command merely to terminalize
it later as `CommandUnreadable`; domain legality remains exclusively the
writer's, while structural readability becomes an ingress fact.
Authoritative `TaskDone`, `ExecutionBlocked` and `FinalizationResult` envelopes
derive `CorrectnessReducing` admission as well as `Completion` priority. They
remain durably admissible while ordinary work is stopped, although lifecycle
policy may hold the accepted input rather than let a writer decide it.

Within an effective priority class the lowest project inbox ordinal wins. With
base ranks zero through three in the order above, effective rank is
`max(0, baseRank - floor(databaseAge / agingInterval))`. One configurable
interval is used initially. Selection reads only the lowest consumable ordinal
from each of the four base classes, computes their effective ranks using
database time, and chooses by effective rank then ordinal. The query is thus
bounded independently of mailbox depth, preserves FIFO inside a base class and
eventually places an old ordinary input ahead of newly arriving safety work.

Ordinary submission has a soft project limit below a hard limit that reserves
room for safety, already-authorized completions and continuations. Idempotency
lookup precedes this check. New work stopped by it creates no operation,
ordinal, input or tombstone and receives retryable transport backpressure, not
a domain refusal. Scheduler admission must reserve room for every completion
it can later submit. A `ProjectTicketWriter` processes a configured count or
time quantum, selecting again after every commit, and yields with readiness
still asserted when work remains. It never loads the whole mailbox.

`decision_input` replaces `inbox_item` and is the sole processing-state
authority. It stores the partition, project-local ordinal, typed identity,
base priority, database creation time, accepted lifecycle generation, state
and terminal evidence. Its states are `Pending`, `Journaled`, `Refused`,
`Cancelled` and `Stale`, constrained by input kind; public operation state is
derived from the joined input. Operation rows retain idempotency, authority,
command and audit evidence, but no duplicate processing state or consumability
flag. Journal entries name a typed decision input, and one input authorizes at
most one entry. A journaled input and its entry reference the same composite
`(tenant, project, input kind, input identity, decided sequence)` tuple in both
directions through `DEFERRABLE INITIALLY DEFERRED` foreign keys. Input state
requires a decided sequence exactly when it is `Journaled`, and journal cause
identity is unique. The deferral permits either write order inside the decision
transaction while requiring both directions to agree at commit; no input may
claim a sequence without its exact entry and no entry may name an input that
does not claim that sequence.

The decision input kinds remain operations and deterministic continuations.
Agentic proposals and manual dispatch are typed operations under different
capabilities, not new source kinds. Every continuation, native action and
focused service request has an immutable identity derived from tenant,
project, authorizing journal sequence, effect position and kind. Those source
fields remain explicit even if consumers receive an opaque deterministic
alias. Creation is in the authorizing decision transaction, retries reproduce
the same identity, and mutable delivery or result state never changes its
payload or identity. Internal continuations allocate an ordinary project
inbox ordinal and advance readiness generation in that same transaction.

I3 has exactly two deterministic continuation kinds: `ReduceWork` and
`ReduceEvaluation`, created when the corresponding final outstanding task
settles. A continuation records ticket, enabling sequence, expected ticket
version and phase, and a task-set generation or canonical digest. Matching
fences run one reducer as a separate journaled decision; a legitimate
intervening version settles it `Stale`. Before I9, a matching version with
contradictory phase or task evidence raises a typed integrity contradiction,
rolls back, stops that project's quantum and leaves the input pending. I9 adds
durable containment and repair. A decision input has no individual claim
lease: the project ownership lease already serializes its reader, and takeover
simply resumes pending inputs.

Outbound work uses dedicated relations, not a generic outbox:
`native_action`, `execution_request` and `finalization_request` land in I3.
I5 adds no selector request outbox; its current dispatchable view is a
projection and its project notifications are the I4 feed. Common focused
requests are immutable authorizations with semantic states `Open`,
`Registered`, `Fulfilled` and `Invalidated`; worker claim lease and generation
are separate operational fields. Registering a request and creating the
consumer's owned durable work are one transaction. Temporary infrastructure
failure leaves it open, and fulfillment means the authorized obligation
concluded, not necessarily that its domain outcome succeeded.

The five model effects map exhaustively and once: `SpawnWorkTasks` and
`SpawnEvalTasks` create typed execution requests, `CancelTicketWork` creates an
execution cancellation request, `RunFinalizer` creates a finalization request,
and `OpenHumanTask` creates a native action. Unknown effects fail the decision.
The pure decision plan derives projection changes, continuations, action
changes and request rows from the cause, pre-state, decision record and
post-state before the short database transaction; the adapter does not invent
a second interpretation. A refusal plan contains none of them, a failed fence
discards the whole plan, and memory advances only after the complete commit.

Execution spawn requests have one child row for every newly outstanding
logical task, including ticket-local task ID and typed kind/stage. Cancellation
requests have one child row for every pre-state outstanding task retired by
the decision; an empty cancellation is valid durable evidence of a no-op. The
materializer checks these rows against the pre/post delta. I6 must fence
registration by authorizing sequence so delayed spawn work cannot survive a
later cancellation. A cancellation request is fulfilled when cancellation is
durably registered, not when Kubernetes deletion finishes.

A finalization request is created only when its subject enters `Finalizing`
with `RunFinalizer`. It records the ticket, ticket version, request generation
and source identity, with at most one current open request per ticket. Re-entry
after rework creates a new identity and generation. It authorizes preparation,
not a Git commit. I3 carries no speculative repository, ref, candidate,
approval or permit columns; the slices that create immutable bundles and the
I7 protocol add their fields and revision fences before consumption.

A native action has `Open`, `Resolved` and `Withdrawn` states and at most one
open row per ticket. A version-guarded `ResolveNativeAction` enters through an
ordinary operation; its successful ticket decision closes that exact action as
resolved. Any other valid transition that removes the condition closes it as
withdrawn. Later escalation creates a new identity; nothing reopens an old
action. Its typed, bounded columns carry kind, reason, permitted resolutions,
required capability and version, never credentials or unrestricted content.
The I3 action kind is `TicketEscalation`, its required capability is
`ResolveTicket`, and its immutable authorizing journal sequence is its version.
When the ticket's typed resume point permits recovery, the resolutions are
`Resume` and `Revoke`; an irreversible escalation such as
`DependencyRevoked` permits only `Revoke`. The application envelope
`ResolveNativeAction(action identity, authorizing sequence, resolution)`
validates the open action and maps the resolution to the existing pure
`ResumeTicket` or `RevokeTicket` event. It adds no domain transition.

A ticket's version is the latest journal sequence whose decision changed any
field of that ticket. It is derived from history and projected, not stored in
`Core`. Projection changes therefore include task-state, accounting, artifact
and other ticket mutations even when phase is unchanged; the former phase-only
delta is insufficient. Continuation, finalization, manual-dispatch and native-
action fences name this version.

The selector is an API client with a deliberately narrow service authority,
not a general ticket-command authority. It consumes project notifications and
current dispatchable views and may submit only
`ProposeDispatch(ticket, expectedTicketVersion, observedViewToken,
selectorDecisionReference)`. Acceptance creates an ordinary operation and
decision input through the same durable boundary as other operations; the
writer alone validates the recovery epoch, digest, ticket version and current
eligibility and commits `Dispatch(ticket)`. The selector cannot create,
release, revoke, complete or directly mutate tickets. Its monitoring,
deferrals, audit, attention and planned-next state remain in its own service.
An authoring agent is a distinct role and credential even if implemented by
the same software.

Only the ticket-service API accepts service-produced operations and results.
Selector workers have no ticket-service PostgreSQL credentials. Scheduler and
finalizer roles may register focused requests atomically with their own durable
records, but submit ticket results through authenticated API ingress and cannot
insert mailbox inputs directly. Current domain applicability remains the later
writer decision.

Runtime roles have no direct insert grant on the typed input/mailbox boundary.
Narrow functions such as `accept_operation`, `publish_continuation` and the I5
selector-proposal application boundary construct only their fixed kind. They
have pinned search paths, no dynamic SQL, no public execute grant and a dedicated
`NOLOGIN`, non-superuser owner rather than the migration superuser or a runtime
role. Constraints still enforce bounded vocabulary, ownership, identity and
references.

Authority-bearing request data uses typed columns and child rows, not a generic
JSON payload. Closed vocabularies have database checks; repeated bounded values
use child tables; canonical immutable bundles carry digests. I3 adds no
placeholder for revisions or resources that do not exist. The owning later
slice adds each validity-critical field and its decision fence together.

I3 migrates a populated I2 schema without losing operations or outcomes:
create and backfill typed inputs, retarget journal causes, replace the inbox,
verify counts and references, then drop operation-only columns and constraints.
Tests cover pending, succeeded, refused and cancelled operations and existing
journal causes. No compatibility view, legacy adapter, alias, dual write or
legacy-only test survives. More generally, when a slice replaces a runtime
type or implementation, all callers, tests, comments and vocabulary move in
that slice; historical migrations alone remain as upgrade history.

The cursor-driven emission implementation is removed completely in I3:
`JournalStore`, `DeskPort`, `WorldPorts`, the effect executor, checkpoints and
their crash-replay path. The transactionally materialized focused records are
their only replacement. There is no compatibility bridge and no dual delivery.

I3 introduces a typed `TicketServiceMetrics` port and brings I0 through I2 up
to it. Metrics are best-effort observations and cannot affect transactions.
Labels are closed bounded vocabularies and never tenant, project, ticket,
operation, request or principal identities. Durations use a monotonic process
clock; durable aging and deadlines use database time. I3 measures mailbox
depth and oldest age by class, backpressure, decision latency/outcome, quantum
exhaustion, continuation outcomes, focused request creation and native-action
lifecycle. Issue #141 owns the larger observability and analytics architecture;
that discussion does not make telemetry a domain authority.

I3's focused rows are real even though their consumers arrive later. I6 adds
scheduler tasks, attempts, results and cancellation processing; I7 adds
finalizer preparation, permits and reconciliation. I5 adds a dispatchable
projection and typed proposal path rather than selector request/result tables,
and no later service is simulated in memory.

### I4 decision record

I4 is an authenticated application boundary over durable API-owned state. It
does not load `Core`, acquire a project lease, append a journal entry or update
a ticket projection. Mutation submission and cancellation call the existing
`OperationInbox`; project and ticket reads use projections; authoring writes
only native draft and configuration relations. The API database role cannot
write a decision outcome or a project-primary projection, and a transport
handler receives no lower-level port through which it could do so.

Authorization is a port of the web application, not a flag trusted from a
request. Every operation read, cancellation, ordinary projection read and SSE
connection asks it for current access to the named project. An unknown resource
and a resource in a project the caller cannot currently access have one
not-found result. Authorization is rechecked before cancellation and before an
SSE session emits after any wait; an established connection is not a retained
grant. Elevated audit reads use a distinct capability and are not an alternate
ordinary-resource path.

The public operation representation is derived from the operation and decision
input rows. It exposes identity, acceptance time, public state and bounded
non-authoritative hold/progress metadata while pending. Success exposes the
decided project sequence; refusal exposes its stable safe code and decision
head/generation evidence; cancellation exposes no invented journal sequence.
It never exposes the stored command, authority subject, idempotency digest,
lease, provider or stack detail. Polling this representation is the canonical
completion protocol, including after an SSE gap.

Project reads return a project watermark and ticket rows whose own sequence is
no greater than it. A successful operation's decided sequence is therefore a
read-your-write lower bound: a read below it is retried rather than returned as
if current. List pagination is by stable project-local identity with an
explicit projection watermark, never by phase or update time. Reads do not ask
the ticket writer to activate a project.

Drafts are API-owned native records. Creating one atomically allocates its
never-reused project-local ticket identity and authoring version one. Every
typed edit compares the observed authoring version and, on success, writes the
next immutable draft revision and advances the draft pointer in one
transaction. A stale edit is a value, not a merge. Deletion writes the ticket
identity tombstone and advances the authoring history; it does not free the
identity. A released or deleted draft refuses later edits. The API role reaches
these transitions through constrained server functions rather than table-wide
update grants.

The public release command is `ReleaseDraft`, naming the draft's ticket,
observed authoring version and attached task-configuration revision. Public
`Decide` commands cannot carry a `ReleaseTicket` event once I4b lands. Mailbox
resolution reads the immutable named revision and produces the complete
`ReleaseTicket` candidate used by the pure writer, but that read grants no
authority: the deciding transaction locks the draft, rechecks the same version,
attachment and `Draft` state, then marks it `Released` in the transaction that
journals the candidate. A failed fence durably refuses the operation without
an entry. Thus the journal retains the fully resolved domain fact while no
caller can bypass or race native authoring state.

Task-configuration revisions are immutable, project-owned, canonically encoded
and content-digested. Creation validates structural bounds and prohibited
secret-bearing fields before persistence. Attaching one to a draft is a typed
authoring edit under the same observed-version comparison; attaching a revision
from another project is structurally impossible through the composite foreign
key. Semantic release readiness remains advisory here and authoritative only
at the serialized release decision.

SSE is an acceleration over a bounded durable project notification log, not
PostgreSQL `NOTIFY` as authority. Each notification contains only its monotone
project-local notification ordinal, kind, resource identity and the relevant
project sequence or authoring version. Decision notifications are inserted in
the deciding transaction; operation cancellation and authoring notifications
are inserted in their own state-changing transaction. Delivery may duplicate,
reorder across reconnects or stop. A cursor older than retained history returns
a reset marker and closes so the client refreshes projections and operations.

I4 lands in three ordered tranches. I4a adds the authorization application
contract, safe operation resources and projection reads over the existing I3
schema. I4b adds versioned draft and configuration authoring. I4c adds the
transactional bounded notification log and SSE cursor contract. Each tranche
includes adversarial authorization and database-role tests; no tranche adds an
HTTP framework dependency to the inner application contract.

### I5 decision record

I5 uses a selector-independent ticket-service boundary. The ticket service
publishes project changes, exposes a current digest-fenced dispatchable view and
accepts typed dispatch operations; it never creates selection requests, owns
selector attempts, receives deferrals or schedules reconsideration. The
selector independently decides when to observe, wait, plan and propose. This
replaces the request/result protocol anticipated before I5 without changing the
pure model: a committed `Dispatch(ticket)` remains the only authoritative
selection outcome.

The durable change feed reuses I4's bounded transactional
`project_notification` log. A ticket decision publishes its `Ticket`
notifications in the same transaction as the journal, operation outcome and
projections, and I5 adds a `Project` notification for lifecycle transitions
that change selector-visible availability. The selector obtains the bounded
inventory of projects it may monitor from the authenticated control-plane
application API, keeps a
project-local notification cursor in its own durable state, and reads the feed
through the authenticated ticket-service API. A retention gap returns I4's
`Reset`; the selector then reads the current dispatchable view and resumes at
the returned cursor. Periodic polling is the recovery mechanism. PostgreSQL
`LISTEN`/`NOTIFY` may later reduce latency for an API relay, but it is an
optional hint with no authoritative payload; selector correctness depends on
neither its delivery nor its payload.

Every committed journal decision transaction maintains a normalized current
dispatchable-view projection derived from its post-decision `Core`. The view
header carries tenant, project, recovery epoch, projection watermark, schema
version and canonical digest. Typed candidate rows carry ticket identity,
ticket version and the bounded readiness and immutable briefing facts needed by
the selector. Repeated facts use bounded child rows. Candidate identity order
makes paging deterministic but expresses no preference. The API returns one
complete logical view through watermark-pinned pages; if the current watermark
changes between pages it returns reset and the selector restarts. Replay
rebuilds the projection; no decision reads it as authority.

Strict view equality covers view schema, the complete candidate set, candidate
versions, readiness and every immutable execution-relevant briefing fact
exposed by the ticket service. It excludes the journal head, selector
implementation and internal policy, timestamps, provider accounting,
presentation metadata and advisory capacity, queue and cluster observations.
Current lifecycle, integrity and hard execution-backlog controls are separate
commit-time guards. A proposal may therefore survive an unrelated journal
advance, while a restore, relevant candidate change or eligibility change makes
it stale. I5 does not simulate scheduler capacity or backlog before I6 supplies
that authority.

Agentic dispatch enters as
`ProposeDispatch(ticket, expectedTicketVersion, observedViewToken,
selectorDecisionReference)`. The view token binds tenant, project, recovery
epoch, view schema, projection watermark and strict digest; the selector
decision reference is globally opaque and bounded. A narrow selector service
capability may submit this command and no other ticket mutation. Acceptance
uses ordinary operation idempotency, admission, priority, ordinal and readiness
machinery. The project writer recomputes the view from replayed `Core` and the
immutable retained contract references named by its journal and translates a
valid proposal to the pure `Dispatch(ticket)` event. A
recovery-epoch, digest, ticket-version or current-eligibility mismatch refuses
it as `SelectionChanged` without a journal entry. Selector workers have no
ticket-service PostgreSQL credentials.

One-shot manual dispatch enters as
`ManualDispatch(ticket, expectedTicketVersion)` under the distinct
`DispatchTicket` capability, included in ordinary project mutation access by
default and absent from read-only access. A version mismatch is
`TicketChanged`; a matching version that is not currently dispatchable is
`NotEnabled`. Manual dispatch uses the same ordinary admission path and pure
`Dispatch(ticket)` transition. I5 rejects newly submitted generic
`Decide(Dispatch)` commands while retaining an internal decoder for operations
durably accepted before the migration cutoff.

Selector monitoring, retries, reasons for waiting, provider failures,
capacity-aware timing and operational attention belong wholly to the selector
service. They never become project decision inputs, journal events, reservations
or ticket-service dispatch policy. The selector may publish a planned-next
ticket, ordered shortlist or other bounded planning intent, but that transparent
read model is revisable and non-authoritative: it cannot block manual dispatch,
reserve capacity, alter eligibility or give a later proposal precedence. A
proposal always means “dispatch this ticket now if its current fences and guards
pass.”

Projects do not configure selector prompts, models, providers, profiles or a
scheduling-policy schema. Platform operators own selector implementation,
safety, privacy, retention, region, cost and concurrency policy. The selector
nevertheless retains full bounded provenance for project readers: exact
versioned instructions and prompt content, observed views, safe project-scoped
active-work and capacity context, tool calls and bounded results, choices or
reasons for waiting, timing and accounting, attention, and implementation,
model and internal-policy revisions. Reads reauthorize current project access
and use ordinary not-found treatment. Credentials and unauthorized or
cross-project detail are never supplied or exposed. Hidden chain-of-thought is
neither requested nor retained; transparency covers the semantic inputs,
observable actions and outputs on which the selector relies.

Before an agentic choice crosses the service boundary, the selector atomically
records its semantic interaction, resulting choice or wait, current planning
intent and, for a choice, a durable proposal-delivery record under the selector
decision reference. Delivery is then at-least-once through ordinary operation
idempotency. A crash before submission leaves a retryable owned delivery; an
ambiguous API result is resolved by polling the operation. No cross-service
transaction is introduced, and a ticket-service operation never depends on
selector storage to decide or replay it. Selector audit later reconciles the
operation outcome for presentation.

Selector state is recovered and deleted under its owning service. I8 restore
causes pre-restore view tokens to fail their recovery-epoch fence and causes the
selector to reset cursors through the current feed/view APIs. I9 suspension or
integrity containment holds accepted ordinary proposals and prevents new
dispatch decisions without erasing selector audit. I10 stops project monitoring
and applies the project's retention and erasure policy to selector cursors,
provenance, attention and planning state.

### I6 decision record

Issue #143 tracks implementation. The following decisions refine the I6
landing row without changing the model. The deployable is the **execution
service** and the role it reaches its durable authority through is
**`chuggy_scheduler`**. It registers, admits, briefs and runs the work a
decision authorized, retains its verified results and submits `TaskDone` and
`ExecutionBlocked` through one narrow boundary. It resolves no logical task,
appends no journal entry, settles no operation and moves no ticket projection.

The capacity arithmetic is `model/capacity.qnt`'s, mirrored rather than
reinterpreted, and `execution_status_move_is_legal` restates the move relation
inside the server, where a direct table write cannot walk past it. Slot
ownership is derived from an execution's status rather than stored beside it,
so terminalization and cancellation each release exactly one slot. The model
proves these predicates over one state and not the scheduler's dynamics, so I6
adds no transition, reason or event; a proved capacity state machine is a
separate model-first change.

`execution_cluster` and `capacity_account` are installation-owned policy
rather than project state: keyed by `cluster` and by `account`, carrying no
composite project key and holding no unfinished work. Both carry a
`policy_revision`, because a release pins the stable account identity while
admission applies the current versioned entitlement, so allocation may change
without rewriting ticket history. The scheduler reads both and writes neither,
so it cannot provision the account it needs; a project made after the
migration would otherwise have none, and its first registration would fail the
foreign key tying an execution to the account it draws on. An `AFTER INSERT`
trigger on `project` provisions it, `SECURITY DEFINER` and owned by
`chuggy_boundary_owner`, so entitlement stays policy the scheduler may only
read.

`execution` is one logical task registration and the grain the slice is keyed
at. It is `chuggy_scheduler`'s, keyed `(tenant, project, execution)` with
`execution` alone unique, and foreign-keyed to its project, the request and
task that authorized it, the account it draws on, the revision it pinned and
the settlement it is given. Its immutable identity is the logical task rather
than the row: `execution_names_one_logical_task` is unique on
`(tenant, project, ticket, task)`, and that uniqueness is the idempotency key
making partial batch registration safe, since a retry creates the rows it is
missing and collides on the ones it made. It stores no provenance of its own
but reads it back through the request it names, so a registration cannot drift
from the effect that authorized it. Registration, admission, launch, attempt
accounting, cancellation and the terminal transaction change it, and its
unfinished work is found by status: queued rows for admission, slot-holding
rows with no live attempt for launch, everything outside `Terminal` and
`Cancelled` for a project's live work.

The role's grants are why a settlement cannot be forged rather than merely
discouraged. It may write `status`, `attempt_next`, `retries_spent`,
`placement_backoff_from` and `terminal_at` and nothing else, while a move to
`Terminal` needs the `outcome` and `completion_operation` that
`execution_outcome_is_whole` insists on and the role cannot write. Every
settlement goes through the completion boundary because a constraint says so.

Admission serializes on a transaction-scoped advisory lock keyed by the
cluster. `mayAdmit` counts over the whole ledger, so two admissions evaluating
it concurrently would each see room only one can have, and the obvious remedy
— locking the `execution_cluster` row — is unavailable, because locking needs
write privilege and capacity policy is not the scheduler's to write. The lock
serializes an arithmetic and confers no authority: that stays the durable
allocations, so no count is cached.

`execution_attempt` is the physical grain below that and `Core` never sees
one. It is the scheduler's, keyed
`(tenant, project, execution, attempt_number)` with `attempt` globally unique
and never reused, foreign-keyed to its execution and to the `recovery_epoch`
it was issued under. `execution_attempt_one_authoritative` is unique on
`(tenant, project, execution)` while an attempt is `Placing` or `Running`:
that partial index is the one-unfenced-reporter rule, held by the server
rather than by a process remembering. `generation` is the fence, may only
rise, and is enforced twice: it travels with the identity into every durable
move, so a move lands only where the named attempt is still unfenced at the
locked row, and a trigger refuses a result for an attempt already
`Superseded`. Opening, placement, ending and fencing are its transactions, and
its unfinished work is a live attempt whose lease has lapsed or, after a
restore, any live attempt from an older epoch.

`execution_result` and `execution_result_artifact` hold the one strict
versioned manifest a winning attempt produced. They are the scheduler's to
insert and nobody's to change, their triggers raising on update and delete
alike because a manifest that could be edited is not evidence; one result per
execution and one per attempt are unique constraints, which makes a second
contradictory manifest impossible rather than detectable. `manifest_ordinal`
is project-local and is the value the journaled input carries; the digest is
the control plane's and never the worker's, taken over canonical bytes binding
the manifest to its execution and attempt, so one grafted elsewhere disagrees
with itself. The transaction that writes it is the terminal transaction and
there is no other, so this relation has no recovery query of its own: a
recorded result whose execution has not reached `Terminal` is not a crash
window to sweep but an integrity check that must return nothing.

`scheduler_incident` is the durable form of the scheduler integrity incident
this document already requires. It is the scheduler's to insert and read,
keyed `(tenant, project, incident)` and foreign-keyed to its project, carrying
a closed kind and a bounded evidence label rather than free text. It is
written in the transaction that detected the contradiction and holds no work
of its own, so its recovery query is an operator reading a project's recent
incidents and nothing is blocked by one. Identical redelivery is absorbed and
a late result for retired or revoked work is auditable staleness; only a
second terminal claim contradicting the first is an incident.

I3's `execution_request` gains the mutable delivery fields I6 consumes and the
immutable pins it needs. The pins are the capacity account and the
configuration revision and digest; the delivery fields are the claim lease and
`state`, which moves `Open` to `Registered` once the executions a spawn
authorizes exist, `Registered` to `Fulfilled` once every registration under it
has settled, and to `Invalidated` when a cancellation for that ticket has
already retired the work it would have created — while a cancellation request
moves `Open` straight to `Fulfilled` once the retirement is durable, and not
once the workload is gone. Those are the only columns any role may update, and
the project writer that inserted the request never touches it again.
Registration fences on the authorizing sequence and not on the delivery state,
so a spawn claimed before a revocation and registered after it finds its tasks
fenced rather than resurrecting revoked work. Unfinished delivery is the
request's own state: an `Open` request whose claim is absent or lapsed is work
no process holds.

Completion crosses one boundary and that boundary is `submit_task_completion`:
a `SECURITY DEFINER` function owned by the same dedicated `NOLOGIN`
non-superuser `chuggy_boundary_owner` I3 gave `accept_operation` and
`publish_continuation`, and hardened the same way. Granting the scheduler
execute on it is not an exception to the rule that it submits through
authenticated ingress and never inserts mailbox inputs directly; it is how
that rule is enforced, because the role holds no privilege whatever on
`operation`, `decision_input`, `journal_entry` or `ticket_projection`, and
authentication is the database role itself. This adapter shares one PostgreSQL
between scheduler and inbox; an adapter whose two do not share a transaction
boundary needs a completion outbox and relay, implementing this same semantic
port rather than a different authority.

Validation of the binding is the function's and never the caller's, and the
envelope is built from durable rows rather than from arguments: a claim
disagreeing with the registration, its authorizing effect position or its
recorded result is refused, and only one that agrees becomes
`Decide(TaskDone(ticket, task, verdict, result))`, held to the same
`ticket_command_is_valid` as every other ingress. The model's result reference
is positive integers, so the authoritative digest is folded over a bounded
prefix; the fold is deliberately not injective, because the authority remains
the full digest and manifest identity on the execution row. An
`ExecutionBlocked` completion carries the ticket, one bounded reason and no
manifest.

That function is the whole terminal transaction, which is why it is one
function and not three. Under the locked execution and project rows the
verified manifest, the ingress ordinal, the operation under authority kind
`ExecutionScheduler` with `CorrectnessReducing` admission, the
`Completion`-priority decision input, the readiness advance and the move to
`Terminal` land together or not at all — and because slot ownership is derived
from status, that last move is what releases the capacity slot. So the window
between holding a verified result and telling anyone about it is removed
rather than shortened. The operation's idempotency key is the execution
identity, so one logical task yields one completion and no more, and a
resubmission is answered with the operation already recorded, which is how
identical redelivery is absorbed below the journal at the immutable effect
identity. A project in `Retention` is not admitted, and current domain
applicability stays the writer's later decision.

The two inabilities are kept apart at the port rather than the call site,
which is why the policy and placement ports answer with three arms and not a
boolean. `Denied` is definitive and becomes `ExecutionBlocked` under one of
the model's existing bounded reasons; `Unavailable` is temporary, withdraws
the attempt without spending the safe retry budget and leaves the execution
visibly held. When that budget is spent the execution terminalizes as a single
failed `TaskDone` carrying the explicit empty manifest that says it produced
no handoffs, which is the exhausted-retry outcome and not a fabricated
verdict. Blocking retires one execution and not its siblings:
`ExecutionBlocked` escalates the ticket while the decider emits only
`OpenHumanTask`, so no cancellation obligation reaches the scheduler, those
siblings drain, and the writer refuses their completions as auditable
staleness.

The two things the scheduler tells the rest of the installation are separate
ports because they carry different authority. `project_active_work` is
advisory — one project's own active counts beside the cluster total and that
project's entitlement, the only cross-project fact the type can express. It
reserves nothing, alters no eligibility and is excluded from the strict
dispatchable-view digest, so a proposal must survive it changing underneath.
`execution_backlog` is the opposite: the hard backlog guard is authoritative,
consulted at ingress after authorization and before the inbox accepts, and
pauses automatic and manual dispatch through the same call. It is retryable
infrastructure backpressure and not `Core` state, ticket eligibility or a
selector reservation, and it preserves headroom by being narrow rather than by
reserving — only a `Dispatch` decision needs scheduler headroom, so every
other decision stays admissible while dispatch is paused.

Scheduler diagnostics carry closed bounded vocabularies and no identities, and
nothing here persists a rendered prompt, a credential, an unrestricted log,
source material or arbitrary model output. Telemetry is not an authority.

I6 briefs the worker it launches: issue #143 names it in its own title, and
the accepted proposal of issue #97 settles its shape. A template owns a role
and ticket data fills its slots: the roles are `Work` and `Review`, one brief
drawn from the pinned configuration serves both, and only the purpose-specific
block and the practices scoped to that role differ. Practices resolve through
a finite trusted catalog, each carrying an instruction and a scope; one that
is missing or named twice refuses the launch under `TicketConfigIncompatible`,
a reason the model already has, so briefing needs no model change. The section
order is one array the renderer drops empty sections from, so an absent
optional section cannot reorder its neighbours. A retry renders the same
briefing because the input is content-addressed: `PinnedConfigurationPort` has
no spelling for "current", it is asked for the revision the execution row
pinned at registration, and what comes back is refused unless its own revision
and digest are that one, so a rewritten revision is a refusal rather than a
different prompt and the bounded runtime facts the adapter gathers are the
only moving input. What is retained is provenance, a type with no field a
prompt, a credential or source material could be put in. What the templates
say is authored rather than derived — issue #97 fixes the sections and
deliberately not their wording — so it is versioned by
`briefingTemplateVersion` and is the part of this a reviewer should argue
with.

Composition can only narrow authority, and that is a property of the shape
rather than a rule for callers to keep. `TaskAuthority` holds what structured
task policy granted behind a symbol its module does not export, so nothing
else can build one or replace the grant inside it, and the meet that narrows
it filters the values already held rather than reading the request's, so its
result is a subset of the grant whatever a request asks for. Intersection,
conjunction and a minimum over a total order are each commutative and
associative, so folding requests is taking their meet: permuting the composed
blocks yields the same authority and appending one can only lower it —
stronger than forbidding a later block to widen what an earlier one narrowed.
A request is structured data and never prose, so a briefing may ask an agent
to run a suite while what it may actually run is decided by a value that never
met the sentence asking. The template's own request leads the fold and takes
completion authority away, so a briefed worker cannot conclude its own task
even where policy granted it: it reports a manifest and the scheduler submits
the completion.

I6 adds no input-bundle relation: a bundle today would hold the request's own
ticket, task set, provenance and pinned revision and a digest derived from
them, so a registration pins the request identity and the revision instead,
and the relation arrives with the slice that gives it references of its own to
hold. Artifact verification is a typed port here and its project-owned storage
adapter is not; the completion boundary is reached only after that port
confirms every required result durably present with matching digest and
schema, so an incomplete upload cannot yield a successful verdict and
permanent loss is a definitive execution failure.

I7 consumes none of these relations and adds its own preparation, permit and
reconciliation records with the sole `FinalizationResult` authority;
finalization takes no task slot, so it draws on no `capacity_account`
entitlement and registers no `execution`. I8 advances the recovery epoch on
restore, which is why every attempt names the epoch it was issued under: an
old-epoch worker fails its fence, and inventory reconciles executions and
workloads through these rows. I9 contains a corrupt project locally, which a
scheduler incident already respects by being project-scoped, and suspension
stops admission without a domain event. I10 closes a project only once its
attempts are terminal and its capacity released, and applies the project's
retention and erasure policy to attempts, manifests, artifacts and incidents
inside the project boundary they were written under.

| Slice | Depends on | What lands and its definition of done | Status |
|---|---|---|---|
| M0 | — | Project-scoped sparse-ID `Core`, vocabulary and transition migration | Landed |
| G0 | M0 | Generated TypeScript model API declarations from issue #98 | Landed |
| I0 | M0, G0 | PostgreSQL foundation: lifecycle rows, composite keys, roles, ownership lease and fencing epoch, expected-head journal append, recovery epoch | Landed |
| I1 | I0 | Authority-scoped operation and idempotency rows, ingress ordinal, durable inbox and readiness generation, cancellation race | Landed |
| I2 | I1 | The project decision transaction: replay and load, lifecycle, lease and expected-head fences, journal entry under one durable cause, operation terminalization, inbox acknowledgement and primary projection update, with refusal writing no entry and an ambiguous commit resolved by durable read | Landed |
| I3 | I2 | Bounded project mailbox, priority and aging, durable deterministic continuations, focused native-action and consumer-request tables | Landed |
| I4 | I3 | Authenticated native reads, operation polling and cancellation, versioned configuration and draft authoring, revision-fenced release, bounded access-controlled SSE notifications | Landed |
| I5 | I3, I4 | Selector-independent dispatch: durable project-change consumption, current digest-fenced dispatchable views, narrowly authorized agentic proposals and one-shot manual dispatch, plus the selector-owned durable cursor, delivery, transparent provenance, attention and planning read model. Selector timing, monitoring and deferral remain outside the ticket service, and selection failure never becomes a hidden FIFO dispatch policy. | — |
| I6 | I3 | Scheduler registration, capacity admission, attempt/result-manifest handling, completion authority and revocation cancellation, plus bounded project-safe active-work and capacity context for the selector and the authoritative hard execution-backlog dispatch guard. Task completion is exactly one idempotent project inbox input; current policy denial uses `ExecutionBlocked`. | — |
| I7 | I6 | The finalizer service: durable queue, preparation, approval, commit-permit and reconciliation records, Git promotion, typed failure evidence that transactionally becomes any resulting rework bundle, and sole `FinalizationResult` submission authority. Proven with merge-conflict rework receiving its exact immutable attempt/target/conflict manifest, revocation racing `Finalizing` entry, closure during `Finalizing`, and old-epoch executors that cannot conclude after takeover. | — |
| I8 | I0–I7 | Managed PostgreSQL deployment, backup/restore, fresh recovery epoch and inventory/reconciliation of Git, blobs, executions, permits and selector cursors. Old-epoch actors and selector observations remain rejected after restore. | — |
| I9 | I2–I8 | Project-local integrity containment, suspension and audited repair. A corrupt project fails closed while unrelated projects continue. | — |
| I10 | I6–I9 | Deletion lifecycle: fenced closure writer, execution/finalization quiescence, selector-monitor shutdown, retention, erasure and permanent non-sensitive identity tombstone. Integrity-blocked deletion follows its distinct frozen-evidence path. | — |
