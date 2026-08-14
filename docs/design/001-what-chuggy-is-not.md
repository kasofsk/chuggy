# What chuggy is not

**Status: STANDING** — decisions in force, not a plan. Nothing here is scheduled work.

## Why this document exists

A proved model is the best possible record of what a system *does*. It is no record at all of what a system deliberately **does not** do, because an absence has nothing to state it, and none of the twenty-three invariants can say "we considered a tournament and rejected it."

That is the failure this page prevents. A shed rejected alternative names no path, no constant and no link; it has no signature in any diff, and it stays invisible until someone re-proposes the rejected thing with no argument to hand. So the decisions collected here are exactly the ones that are absences — each with the argument that produced it, because a "no" without its reason gets relitigated on the first inconvenience.

These were taken across the model's design and its first implementation decisions. Where one has since been overturned, the reversal is recorded in place rather than by deletion.

## Absences

**Token and API spend are observed, never modelled.** Cost is first-class in the implementation's accounting and dashboards, and it is not a machine variable. The model keeps exactly one fungible account. *Why:* a second currency doubles every pricing decision and every termination argument, and buys a number a dashboard can compute from the outside.

**No tournament.** Parallelism is task structure inside a phase — many tasks may run at once — not competing implementations racing to land. The proved property is exactly one landing per ticket. *Why:* a tournament makes the landing boundary a selection problem, and the exclusivity invariant is the one property everything else rests on.

**No scheduler, no queue, no fairness, no slot count.** Which ready ticket runs next is an unrestricted choice, and the dispatcher making it is itself agentic. Any real policy — priority, an LLM's judgement, whatever — refines unrestricted choice, so the model admits them all without naming any.

**No retry machinery below the cycle.** No attempt counter, no per-task budget, no work-retries wall. The fabric relaunches a failed task; the model prices *cycles*, not relaunches.

**Waiting is unbounded, by decision.** Every account bounds what a ticket can **do**; nothing bounds how long it **waits** — for an author to release a draft, for the dispatcher to choose it, for the gate to free a slot. Closing that would need weak fairness in its per-ticket form ("a ticket that stays continuously ready is eventually dispatched"), which contradicts the no-fairness absence above. Note the action-level reading would not suffice either: the dispatch choice ranges over the whole ready set, so a dispatcher forever preferring other work dispatches infinitely often and still starves one ticket. *Accepted, deliberately:* if there is always more pressing work, that is a real possibility, and a ticket that stops being chosen sits flat rather than churning. This is the row that narrowed an earlier commitment to per-ticket liveness, which was not provable against the standing no-fairness position.

**No dashboard in the model.** A dashboard consumes state and never causes a transition.

## Rejected alternatives

**Kubernetes as the fabric.** A macOS node requires a virtual-kubelet provider that wraps every task in a VM and, in doing so, gives up pod logs, secrets, config maps and volumes — the four things an agent task most needs. Mobile work is a priority, so the nodes that cannot be given up are exactly the ones Kubernetes serves worst. *Revival condition:* Kubernetes becomes reasonable again if macOS stops mattering.

**A VM per task**, despite being the textbook answer for iOS CI. Rejected on the same evidence: the isolation is real and the cost is a two-VM ceiling per host.

**Controllers and CRDs as the runtime shape.** The alternative was a reconciler-shaped fabric rather than a service plus dumb dispatched jobs. The argument against was not technical inferiority — it was that adapting the core abstraction to a platform forces you to think in the shapes the platform wants rather than the shapes the objective wants. The counter-argument, granted, is that a design is reasonably informed by what it runs on. What settled it: **the model is the standing answer to the capture worry.** The domain machine carries no platform vocabulary, and every runtime shape must refine the same machine, so a later controller migration re-proves the same obligations against a byte-identical core. Platform capture is precisely what the refinement obligation forbids. A controller shape remains purchasable on those terms.

**Grouping — batching several tickets into one landing.** Built, then removed. Three reasons in order of weight. The adopted reading refused only a *direct* dependency from the group's lead onto a member, while the union's drop-out rewrote the dependency graph at arbitrary distance — two hops were enough to build a reachable dependency cycle that no invariant could see, because the acyclicity check reads stored dependencies and absorption never rewrote those. It was also not modelling the thing it was named after: a real batch mints a fresh job that composes its members' briefs and evaluator lists, where this absorbed an ordinary ticket as the carrier, carrying grouping's whole cost while modelling none of its content. And nothing needs it — a batch is expressible as an ordinary ticket whose brief covers the members' work. *Revival condition:* the fresh-job reading, with a convexity precondition on the member set.

**Citation-scoped evaluation — skipping an evaluator whose subject did not change.** Built, then removed. Evaluators published a footprint of the code regions they cared about, work attempts published what they touched, and a rework carried over any retained passing verdict whose footprint was disjoint from the change instead of re-running it. It was careful work — conservative on both sides, with silence never buying a skip — and it is out for two reasons. It is an **optimization**: it makes rework cheaper, not more correct, and the domain model's job is to say what is correct. And its soundness rests on **evaluator honesty**, which the model explicitly declined to model — an evaluator that under-cites gets a stale verdict carried, and whether to trust a claimed footprint was left as an implementation policy question. A mechanism whose correctness depends on something outside the model is in the wrong layer. *Revival condition:* as an implementation-side policy in the evaluator middleware, where the trust question can actually be answered, and where a wrong answer costs a redundant run rather than a false pass.

**An unbounded rework policy.** Removing the rework bound entirely — letting gas alone meter it — was considered and rejected: per-ticket work-boundedness would become conditional on middleware behaviour rather than on a model constant. The bound stays, expressed as a policy parameter rather than a core constant, so the account is middleware-owned in the implementation and a measure digit in the model.

## In scope by silence

Three capabilities were never ruled out and are admitted by nothing built so far: **multi-tenancy**, **dynamic DAGs** (tickets spawning tickets), and **cross-cluster**. Dynamic DAGs look deliberate; the other two look expensive to mean by accident. Each enters only by explicit decision. Until then the machine forbids them structurally — tickets arrive only by authoring, and no ticket-event decider creates a ticket.

## Open, and known to be open

**The eval vocabulary.** The interpreter runs an authored program of stages under per-stage verdict combinators, and that shape was extracted from the predecessor's own specification rather than decided here. It stands in until one real eval program is written for one real job type. Two distinctions it currently flattens and should not flatten forever: an abort verdict that skips remaining rework, and an infrastructure failure that escalates immediately rather than reworking.

**Landing requirements.** The merge gate, its depth-1 serialization, the path rule determining which promotion effect fires, and the eviction pricing are all built against **derived** requirements — the modeller's best reading of the predecessor's specification and its machine-checked findings, not a stated requirement. They are marked proposed in the model's own commentary and each mechanic names the requirement that forces it, so a torn-up requirement maps to deletable code rather than archaeology.

**The wrap-up resource namespace.** `WExclusive` carries a bare resource token, so a repo lease and an environment lease share one namespace and can collide. A single namespace is simpler and a collision is an authoring error; if those turn out to be common, giving the resource a kind is the fix.

**System quiescence.** Per-ticket work-boundedness is the committed theorem. Whether the whole system provably comes to rest under a bounded environment is a strictly stronger claim, attempted if at all in a severable module that constrains nothing if abandoned.

**A bound on landing-queue wait.** Every gate occupancy has an enabled resolution and every resolution frees the slot in the same step, so the queue always advances past its head. How long an enqueued ticket waits is not bounded — the accepted-unbounded position above, applied at the gate.
