# Layering

Where code goes, and which way its dependencies point.

This page is the **generic** practice — what would be true of any system built this way. [architecture.md](./architecture.md) is what chuggy does with it, and owns the terms it defines: port, decider, effect, the authority split. Each rule here is stated in its general form, and a **Here:** line says how it binds in this tree.

The canon is one idea under four names — Evans' layered architecture, Cockburn's ports and adapters, Palermo's onion, Martin's clean architecture. They disagree about how many rings to draw and what to call them. They agree on the rule below, and the rule is the part that binds.

## The rule: dependencies point inward

> "Source code dependencies can only point inwards. Nothing in an inner circle can know anything at all about something in an outer circle." — Martin

Palermo's phrasing is "all coupling is toward the center"; Evans' is that a layer "depends only on the layers below"; Cockburn states the consequence — "Code pertaining to the inside part should not leak into the outside part" — so that the same application can "equally be driven by users, programs, automated test or batch scripts". One rule, four dialects.

Four things follow, and between them they are the whole of the discipline.

**Control flow may point outward; the dependency may not.** The core reaches the world constantly. It does so through an interface the core declares and something outside implements — that inversion is the entire mechanism, and everything else on this page is a consequence of it.

**A type is a dependency, and so is a name.** A domain function whose parameter is a fabric's allocation handle is coupled to that fabric without importing it, and a domain field named `allocId` has imported its vocabulary without importing its types. *Why:* the cost of coupling is paid when the outer thing changes, and a stolen noun changes with it exactly as a stolen type does.

**The rule is about the graph, not the file.** A helper three imports deep leaks as effectively as a direct import. *Why:* every per-file check passes on a domain path-joining helper that imports `node:path` and is called by a decider, which is why [style.md](./style.md) rule 7 is transitive reachability.

**Inward is a direction, not a folder count.** Two layers with a boundary that is actually enforced beat five with nominal ones. *Why:* the value is in what the rule forbids, and a boundary nothing checks forbids nothing.

**Here:** `src/domain/` <!-- intent --> depends on nothing outside itself — not the interpreter, not an adapter, not a Node builtin, not an ambient capability. That is [style.md](./style.md) rules 7 and 8, and it is the one boundary in this tree that a graph check will enforce rather than a reviewer.

## The layers

| Layer | Owns | Here |
|---|---|---|
| **Domain** | "representing concepts of the business, information about the business situation, and business rules … the heart of business software" (Evans) | `src/domain/` <!-- intent --> — the deciders, the record vocabulary, the invariants `model/` proves |
| **Application** | "Defines the jobs the software is supposed to do and directs the expressive domain objects to work out problems … kept thin. It does not contain business rules or knowledge" (Evans) | the actor loop and `src/interpret.ts` <!-- intent --> |
| **Adapters** | translation in both directions, one per external system, no rules of its own | `src/adapters/` <!-- intent --> |
| **Infrastructure** | the world itself — the fabric, the forge, the filesystem, the clock | outside this tree |

**The application layer decides nothing.** Its job is sequencing: gather the view, call the decider, journal the decision, hand the effects to the interpreter. A conditional in that loop that inspects a ticket's phase and chooses differently is a decider in the wrong place. *Why:* the model proves the deciders and knows nothing of the loop, so a decision taken there is a decision nothing checks — and it will be found by a trace that diverges rather than by review.

**A layer is logical; a tier is physical.** "The term 'layer' is … a conceptual software logic structuring mechanism, while 'tier' is used to refer to the physical hardware structuring mechanism" (multitier architecture). Whether the actor, an adapter and an operator UI share a process, a host or neither is a deployment question; it moves no boundary on this page. *Why:* conflating them is how "we are not distributed, so we do not need layers" and its mirror "we are distributed, so the network is our boundary" both get argued.

## Strict, not relaxed

A strict layered system lets each layer depend only on the one below it; a relaxed one lets it depend on everything below. **Strict here**, in the three forms a violation actually takes:

