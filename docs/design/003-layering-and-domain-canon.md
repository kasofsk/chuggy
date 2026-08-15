# Adopting the layering and domain-modelling canon

**Status: STANDING** — decisions in force, not a plan. Nothing here is scheduled work.

## Why this document exists

[layering.md](../reference/layering.md) and [domain-modelling.md](../reference/domain-modelling.md) state the practice as rules. This page states which parts of the canon those rules **decline**, and why — because "follow DDD" is an instruction to import a catalogue, and most of the catalogue was written for a different runtime shape than a single journaled actor over a proved model.

That is the same failure [001-what-chuggy-is-not.md](./001-what-chuggy-is-not.md) exists for, in a second domain. A refused pattern leaves no trace in any diff: nobody can see the repository that was not added, so the next author adds one, in good faith, citing the same books. The argument has to be written down once or paid for every time.

Nothing here restates a rule from the two reference pages. They hold the rules; this holds the decisions behind them.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The dependency rule is the whole structural commitment.** The four traditions — layers, hexagonal, onion, clean — are treated as one idea in four vocabularies, and no tradition's ring count is adopted. | They agree on the rule and disagree on the packaging. Adopting one tradition's diagram imports its ceremony and buys nothing the rule does not already give. |
| D2 | **Evans' layer vocabulary is adopted for responsibility; his layout is not.** The tree is domain, interpreter, adapters. | The vocabulary is how responsibility gets argued about precisely. The folder layout is a 2003 answer to a question about packaging that this tree answers with a graph check. |
| D3 | **The aggregate is the ticket; the consistency boundary is the decision.** | The canon's one-aggregate-per-transaction rule assumes a database transaction commits. Here a journal entry commits, and the cascade's atomicity across several tickets is a proved invariant rather than a shortcut. |
| D4 | **A pure functional core, not an object model.** The anemic-model warning is kept, restated as a rule about dispersal rather than about methods. | The warning's content is that rules must not scatter into orchestration. Its object-oriented spelling is a mechanism for that, and the boundary rule plus the single writer are a stronger one here. |
| D5 | **No repository, no ORM, no persistence layer.** Persistence *ignorance* is kept; the pattern that usually delivers it is not. | The actor's state is in memory and the journal is the record. A repository over a fold is indirection with nothing on the far side. |
| D6 | **No DTO tier.** Data is parsed into domain types at the boundary, and wire types are derived from the schema. | A DTO layer whose members map one-to-one onto domain types is a rename tax. The property worth having is the parse, not the extra type. |
| D7 | **One bounded context.** Every external system is a foreign context behind a port that translates. | The pattern earns its cost when two audiences genuinely mean different things by one word. Inside chuggy they do not, and a context boundary drawn early is a boundary drawn without evidence. |
| D8 | **No strategic-DDD apparatus as standing documents** — no context map, no subdomain classification, no event-storming artefacts kept as reference docs. | Each is a workshop output that decays into a wrong picture nobody re-runs. When a distinction from one of them turns out to matter, it lands as a rule or a model change, which are the two things that get checked. |
| D9 | **Five tactical patterns are deferred with revival conditions**, listed below rather than adopted on the strength of being standard. | Each is a real answer to a real problem this tree does not yet have. Adopting one before its problem arrives buys the cost immediately and the benefit never. |

## The deferred five

**An in-process domain-event bus.** The usual DDD arrangement raises events from aggregates and dispatches them to handlers that update other aggregates. Here that would be a second decision-maker: the handler decides something, and the actor did not. Cross-ticket consequences belong in the deciding step, which is what makes the cascade provable. *Revival condition:* a consumer that observes and never decides — a metrics sink, a notifier — which is a projection over the journal rather than a bus.

**A CQRS read model.** Nothing yet reads state except the actor, and a projection with one consumer is a cache with extra steps. *Revival condition:* the first consumer that needs a query the actor's in-memory state does not answer cheaply — an operator UI over history is the likely one — at which point it is built from the journal and never as a query interface into the aggregate.

**A dependency-injection container.** Ports are wired at one composition point, and there is exactly one of it. A container replaces a call site the compiler checks with configuration it does not. *Revival condition:* more wiring variants than a human can hold — several fabric adapters, several deployments — and even then the first attempt is a function per deployment.

**A service class per use case.** The application layer is thin by rule, so a class per use case is a file per verb, each with one method. *Revival condition:* a use case with genuine internal structure, which will look like an orchestration that survives across several events rather than one turn of the loop.

**Always-valid entities enforced by throwing constructors.** The property is kept — an invalid domain value is unconstructable — and the mechanism is a parse that returns a refusal rather than a constructor that throws. *Why:* a throw is an invisible control-flow edge in a core whose whole value is that its behaviour is a function of its inputs, and a refusal a decider must handle is one the compiler can insist on.

## What was taken unchanged, and is worth naming

Three imports carry their original arguments intact, and are cited here so a reader can tell adoption from coincidence.

**Vernon's aggregate rules** — true invariants in consistency boundaries, small aggregates, reference by identity — survive the move to a functional core untouched, because all three are about boundaries rather than about objects. Only the fourth, eventual consistency outside the boundary, needed the restatement in D3.

**Cockburn's symmetry** — that a driving actor and a driven one are the same shape of problem — is why the ports here are not split into "inputs" and "infrastructure". It also supplies the testability claim in its honest form: substitution happens at the port, so the core is testable *because* of the boundary, not merely alongside it.

**King's parse-don't-validate** is the rule that makes the boundary load-bearing rather than decorative. A boundary that passes strings through and re-checks them deeper is a boundary in the diagram only, and this is the failure that would be hardest to see in review, because every individual re-check looks defensive and correct.

## How to tell this was wrong

Three observations would each refute a decision above, and are worth watching for rather than arguing about in advance.

- **D5** fails if the actor's state stops fitting in memory or stops being cheap to rebuild. The symptom is replay time at boot, and the answer is a snapshot plus the journal, not a repository.
- **D6** fails if the wire and the domain diverge enough that the parse is doing real structural translation at many sites. The symptom is mapping code with branches in it; at that point the translation is a model of its own and deserves a name.
- **D1/D2** fail if the three-part tree stops describing where things actually are — if a fourth home appears that is none of domain, interpreter or adapter. The symptom is a directory whose name is a technology.

## Sources

The rules' sources are listed at the foot of each reference page. Two are load-bearing for the decisions here specifically: [Vernon's *Effective Aggregate Design*](https://www.dddcommunity.org/library/vernon_2011/) for D3, and [Fowler's *AnemicDomainModel*](https://martinfowler.com/bliki/AnemicDomainModel.html) for D4 — the second because the decision is to keep its warning while rejecting its premise, and that is only defensible against what it actually says.
