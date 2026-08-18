# Where task configuration is refused

**Status: PROPOSED** — nothing below is enforced yet; the landing table at the end sequences what will be.

A ticket carries the configuration of the tasks its phases run, and that configuration is authored: a user wrote it, it arrives from outside the tree, and it decides what a task does. For an agent task it decides the prompt, the tools and the permissions; for a build or a CI task it is argv. Where an ill-formed one is refused is the question, and it has more than one answer because not every part of it is decidable at the same moment.

## The gap

The discipline exists and covers one thing. `model/domain.qnt` validates the eval program structurally at arrival — an empty program, a zero or oversized fan-out, an overlong program — and the argument sits with the decider: refused at authoring time, no reachable state holds one, *rather than the interpreter defending against one mid-flight*. The program is immutable after arrival, like deps.

Task configuration content is nowhere. `tasksWellFormed` constrains task ids, kinds and fan-out, which is the state machine rather than what a task was configured to do. `Ticket` in `src/domain/ticket.ts` carries the program, the wrap-up, the project and the deps, and nothing about a task's behaviour.

That gap is invisible until something implements a task. `src/briefing/` is the first, and it put its refusals where no ticket passes: the spec naming its transforms is a TypeScript type, so an unknown name fails when this repo compiles, and a ticket is not compiled.

## The configuration does not enter the core

The model already placed it. Pinning a Draft's content before release is below the model's grain and an implementation concern of the authoring surface, exactly as Draft content edits are — and a task's configuration is Draft content. What rides the arrival is the eval program, the target project, the deps and the wrap-up, and the list is closed.

The implementation agrees from the other end. `src/domain/effect.ts` says the effect constructors are nullary, that the model decided that rather than an implementation, and that giving one a payload is a model commit. `FabricPort.spawnWorkTasks` takes an emission of a sequence number, an effect index and a ticket id. So nothing about a task can ride the effect out to the fabric either, and the ticket id is there for the adapter to read by.

Both ends say the same thing: the configuration is written and held on the authoring surface, the fabric adapter reads it back by ticket id, and the core's `Ticket` never carries it. Which adapter owns those bytes is an adapter's question and not this document's. What matters here is that the record `model/refinement.qnt` compares, and that the measure is a pure function of, stays exactly as wide as the model's.

## The model carries none of it

The model's authored data is what the measure and the deciders read. The program is there because stage count and fan-out drive the measure's radix; the wrap-up, the project and the deps are there because deciders branch on them. Task configuration drives neither: the transitions are identical whatever prompt a task was given, and a task that cannot run resolves failed, which rework and parking already close over. An opaque configuration dimension would cost state space and prove nothing.

What the model supplies instead is the shape of the refusal. Membership of `validPrograms` is a precondition on the arrival action rather than a check inside a decider — callers guarantee it, and a ticket that would fail it never arrives. Task configuration takes the same treatment one layer out.

## It is Draft content, so it is pinned and refused at release

The eval program rides the arrival and is immutable after. Task configuration could be given the same treatment, and should not be: a Draft exists to be edited, and the configuration is the part of a ticket a human iterates on hardest. Making it immutable at arrival would mean a ticket cannot be drafted, only submitted correct — and it would want the model to say so, where treating it as ordinary Draft content needs the model to say nothing it has not already said.

So it is pinned when the ticket is released, and refused there. The property that matters is unchanged: release is before any dispatch, so no unrunnable ticket ever reaches the pipeline. What is given up is small and worth naming — between arrival and release a Draft may hold a configuration that would be refused, which is exactly the state a Draft exists to be in, and its author is looking at the board it sits on.

## Two refusals, in two places

**R1 — decidable from the configuration alone, so it goes to release.** Every task name a ticket references resolves to a task the tree has, and every task's params satisfy the schema that name declares. Both are pure predicates over authored data and neither needs a ticket to have run, so both are answerable the moment the content is pinned.

**R2 — needs the runtime view, so it stays at execution and changes kind.** Whether a chain composes to a non-empty prompt depends on the ticket's state when the work phase runs, so no predicate over the configuration can decide it without lying. It becomes an ordinary task outcome: the adapter resolves the task failed and carries the trace as the reason, and the machine's existing rework and parking do the rest. No new vocabulary, and no exception crossing a layer.

Neither half absorbs the other. Everything at execution is the interpreter defending mid-flight, in the words the model uses to reject it, and it spends a dispatch and a rework cycle discovering what the configuration said all along. Everything at release needs a predicate over data that does not exist yet.

## The parse, and which side the mirror is on

`src/interpreter/wire.ts` settled this for the journal and the answer transfers whole. A parse returns the value or the reason it was refused, because throwing is the idiomatic answer to an invalid input and the wrong one where illegal values actually arrive — a caller cannot proceed without choosing. `Parsed` is that type and it already exists.

It also settled which of the schema and the type is the truth, and the answer is the type: `entrySchemaMirrorsEntry` stops compiling the moment the two stop describing each other, so a field dropped from a schema is a type error rather than a value that parsed and lost something. Task configuration takes the same arrangement. The spec stays a TypeScript type written by hand, each name's params gain a schema, and a mirror constant holds the two together. Inferring the spec from the schemas would invert the tree's own idiom and put the truth in the mirror.

The refusal a caller gets back names the task it came from, because a ticket author reading it has a list of tasks in front of them and no stack.

## The fifth home

004 names its refutation trigger for the split into domain, actor, interpreter and adapter: a fifth home that is none of them. The `briefing-is-pure` rule in `.dependency-cruiser.cjs` argues its way out on the grounds that nothing imports the directory and it imports none, which expires the moment a caller exists.

The caller is the fabric adapter, and that answers the trigger rather than firing it: composition is adapter-side, so briefing is part of the fourth home and not a fifth. Its purity stops being a claim about which layer it is and becomes what it always was, a property worth keeping — an adapter may hold ambient capability and this one has no use for any. The rule that replaces the current one says both halves: it imports nothing outside itself, and nothing outside `src/adapters/` imports it.

What would refute this: a second consumer that is not an adapter. The likely shape is the desk needing to render a prompt for a human to approve before the work runs, which is a decision about a ticket rather than a call to the world.

## Landing

| # | What lands | Where | Depends on | Status |
|---|---|---|---|---|
| B1 | The task vocabulary, its params schemas, and the mirror holding them to it | `src/adapters/` | — | Proposed |
| B2 | The release-time parse, returning the ticket's chains or the reason one was refused | `src/adapters/` | B1 | Proposed |
| B3 | An empty prompt as a returned refusal rather than a throw | `src/briefing/` | — | Proposed |
| B4 | Briefing under the adapter layer, and the boundary rule restated | `src/adapters/briefing/` <!-- intent --> | B2 | Proposed |

B3 is independent of the rest and is the one change to a module that already exists. B4 waits on B2 because the consumer it names is the one B2 introduces, and moving a directory before anything imports it would be asserting the answer rather than earning it.