- the domain imports no adapter, no interpreter, no builtin, no ambient capability;
- **an adapter never imports another adapter** — two adapters that need each other are either one adapter or a coordination that belongs above both;
- nothing performs an effect the actor did not decide, by any route that skips the interpreter. That is not a layering preference but the single-writer property ([architecture.md](./architecture.md#the-single-writer)) in structural form.

*Why strict:* relaxed layering is not a weaker rule, it is the absence of one. Once any inner module may call any outer module below it, the graph is the documentation, and the graph is what nobody reads.

## What crosses a boundary

**Plain data.** "Isolated, simple, data structures are passed across the boundaries" (Martin). A live object carries behaviour, identity and lazily-reachable state across a seam the reader cannot audit, and it makes the receiving side depend on the sender's class rather than on its data.

**Parsed, not validated.** "Get your data into the most precise representation you need as quickly as you can. Ideally, this should happen at the boundary of your system, before *any* of the data is acted upon" (King). A validator returns nothing and throws away what it learned; a parser returns the refined type and keeps it. *Why:* the alternative is shotgun parsing — "parsing and input-validating code is mixed with and spread across processing code" — where a re-check deep inside the core is both a duplicate and an admission that the type does not say what the code believes.

**Here:** the wire schema is the parser's input and a domain type is its output. A `string` that reaches a decider still meaning "probably an id" is the defect this rule names, and a second check inside the decider is the smell that the first one did not parse.

**In one place per boundary.** Each boundary has one module that maps both directions. *Why:* mapping scattered across call sites is duplicated by construction and drifts one call site at a time.

**Never a foreign model.** Where an external system's shape would otherwise reach inward, the port is an anti-corruption layer: "Isolate the different subsystems by placing an anti-corruption layer between them", and keep it to translation — "avoid placing business rules or orchestration in the layer" (Evans, via the Azure pattern catalogue). *Why:* an imported schema is an imported design, and the design you imported is one you do not control. **Here:** the fabric case is already settled — the core names no fabric, so no fabric's vocabulary reaches the domain ([architecture.md](./architecture.md#ports)).

**A refusal is not an error.** The two failure classes a port must not conflate — cannot serve *this work now* versus cannot serve this *kind* of work at all — are stated once, at [architecture.md](./architecture.md#ports).

## Ports and adapters

The port itself is defined in [architecture.md](./architecture.md#ports). What is generic:

- **The inner layer declares the port; the outer implements it.** A port declared beside its single implementation is not a port, it is a header file — the dependency still points outward, and only the file count changed.
- **Primary and secondary.** A primary (driving) adapter calls in on behalf of an actor that starts work; a secondary (driven) one is called out to for an answer or a notification (Cockburn). The symmetry is the payoff: a test harness substitutes for a driving actor exactly as a stub substitutes for a driven one, and neither substitution touches the core.
- **A port per contract, not per class.** An interface with one implementation, no test double and no prospect of a second is ceremony. The exception is deliberate and stated at the same place: a port whose *promises* are what an invariant rests on earns its keep at one implementation, because a second implementation then satisfies the invariant by construction where an inline branch satisfies it only by review.
- **Adapters hold no rules.** Protocol, encoding, retry-of-the-transport, translation — nothing that a domain expert would recognise as a decision. *Why:* a rule in an adapter is invisible to the model, unreachable from a golden trace, and duplicated the moment a second adapter appears.

## What layering costs, and when to stop

The reason to do this at all is the modest one: "The reduced scope of attention reason is sufficient on its own" (Fowler) — testability and substitutability are the bonus, not the justification. Layering is also a *small-granularity* technique: once a layer grows too big, the top-level split becomes domain-oriented modules that are internally layered, not more layers.

Both failure modes are real and they are symmetric. Under-layering shows up as business rules in request handlers and a core that cannot be tested without a broker. Over-layering shows up as ports with no second side, DTOs mapped to structurally identical DTOs, and a folder per noun — the abstraction tax paid every change, for an option nobody exercises.

*Refutation trigger:* if adding one field routinely touches four files that differ only in the name of the type, the boundary those files cross is not carrying a decision — collapse it, and say so in the commit message rather than working around it.

## Where these come from

- [Multitier architecture](https://en.wikipedia.org/wiki/Multitier_architecture) — layers versus tiers, strict versus relaxed.
- [Cockburn, *Hexagonal Architecture*](https://alistair.cockburn.us/hexagonal-architecture/) — ports, adapters, driving versus driven.
- [Martin, *The Clean Architecture*](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — the dependency rule, and what may cross a boundary.
- [Palermo, *The Onion Architecture*](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — coupling toward the centre; the database is external.
- [Fowler, *PresentationDomainDataLayering*](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) — why layer at all, and at what granularity.
- [King, *Parse, don't validate*](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — the boundary rule for data.
- [Anti-corruption layer](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) — Evans' pattern, stated as a catalogue entry.
- [Evans' layer responsibilities](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice) — the domain and application layer definitions, quoted from *Domain-Driven Design*.
