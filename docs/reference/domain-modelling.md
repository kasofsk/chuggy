# Modelling the domain

What goes inside the core, and what shape it takes. [layering.md](./layering.md) is the structure; this is the content. Same convention: each rule in its general form, with a **Here:** line saying how it binds in this tree.

One caution before the patterns. The tactical DDD catalogue was written for an object model in which behaviour hangs off entities, and this core is a pure function over data. Most of the catalogue survives that change unaltered, because most of it is about *where a rule lives* rather than about method dispatch. Where it does not survive, the reasoning is recorded in [003-layering-and-domain-canon.md](../design/003-layering-and-domain-canon.md) rather than quietly dropped.

## The language is the model

**A term means one thing, everywhere it appears** — in the model, in the docs, in the code, and in the sentence someone says out loud. This is the ubiquitous language, and it is the cheapest correctness tool available: a disagreement about a word is a disagreement about the machine, surfaced before it is built.

Three rules make it real:

- **The same noun, or a different noun.** A concept that is called `Ticket` in the model and `Job` in an adapter has two names because someone declined to decide whether they are the same thing. Rename in the model, the docs and the code as one change.
- **A qualifier is a missing distinction.** When prose has to say "the *dispatcher's* ready set" to be unambiguous, the model is short a concept or carrying an overloaded one.
- **Which doc defines a term is itself recorded.** [concepts.md](../concepts.md) is the routing table; a term explained twice will drift in one of the two copies, and the reader cannot tell which.

**Here:** `model/measure.qnt` holds the record vocabulary and `model/domain.qnt` the machine, so the language has a machine-checked home — which is unusual and worth exploiting. A word that cannot be pointed at in the model is a word the implementation invented.

## Invariants first, records second

An **aggregate** is a cluster of data treated as one unit for the purpose of consistency: it has a root, outside references address only the root, and every invariant it claims holds at the end of every decision that touches it. The point of the pattern is the boundary, not the clustering — "Model true invariants in consistency boundaries" is the rule, and the corollary is that data with no invariant binding it together does not need to be one aggregate.

**Design small aggregates.** "Limit the Aggregate to just the Root Entity and a minimal number of attributes … The correct minimum is however many are necessary, and no more" (Vernon). *Why:* a large aggregate is a large lock and a large replay, and it makes unrelated changes contend.

**Reference other aggregates by identity.** Hold the id, not the object. *Why:* an object reference is an invitation to traverse and mutate across a boundary the invariants do not cover, and it makes the serialized form a graph rather than a record.

**Here:** the ticket is the aggregate; its dependencies are ids, and the whole state is a map from id to ticket ([architecture.md](./architecture.md)). A decider takes a view and an event, never a live neighbour.

**The transaction is the decision, not the aggregate.** The canon's fourth rule — one aggregate per transaction, eventual consistency outside the boundary — assumes a database transaction is what commits. Here the unit that commits is one journal entry, and one decision may legitimately touch several tickets: the revoke cascade parks every doomed ticket in the same decision, and that atomicity is a proved invariant rather than a convenience. So the rule lands in its general form: **a decision either carries its whole consistency argument or is not journalled.** What is still forbidden is the thing the canon was protecting against — spreading one invariant across two decisions and trusting the second to arrive.

## Entities, values, and identifiers

- An **entity** has an identity that survives change: two entities are the same when their identifiers match, whatever their fields say.
- A **value object** has no identity. It is equal by its contents, it is immutable, and it is where an invariant *about a value* lives — a quantity that cannot be negative, an identifier that must match a shape.
- **Prefer the value object to the primitive.** A concept carried as a bare `string` or `number` is a concept the compiler cannot check and grep cannot find. *Why:* primitive obsession is how a task id gets passed where a ticket id belongs, in a codebase where both are integers and the argument list is positional.

**Here:** identifiers are distinct types, not aliases for `number`, and records are `readonly`. TypeScript's structural typing makes this an explicit act — two aliases of `number` are the same type, so the distinction has to be branded to exist at all.

## Make illegal states unrepresentable

> "Use a data structure that makes illegal states unrepresentable. Model your data using the most precise data structure you reasonably can." — King

Concretely, three habits:

- **A field that is meaningful in only one phase belongs to that phase's variant**, not to the record as an optional. An optional field is a runtime question asked at every use site; a variant is a compile-time answer given once.
- **Every union is switched exhaustively**, with the default arm proving the switch total ([style.md](./style.md) rule 9). *Why:* this is the property that makes adding a case a compile error at every site that must change, which is the single largest safety return TypeScript offers.
- **A constructor that cannot refuse is a constructor that lies.** Build the refusal into the type — a parse returning either the value or a reason — rather than a `validate` call the caller may forget.

## Behaviour belongs with the data — and a pure core is not anemic

Fowler's warning stands: an anemic model has "hardly any behavior on these objects, making them little more than bags of getters and setters", and it "incur[s] all of the costs of a domain model, without yielding any of the benefits". Evans' diagnosis of how it happens is the sharper half — "the more common mistake is to give up too easily on fitting the behavior into an appropriate object, gradually slipping toward procedural programming".

**The smell is dispersal, not the absence of methods.** A rule about a ticket that lives in an HTTP handler, an adapter or the actor loop is the anti-pattern in any language. A rule expressed as a pure function beside the type it governs is not: data and process are together in the unit that matters, which is the module. What the object-oriented spelling buys — the rule cannot be bypassed, because the state it guards is reachable only through it — is bought here by the boundary rule and the single writer instead.

*The test:* can the rule be stated by naming one domain module? If answering needs an adapter or the loop, it has leaked, and moving it is the fix.

## Domain services and application services

Two things share the word *service*, and conflating them is how business logic ends up in orchestration code.

- A **domain service** is a domain operation that belongs to no single entity — it reads several, and it is still pure, still inside the domain. **Here:** the deciders that read state belonging to more than one ticket, which is exactly the global half of the [authority split](./architecture.md#the-authority-split).
- An **application service** orchestrates: gather, call, journal, dispatch. It is thin, it holds no rules, and it holds no domain state. **Here:** the actor loop.

*The trigger to act:* an application service that has grown a conditional over domain state has stopped being one. The conditional is a decision, and it belongs in a decider.

## Persistence

The canon's rule is persistence ignorance: the domain layer takes no dependency on storage, and a repository provides the illusion of an in-memory collection of aggregate roots so that it can. Palermo's version is blunter — "The database is not the center. It is external."

**Here there is no repository, and adding one would be the mistake.** The actor holds state in memory and the journal is the record ([architecture.md](./architecture.md#the-single-writer)), so a repository would be an abstraction over a fold — indirection with nothing on the other side of it. What the canon's rule actually buys here is the *ignorance*: no storage vocabulary in the domain, no schema-shaped records, no field that exists because a serializer wanted it.

*Revival condition:* when something other than the actor needs to query state, it gets a projection built from the journal — a read model with its own shape — never a query interface into the aggregate.

## Events and effects

An **event** is a fact: something that happened, named in the past tense, in the language above. An effect is an instruction to the world, and it is defined at [architecture.md](./architecture.md#deciders-and-effects).

Keep them apart in naming and in kind. `TicketRevoked` is a fact and stays true forever; `CancelTasks` is an instruction that can fail, be retried, or arrive twice. *Why:* a record of instructions cannot be replayed into state, and a stream of facts cannot be executed — collapsing the two produces a journal that is neither.

## Bounded contexts

A **bounded context** is the boundary within which one model and one language apply. The pattern exists because "total unification of the domain model for a large system will not be feasible or cost-effective" (Fowler): two groups use the same word for different things, and a single model that serves both serves neither.

**Here: chuggy is one bounded context**, and every external system — the forge, the fabric, the agent runtime — is a foreign one reached through a port. That makes each port's translation an anti-corruption layer whether or not it is called one ([layering.md](./layering.md)), and it is why a foreign identifier is a foreign identifier in the domain's own terms rather than that system's type.

*The trigger to revisit:* a second meaning for a modelled word that cannot be renamed away — the same noun genuinely meaning two things to two audiences — is the first evidence of a second context, and it is a design decision rather than a refactor.

## Where these come from

- [Evans, *Domain-Driven Design*](https://www.domainlanguage.com/ddd/) — the source of the language, aggregate, entity, value object, service and bounded context patterns.
- [Vernon, *Effective Aggregate Design*](https://www.dddcommunity.org/library/vernon_2011/) — the four rules of thumb for aggregate boundaries.
- [Fowler, *AnemicDomainModel*](https://martinfowler.com/bliki/AnemicDomainModel.html) — the anti-pattern, and Evans' diagnosis of how it happens.
- [Fowler, *BoundedContext*](https://martinfowler.com/bliki/BoundedContext.html) — why one model does not scale across audiences.
- [King, *Parse, don't validate*](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — precise types at the boundary.
- [Chassaing, *Functional event sourcing decider*](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider) — the pure decide/evolve pair this core's shape follows.
