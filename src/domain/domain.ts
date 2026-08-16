/**
 * `model/domain.qnt`'s DECISION LAYER in TypeScript: the machine's consts, the
 * authoring universes, the decision plumbing, all twenty `*In` enablement
 * predicates, and all thirteen deciders.
 *
 * WHAT IS NOT HERE, and where it goes instead: the model's state-and-actions
 * section (the four vars, `init`, the thirteen actions) is the machine's
 * rather than a decider's — its TypeScript home is the spine, s3, and
 * `src/spine/machine.ts` is where it landed. `installCore` is the exception
 * and belongs to s5: the model marks it the refinement-layer seam, keeps it
 * out of `step`'s roster, and only an executor cursor or a crash has any use
 * for it. The conjuncts of `allInvariants` are s2c's — named rather than counted,
 * because the bundle has already gained one since this line was written. This
 * file is exactly the part of `chuggy_domain` that is a pure function of a
 * `Core`.
 *
 * THE MODEL IS THE SPEC AND ITS HEADER IS THE ARGUMENT. Why a ticket's life has
 * the shape it has, why the cascade parks rather than cascade-revokes, why
 * Ready and Blocked are predicates rather than phases, why a guard is hoisted
 * into a shared definition instead of copied into its callers — all of it lives
 * in `model/domain.qnt` and is deliberately not restated here. A second copy of
 * an argument is the copy that drifts. What this file adds is what the model
 * cannot state: how its constructs are spelled in TypeScript, and which of its
 * prose caller-guarantees became runtime assertions.
 *
 * DEFINITION ORDER IS THE MODEL'S, definition for definition, so the two files
 * read side by side. The file was written in two slices and the order is the
 * model's rather than either slice's: the eval, gate and desk half landed in
 * its model positions, interleaved with the authoring-and-work half, not
 * appended to it.
 *
 * THE ENCODING, beyond `measure.ts`'s four decisions, which this file inherits:
 *
 *   5. THE MODULE'S CONSTS BECOME AN EXPLICIT `Config` RECORD, passed to the
 *      definitions that read one and to no others. Quint instantiates a module
 *      per const assignment; TypeScript has no such thing, and a module-level
 *      constant would make the four mc instances four builds. The record's
 *      field order is the model's declaration order.
 *   6. A `Set` OF RECORDS BECOMES A READONLY ARRAY IN A DOCUMENTED CANONICAL
 *      ORDER, exactly as `measure.ts` argues for `TaskSet`: JavaScript's `Set`
 *      holds objects by reference, so structural membership in one is not
 *      expressible. Where the model asks a record set a membership question —
 *      and `validPrograms` IS the arrival-refusal rule, so it does — the
 *      question is answered by a scan under a canonical key, never by a second
 *      predicate that restates the rule.
 *   7. A `Set[int]` BECOMES `ReadonlySet<number>`, which does compare and
 *      contain structurally, because its elements are primitives.
 *
 * THE GUARDS ARE REFERENCED, NEVER COPIED — the model's own discipline (see
 * `dispatchableIn`'s header for the drift it was introduced to stop), applied
 * to the one place TypeScript adds: every stated caller guarantee is asserted
 * here BY CALLING THE PREDICATE THAT STATES IT. A decider that restated its
 * guard would be the copy the model forbids.
 */

import { assertNever, invariant } from "./assert.ts";
import {
  combine,
  evalStage,
  firstTaskId,
  nextTaskId,
  resolveTask,
  retireLive,
  reworkBudget,
  runningCount,
  spawnOn,
  taskPassed,
  wrapUpBudget,
  type ArtifactMark,
  type Bounds,
  type Core,
  type Decision,
  type Phase,
  type Reason,
  type Resume,
  type RetryPricing,
  type ReworkPolicy,
  type Stage,
  type TaskOutcome,
  type Ticket,
  type Verdict,
  type WrapUp,
  type WrapUpOutcome,
  type WrapUpPricing,
} from "./measure.ts";

// === Encoding helpers ======================================================
// No model content: `model/domain.qnt` has no counterpart to any of these.
// They are what a Quint map, set and value-equality cost in TypeScript, named
// once so no definition below spells one out twice.

/**
 * The model's `c.tickets.get(j)`, total.
 *
 * Quint's `get` on an absent key is an error, and the model relies on that in
 * one place that matters: `decideRevoke` walks `1..size` and reads every id,
 * which is only sound because ids are dense (`idsDense`). Here the same read
 * asserts, so a fleet with a hole fails loudly at the walk rather than
 * silently skipping a doomed dependent.
 */
export function ticketAt(c: Core, j: number): Ticket {
  const jb = c.tickets.get(j);
  invariant(jb !== undefined, `no ticket ${String(j)} in the fleet`);
  return jb;
}

/**
 * The model's `a.subseteq(b)` over two primitive sets.
 *
 * NAMED ONCE FOR THIS SECTION'S OWN RULE, which is what the sweep found broken:
 * the same loop was written three times over — `cmd.ts`'s `isSubsetOf` for
 * `decideArrive`'s deps guard, `invariants.ts`'s `everyDepIn` for
 * `canFinishSet`, and a third copy spelled inline inside `stuckSubsetCovered`.
 * Quint says `subseteq` once and means one thing by it; three spellings of one
 * operator are three chances for two of them to answer differently about the
 * empty set, which is the case every one of them leans on.
 *
 * IT IS DELIBERATELY NOT `anyEdgeIn`'S SIBLING. That predicate is the dual —
 * "some element is in" — and collapsing the two into one helper carrying a
 * quantifier as an argument would be the cleverness this section's
 * one-mechanism rule exists to prevent.
 *
 * Bounded by `smaller`, which every caller draws from the fleet.
 */
export function isSubsetOf(
  smaller: ReadonlySet<number>,
  larger: ReadonlySet<number>,
): boolean {
  for (const x of smaller) {
    if (!larger.has(x)) {
      return false;
    }
  }
  return true;
}

/** The model's `c.tickets.keys().filter(...)`, which six enablement sets are. */
function keysWhere(c: Core, keep: (j: number) => boolean): ReadonlySet<number> {
  const out = new Set<number>();
  for (const j of c.tickets.keys()) {
    if (keep(j)) {
      out.add(j);
    }
  }
  return out;
}

/**
 * The model's `lo.to(hi)` — inclusive, and empty when `hi < lo`, which is the
 * case `deliverableTaskIds` reaches on a ticket that has spawned nothing.
 *
 * The loop is bounded by `hi`, and every caller's `hi` is bounded by the
 * machine: a project id by `N_PROJECTS`, a task id by the ticket's own spawn
 * history. That is the same bound the model's ranges carry.
 */
function rangeSet(lo: number, hi: number): ReadonlySet<number> {
  invariant(
    Number.isSafeInteger(lo) && Number.isSafeInteger(hi),
    `a range runs between safe integers, got ${String(lo)}..${String(hi)}`,
  );
  const out = new Set<number>();
  for (let i = lo; i <= hi; i += 1) {
    out.add(i);
  }
  return out;
}

/**
 * A canonical key for a value the model compares by value and JavaScript
 * compares by reference. One mechanism rather than a hand-written comparator
 * per type, and injective on every value the machine can build.
 *
 * The integer check is what buys the injectivity, and it is checked rather
 * than assumed for one reason: `${NaN}` is `"NaN"`, so two values JavaScript
 * calls unequal would key the same, and a model type where the machine's is an
 * `int` is not a place to discover that. Every field keyed below is an `int`
 * in `model/measure.qnt`, so nothing the machine can build is refused here.
 */
function intKey(n: number, what: string): string {
  invariant(
    Number.isSafeInteger(n),
    `${what} is a safe integer in the model, got ${String(n)}`,
  );
  return String(n);
}

/** A stage's two fields; the separator appears in neither. */
function stageKey(s: Stage): string {
  return `${intKey(s.fanout, "a stage's fan-out")}:${s.combinator}`;
}

/** A program is its stages' keys in order, under a separator no stage key holds. */
function programKey(program: readonly Stage[]): string {
  return program.map(stageKey).join("|");
}

function wrapUpKey(w: WrapUp): string {
  switch (w.tag) {
    case "WNone":
      return "WNone";
    case "WExclusive":
      return `WExclusive:${intKey(w.resource, "a lease's resource")}`;
    default:
      return assertNever(w, "unhandled WrapUp");
  }
}

function artifactKey(a: ArtifactMark): string {
  switch (a.tag) {
    case "ANone":
      return "ANone";
    case "ASome":
      return `ASome:${intKey(a.id, "an artifact mark")}`;
    default:
      return assertNever(a, "unhandled ArtifactMark");
  }
}

// === The machine's consts ==================================================

/**
 * `model/domain.qnt`'s eight module consts, in declaration order.
 *
 * Every field's meaning and every argument for its existence is on the model's
 * own `const` — including the two that are parameters rather than constants
 * (`REWORK_POLICY`, `WRAPUP_PRICING`), the one the measure deliberately does
 * not read (`OP_RETRY_PRICING`), and the one that is an arrival bound rather
 * than a fleet size (`N_TICKETS`).
 */
export type Config = {
  readonly nTickets: number;
  readonly nTasks: number;
  readonly reworkPolicy: ReworkPolicy;
  readonly gas: number;
  readonly wrapUpPricing: WrapUpPricing;
  readonly opRetryPricing: RetryPricing;
  readonly maxStages: number;
  readonly nProjects: number;
};

/**
 * `model/domain.qnt`'s dense-id convention, named once on `measure.ts`'s
 * `firstTaskId` precedent: ticket ids run from 1, are dense to the fleet's
 * size, and are never reused. Two places below are load-bearing on it —
 * `decideArrive` mints `size + 1`, and `decideRevoke` walks `1..size` reading
 * every id — and a bare numeral in either is the convention stated twice.
 */
export const firstTicketId = 1;

/** A const that must admit at least one of whatever it bounds. */
function atLeastOne(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}

/**
 * `model/domain.qnt` init's validity conjuncts — the ones over the consts
 * alone: a configuration failing any of them has NO initial state, so the
 * machine it describes does not exist. `GAS >= 1` is the required-account
 * rule; the other four are well-formedness.
 *
 * The two account conjuncts (`reworkBudget(...) >= 0`, `wrapUpBudget(...) >=
 * 0`) are asked of `measure.ts`, which answers a negative grant by throwing
 * rather than by returning false — s1's choice, made where the grant is read.
 * So a negative grant is refused here too, one level louder than the model's
 * `false`. There is no third answer to give: the model's conjunct exists to
 * make such a configuration stateless, and it is.
 */
export function configAdmitsInit(cfg: Config): boolean {
  return (
    atLeastOne(cfg.gas) &&
    atLeastOne(cfg.nTasks) &&
    atLeastOne(cfg.nTickets) &&
    atLeastOne(cfg.maxStages) &&
    atLeastOne(cfg.nProjects) &&
    reworkBudget(cfg.reworkPolicy) >= 0 &&
    wrapUpBudget(cfg.wrapUpPricing) >= 0
  );
}

// === The authoring universes ===============================================

/**
 * `model/domain.qnt` wrapUpChoices — every AUTHORABLE wrap-up kind.
 *
 * Canonical order: `WNone`, then `WExclusive` by ascending resource. The
 * model's set is unordered; an order is chosen so the value is comparable.
 */
export function wrapUpChoices(cfg: Config): readonly WrapUp[] {
  const choices: WrapUp[] = [{ tag: "WNone" }];
  for (const r of projects(cfg)) {
    choices.push({ tag: "WExclusive", resource: r });
  }
  return choices;
}

/**
 * The project universe's floor, named on `firstTaskId`'s precedent: every
 * admissible instance draws its projects from `firstProjectId..N_PROJECTS`, so this is
 * the number `noResource` has to sit below to be safe at EVERY instance rather
 * than at the ones this tree happens to configure.
 */
export const firstProjectId = 1;

/** `model/domain.qnt` projects — the project universe an arrival's target is drawn from. */
export function projects(cfg: Config): ReadonlySet<number> {
  return rangeSet(firstProjectId, cfg.nProjects);
}

/** `model/domain.qnt` bounds — the measure's bounds, from this instance's consts. */
export function boundsOf(cfg: Config): Bounds {
  return {
    reworkPolicy: cfg.reworkPolicy,
    nTasks: cfg.nTasks,
    maxStages: cfg.maxStages,
    wrapUpPricing: cfg.wrapUpPricing,
  };
}

/**
 * `model/domain.qnt` stageChoices — the stage vocabulary an author may draw
 * from: any fan-out `1..N_TASKS`, either combinator.
 *
 * Canonical order: ascending fan-out, and within one fan-out the combinators
 * in the order `measure.ts` declares them.
 */
export function stageChoices(cfg: Config): readonly Stage[] {
  const choices: Stage[] = [];
  for (const fanout of rangeSet(1, cfg.nTasks)) {
    choices.push({ fanout, combinator: "CUnanimousPass" });
    choices.push({ fanout, combinator: "CAnyPass" });
  }
  return choices;
}

/**
 * `model/domain.qnt` validPrograms — every WELL-FORMED authorable program, and
 * therefore THE ARRIVAL-REFUSAL RULE ITSELF: the empty program, an oversized
 * fan-out and an overlong program are simply not in it.
 *
 * The model's fold, kept: start from the empty program, extend by every stage
 * choice `MAX_STAGES` times, then drop the empty one. Distinct sequences
 * cannot collide, so the keyed accumulator below is a set in the model's sense
 * and its length is that set's size — which `validProgramsRefusalTest` pins.
 *
 * IT IS REBUILT ON EVERY CALL, WHICH THE MODEL IS NOT: a Quint `pure val` is
 * evaluated once per instance, and this is a function of the config because
 * TypeScript has no instances. The enumeration is `sum(|stageChoices| ** k)`
 * over `k` in `1..maxStages`, and it is not free at every shape — measured on
 * this tree (node 22.18.0, 2026-08-15): 20 programs / 0.035 ms at DB's consts,
 * 258 / 0.14 ms at 3 tasks and 3 stages, 37448 / 21 ms at 4 and 5. The machine
 * asks once per ARRIVAL (`decideArrive` through `isValidProgram`) and never per
 * step, so one enumeration per authored ticket is the bill; a caller asking in
 * a loop should hold the result rather than the config.
 */
export function validPrograms(cfg: Config): readonly (readonly Stage[])[] {
  const choices = stageChoices(cfg);
  let grown = new Map<string, readonly Stage[]>([["", []]]);
  for (let depth = 0; depth < cfg.maxStages; depth += 1) {
    const next = new Map(grown);
    for (const program of grown.values()) {
      for (const stage of choices) {
        const extended = [...program, stage];
        next.set(programKey(extended), extended);
      }
    }
    grown = next;
  }
  return [...grown.values()].filter((program) => program.length >= 1);
}

/**
 * Membership in `validPrograms`, which is the only question the model asks of
 * that set. The set IS the rule, so this scans it rather than restating the
 * three conditions it encodes — a restatement is the copied guard the model
 * forbids, and it would go on admitting programs the set had stopped
 * admitting.
 */
export function isValidProgram(
  cfg: Config,
  program: readonly Stage[],
): boolean {
  const key = programKey(program);
  return validPrograms(cfg).some((p) => programKey(p) === key);
}

/**
 * Membership in `wrapUpChoices`, which is the only question the model asks of
 * that set — `isValidProgram`'s precedent, for the other authoring universe
 * whose members are records rather than primitives.
 *
 * It scans the set under the canonical key rather than testing a resource
 * against the project universe, for `isValidProgram`'s reason: the SET is the
 * rule. The two questions agree only while `wrapUpChoices` is built from
 * `projects`, and a restatement would go on answering the old way if it stopped
 * being.
 */
export function isAuthorableWrapUp(cfg: Config, w: WrapUp): boolean {
  const kind = wrapUpKey(w);
  return wrapUpChoices(cfg).some((choice) => wrapUpKey(choice) === kind);
}

/**
 * `model/domain.qnt` defaultProgram — ONE stage, full fan-out, unanimous pass.
 * There is deliberately no machine-wide combinator const; the combinator is
 * data on the ticket.
 */
export function defaultProgram(cfg: Config): readonly Stage[] {
  return [{ fanout: cfg.nTasks, combinator: "CUnanimousPass" }];
}

/**
 * `model/domain.qnt` freshTicket — THE ticket-source seam: every ticket the
 * machine ever holds is built here, born a Draft with its full accounts.
 *
 * This is where the configuration is gated, and the model says why: init's
 * `GAS >= 1` conjunct "still gates every ticket ever created" because every
 * arrival funds a ticket from that grant. A configuration with no initial
 * state has no tickets either, so refusing here refuses the whole machine.
 */
export function freshTicket(
  cfg: Config,
  deps: ReadonlySet<number>,
  program: readonly Stage[],
  project: number,
  wrapUp: WrapUp,
): Ticket {
  invariant(
    configAdmitsInit(cfg),
    "freshTicket: this configuration admits no initial state, so it holds no tickets either",
  );
  return {
    phase: "PDraft",
    deps,
    program,
    wrapUp,
    artifact: { tag: "ANone" },
    project,
    tasks: [],
    record: [],
    spawned: 0,
    reworkLeft: reworkBudget(cfg.reworkPolicy),
    wrapUpLeft: wrapUpBudget(cfg.wrapUpPricing),
    gasLeft: cfg.gas,
    resumeAt: "RNone",
    reason: "RsNone",
    completions: 0,
  };
}

// === Pure deciders =========================================================
// decide(view, event) -> Decision, never an effect.

/**
 * `model/domain.qnt` withTicket.
 *
 * Quint's `Map.set` requires the key to exist — `put` is the one that adds —
 * and every caller here is updating a live ticket. The distinction is asserted
 * rather than dropped, because the one decider that adds (`decideArrive`) uses
 * `put`, and silently creating a ticket in `withTicket` would make a mis-keyed
 * update look like an arrival.
 */
export function withTicket(c: Core, j: number, jb: Ticket): Core {
  invariant(
    c.tickets.has(j),
    `withTicket: ticket ${String(j)} is not in the fleet; arrival is the only source`,
  );
  const tickets = new Map(c.tickets);
  tickets.set(j, jb);
  return { tickets };
}

/**
 * `model/domain.qnt` move — the one funnel every phase flip goes through,
 * recording exactly one transition. `from == to` is a real row.
 */
export function move(
  c: Core,
  j: number,
  to: Phase,
  label: string,
  effects: readonly string[],
): Decision {
  const jb = ticketAt(c, j);
  return {
    rec: {
      label,
      transitions: [{ ticket: j, from: jb.phase, to }],
      effects,
      attempt: { tag: "WONone" },
    },
    post: withTicket(c, j, { ...jb, phase: to }),
  };
}

/**
 * `model/domain.qnt` noop — a decision that changes nothing, the idempotent
 * answer to a duplicate delivery. The post-state IS the observed state, not a
 * copy of it: nothing here can differ from `c`, and identity says so.
 */
export function noop(c: Core, label: string): Decision {
  return {
    rec: { label, transitions: [], effects: [], attempt: { tag: "WONone" } },
    post: c,
  };
}

/**
 * `model/domain.qnt` withWrapUpObs — stamp the wrap-up boundary's attribution on
 * a decision. `decideWrapUpResolve` routes EVERY arm through this, so each step
 * that resolves a wrap-up attempt — both successes, the gate rework, and both
 * wrap-up walls — carries the target project and the environment's invalidated
 * choice for that attempt.
 *
 * The post-state is passed through UNTOUCHED, which is the whole of what makes
 * this an observation rather than a decision: the attribution lives in the
 * `StepRecord` and in no ticket field, so nothing stores what project an attempt
 * was for.
 */
export function withWrapUpObs(
  d: Decision,
  project: number,
  moved: boolean,
): Decision {
  return {
    rec: {
      ...d.rec,
      attempt: { tag: "WOAttempt", project, invalidated: moved },
    },
    post: d.post,
  };
}

// --- Authoring: arrival, release, revoke -----------------------------------

/**
 * `model/domain.qnt` decideArrive — a ticket ARRIVES as a Draft. Ids are dense
 * and never reused (next id = fleet size + 1).
 *
 * THE MODEL'S FOUR STATED CALLER GUARANTEES ARE ASSERTED, each by calling the
 * definition that states it: deps drawn from `dependableIn` (no tombstones),
 * the program from `validPrograms`, the project from `projects`, the wrap-up kind
 * from `wrapUpChoices`. The model's word for what they buy is
 * "structural refusal" — an ill-formed arrival cannot enter a reachable state
 * — and an unchecked TypeScript argument would let exactly that happen.
 * `canArriveIn` is asserted on the same footing: it is the `arrive` action's
 * guard, and the N_TICKETS arrival bound is not a suggestion.
 */
export function decideArrive(
  cfg: Config,
  c: Core,
  deps: ReadonlySet<number>,
  program: readonly Stage[],
  project: number,
  wrapUp: WrapUp,
): Decision {
  invariant(canArriveIn(cfg, c), "decideArrive: the arrival bound is reached");
  const dependable = dependableIn(c);
  for (const d of deps) {
    invariant(
      dependable.has(d),
      `decideArrive: dependency ${String(d)} is not dependable — a tombstone dooms the arrival at birth`,
    );
  }
  invariant(
    isValidProgram(cfg, program),
    "decideArrive: the authored program is not well-formed, so no arrival may carry it",
  );
  invariant(
    projects(cfg).has(project),
    `decideArrive: project ${String(project)} is outside the project universe`,
  );
  invariant(
    isAuthorableWrapUp(cfg, wrapUp),
    `decideArrive: ${wrapUpKey(wrapUp)} is not an authorable wrap-up kind`,
  );

  const id = c.tickets.size + firstTicketId;
  invariant(
    !c.tickets.has(id),
    `decideArrive: id ${String(id)} is taken, so the fleet's ids are not dense`,
  );
  const tickets = new Map(c.tickets);
  tickets.set(id, freshTicket(cfg, deps, program, project, wrapUp));
  return {
    rec: {
      label: "ticket-arrived",
      transitions: [],
      effects: ["CreateDraft"],
      attempt: { tag: "WONone" },
    },
    post: { tickets },
  };
}

/**
 * `model/domain.qnt` decideRelease — Draft -> Pending: the ticket enters the
 * released pipeline. One release target rather than a Ready/Blocked pair,
 * because the split is derived.
 */
export function decideRelease(c: Core, j: number): Decision {
  invariant(
    draftsIn(c).has(j),
    `decideRelease: ticket ${String(j)} is not a Draft, and release leaves from Draft alone`,
  );
  return move(c, j, "PPending", "ticket-released", []);
}

/**
 * `model/domain.qnt` decideRevoke — revoke AND THE CASCADE, atomically: one
 * decision, one StepRecord, every pre-flight transitive dependent parked
 * behind its own named wall.
 *
 * The model's two ascending passes are one here — the doomed set is decided in
 * ascending id order, which is what makes a single pass correct (deps point
 * strictly downward), and the same pass collects the parked list the record's
 * transitions and effects are built from.
 */
export function decideRevoke(c: Core, j: number): Decision {
  invariant(
    revocableIn(c, j),
    `decideRevoke: ticket ${String(j)} is terminal, and the terminals are absorbing`,
  );
  const n = c.tickets.size;
  const doomed = new Set<number>();
  const parkedList: number[] = [];
  for (let k = firstTicketId; k < firstTicketId + n; k += 1) {
    const jb = ticketAt(c, k);
    if (jb.deps.has(j) || setsIntersect(jb.deps, doomed)) {
      doomed.add(k);
      if (jb.phase === "PDraft" || jb.phase === "PPending") {
        parkedList.push(k);
      }
    }
  }
  const parked = new Set(parkedList);

  const tickets = new Map<number, Ticket>();
  for (const [k, jb] of c.tickets) {
    if (k === j) {
      tickets.set(k, {
        ...retireLive(jb),
        phase: "PRevoked",
        resumeAt: "RNone",
        reason: "RsNone",
      });
    } else if (parked.has(k)) {
      tickets.set(k, {
        ...jb,
        phase: "PEscalated",
        reason: "RsDependencyRevoked",
      });
    } else {
      tickets.set(k, jb);
    }
  }

  return {
    rec: {
      label: "ticket-revoked",
      transitions: [
        { ticket: j, from: ticketAt(c, j).phase, to: "PRevoked" as const },
        ...parkedList.map((k) => ({
          ticket: k,
          from: ticketAt(c, k).phase,
          to: "PEscalated" as const,
        })),
      ],
      effects: ["Revoke", ...parkedList.map(() => "OpenHumanTask")],
      attempt: { tag: "WONone" },
    },
    post: { tickets },
  };
}

/** The model's `s.exists(d => t.contains(d))`, over two primitive sets. */
function setsIntersect(
  a: ReadonlySet<number>,
  b: ReadonlySet<number>,
): boolean {
  for (const x of a) {
    if (b.has(x)) {
      return true;
    }
  }
  return false;
}

// --- Pure guard predicates -------------------------------------------------

/** `model/domain.qnt` revocableIn — every phase but the two absorbing terminals. */
export function revocableIn(c: Core, j: number): boolean {
  const p = ticketAt(c, j).phase;
  return p !== "PDone" && p !== "PRevoked";
}

/** The model's inline `match OP_RETRY_PRICING { RetryCharged => 1 | RetryFree => 0 }`. */
function meteredResume(pricing: RetryPricing): number {
  switch (pricing) {
    case "RetryCharged":
      return 1;
    case "RetryFree":
      return 0;
    default:
      return assertNever(pricing, "unhandled RetryPricing");
  }
}

/**
 * `model/domain.qnt` resumeCharge — what one operator resume costs, by flavor.
 * The pricing table and the argument for each row are the model's.
 *
 * The model's third row is a WILDCARD arm; its three members are written out
 * here on `measure.ts`'s `phaseRank` precedent — an exhaustive switch is what
 * makes a future `Resume` constructor a compile error rather than a silent
 * charge. `RNone` is one of those three, and it is charged rather than refused
 * for the model's stated reason: `retryableIn` refuses it, so the row is
 * unreachable through the machine, and `decideOpRetry`'s `RNone` arm is a
 * guarded no-op that never reads the price.
 */
export function resumeCharge(cfg: Config, at: Resume): number {
  switch (at) {
    case "RPending":
      return 0;
    case "RWorking":
      return 1;
    case "REvaluating":
    case "RWrapUp":
    case "RNone":
      return meteredResume(cfg.opRetryPricing);
    default:
      return assertNever(at, "unhandled Resume");
  }
}

/**
 * Does a modeled resume EXIST for this ticket? `retryableIn`'s middle conjunct,
 * named once because `decideOpRetry`'s guard needs the same question and a
 * second spelling of it would be the restated guard this file forbids — the one
 * wall without a resume is `dependency_revoked`, and it is exactly the arm the
 * decider answers rather than refuses.
 */
function hasModeledResume(t: Ticket): boolean {
  return t.resumeAt !== "RNone";
}

/**
 * `model/domain.qnt` retryableIn — may the operator Retry this parked ticket? A
 * resume must EXIST and be AFFORDABLE. The one wall with no modeled resume is
 * `dependency_revoked`, and the model's header has the argument for that
 * deliberate restriction.
 */
export function retryableIn(cfg: Config, c: Core, j: number): boolean {
  const jb = ticketAt(c, j);
  return (
    jb.phase === "PEscalated" &&
    hasModeledResume(jb) &&
    resumeCharge(cfg, jb.resumeAt) <= jb.gasLeft
  );
}

/**
 * `model/domain.qnt` waitsOn — WHAT A TICKET WAITS ON before it may run, the
 * single definition read by the readiness check, the structural-deadlock check
 * and the cross-ticket artifact read alike.
 */
export function waitsOn(c: Core, j: number): ReadonlySet<number> {
  return ticketAt(c, j).deps;
}

/**
 * `model/domain.qnt` depArtifacts — WHAT THIS TICKET'S DEPENDENCIES PRODUCED.
 * Derived, never stored.
 *
 * The model's `Set[ArtifactMark]`, ordered BY THE KEY THAT DEDUPLICATES IT, so
 * that the array is a function of the set it denotes and nothing else. That is
 * the whole requirement, and it is stricter than it looks: ordering by
 * dependency id would order by WHICH dep carried which mark, so two Cores the
 * model calls equal here — same marks, different dependencies producing them —
 * would answer with unequal arrays, and a future consumer comparing them would
 * disagree with the model. No consumer exists yet — the model derives
 * `depArtifacts` and no decider reads it, s2b's included — which is exactly why
 * the canonicity has to be right before one arrives.
 *
 * THE ORDER IS LEXICOGRAPHIC ON THAT KEY, DELIBERATELY NOT NUMERIC ON THE
 * MARK: `ASome:10` sorts before `ASome:2`. Canonicity asks for an order that
 * is a function of the contents, not for a pretty one, and a numeric sort
 * would need a second comparison rule per constructor to stay total. Anything
 * that canonicalizes a decoded set to compare against this — s3's replayer —
 * must sort by the same key, not by the id. `measure.ts`'s `TaskSet` makes the
 * same kind of choice for the same reason; there the key is the task id, and
 * there it happens to be numeric.
 */
export function depArtifacts(c: Core, j: number): readonly ArtifactMark[] {
  const seen = new Map<string, ArtifactMark>();
  for (const d of waitsOn(c, j)) {
    const mark = ticketAt(c, d).artifact;
    seen.set(artifactKey(mark), mark);
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, mark]) => mark);
}

/** `model/domain.qnt` depsDoneIn — location-blind: Done-ness, never project. */
export function depsDoneIn(c: Core, j: number): boolean {
  for (const k of waitsOn(c, j)) {
    if (ticketAt(c, k).phase !== "PDone") {
      return false;
    }
  }
  return true;
}

// --- Core-parameterized enablement -----------------------------------------
// The model hoisted each of these out of its action so that the machine, the
// witness drivers and the replay checker consume ONE definition; the same
// hoist is what lets s3's `cmdEnabled` re-check a journaled decision at a
// replayed prefix state without copying anything.

/** `model/domain.qnt` canArriveIn — room for one more arrival. */
export function canArriveIn(cfg: Config, c: Core): boolean {
  return c.tickets.size < cfg.nTickets;
}

/** `model/domain.qnt` dependableIn — tickets a new arrival may depend on: no tombstones. */
export function dependableIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (k) => {
    const jb = ticketAt(c, k);
    return (
      jb.phase !== "PRevoked" &&
      !(jb.phase === "PEscalated" && jb.reason === "RsDependencyRevoked")
    );
  });
}

/** `model/domain.qnt` draftsIn — the only authoring phase, hence the only releasable set. */
export function draftsIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => ticketAt(c, j).phase === "PDraft");
}

/** `model/domain.qnt` revocablesIn — every non-terminal may be revoked. */
export function revocablesIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => revocableIn(c, j));
}

/** `model/domain.qnt` readiesIn — the derived Ready room. */
export function readiesIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => isReadyIn(c, j));
}

/** `model/domain.qnt` taskPhaseIn — tickets whose task set can receive completion events. */
export function taskPhaseIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => {
    const p = ticketAt(c, j).phase;
    return p === "PWorking" || p === "PEvaluating";
  });
}

/** `model/domain.qnt` reducibleWorkIn — a Working ticket whose task set is fully resolved. */
export function reducibleWorkIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => {
    const jb = ticketAt(c, j);
    return jb.phase === "PWorking" && runningCount(jb.tasks) === 0;
  });
}

/**
 * `model/domain.qnt` reducibleEvalIn — an Evaluating ticket whose CURRENT
 * stage's task set is fully resolved. Its twin above differs in the phase
 * conjunct alone, and that difference is the whole of which reduce fires.
 */
export function reducibleEvalIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => {
    const jb = ticketAt(c, j);
    return jb.phase === "PEvaluating" && runningCount(jb.tasks) === 0;
  });
}

/** `model/domain.qnt` wrapUpStartablesIn — enqueued tickets whose project's gate is free. */
export function wrapUpStartablesIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => wrapUpStartableIn(c, j));
}

/** `model/domain.qnt` holdingIn — the occupied gate slots. */
export function holdingIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => ticketAt(c, j).phase === "PWrapUpHolding");
}

/** `model/domain.qnt` doneIn — the landed tickets. */
export function doneIn(c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => ticketAt(c, j).phase === "PDone");
}

/** `model/domain.qnt` retryablesIn — parked tickets the operator may Retry. */
export function retryablesIn(cfg: Config, c: Core): ReadonlySet<number> {
  return keysWhere(c, (j) => retryableIn(cfg, c, j));
}

/**
 * `model/domain.qnt` isReadyIn — the derived waiting room: a dep that is not
 * Done blocks, including an UNRELEASED one.
 */
export function isReadyIn(c: Core, j: number): boolean {
  return ticketAt(c, j).phase === "PPending" && depsDoneIn(c, j);
}

/** `model/domain.qnt` isBlockedIn — Ready's complement inside Pending. */
export function isBlockedIn(c: Core, j: number): boolean {
  return ticketAt(c, j).phase === "PPending" && !depsDoneIn(c, j);
}

/**
 * `model/domain.qnt` dispatchableIn — Ready with gas to charge. THE hoisted
 * guard: the model's header records what a copied expression of it cost.
 */
export function dispatchableIn(c: Core, j: number): boolean {
  return isReadyIn(c, j) && ticketAt(c, j).gasLeft > 0;
}

/**
 * `model/domain.qnt` deliverableTaskIds — every task id ticket j has EVER
 * issued, which is the delivery range an at-least-once fabric may name.
 */
export function deliverableTaskIds(c: Core, j: number): ReadonlySet<number> {
  return rangeSet(firstTaskId, nextTaskId(ticketAt(c, j)) - 1);
}

// --- The lease guards ------------------------------------------------------

/**
 * The answer `leaseOf` gives for a wrap-up kind that needs no lease. The model
 * writes it as a bare `0` and states the property that makes it safe: no
 * resource universe contains it, so it can never collide with a real holder.
 *
 * THE PROPERTY IS BELOW THE FLOOR, NOT OUTSIDE ONE UNIVERSE. Any value outside
 * `1..N_PROJECTS` passes a membership check at some given instance and collides at
 * a larger one — `3` is safe at `nProjects = 2` and is a real resource at
 * `nProjects = 3`. What makes this value safe at EVERY admissible instance is
 * `noResource < firstProjectId`, and that is what the tests pin.
 */
export const noResource = firstProjectId - 1;

/**
 * `model/domain.qnt` leaseOf — the resource this ticket's wrap-up needs a lease
 * on.
 */
export function leaseOf(t: Ticket): number {
  switch (t.wrapUp.tag) {
    case "WNone":
      return noResource;
    case "WExclusive":
      return t.wrapUp.resource;
    default:
      return assertNever(t.wrapUp, "unhandled WrapUp");
  }
}

/**
 * `model/domain.qnt` leaseFreeIn — is resource `r` unheld? Occupancy is a
 * DERIVED predicate over phase, so nothing tracks it and nothing cleans up.
 *
 * The loop is bounded by the fleet, which the arrival bound bounds.
 */
export function leaseFreeIn(c: Core, r: number): boolean {
  for (const k of c.tickets.keys()) {
    const jb = ticketAt(c, k);
    if (jb.phase === "PWrapUpHolding" && leaseOf(jb) === r) {
      return false;
    }
  }
  return true;
}

/**
 * `model/domain.qnt` wrapUpStartableIn — may ticket j be DEQUEUED? Enqueued,
 * and its target project's gate free. THE DEPTH-1 REFUSAL LIVES HERE, and the
 * model's header records the trace it is pinned on.
 */
export function wrapUpStartableIn(c: Core, j: number): boolean {
  const jb = ticketAt(c, j);
  return jb.phase === "PWrapUp" && leaseFreeIn(c, leaseOf(jb));
}

/**
 * `model/domain.qnt` escalate — park a ticket on the human desk, naming the
 * wall and where Retry resumes. The open desk task is DERIVED from the phase
 * (`hasOpenHumanTask`); `OpenHumanTask` is its trace-visible effect.
 */
export function escalate(
  c: Core,
  j: number,
  at: Resume,
  why: Reason,
  label: string,
): Decision {
  return move(
    withTicket(c, j, {
      ...retireLive(ticketAt(c, j)),
      resumeAt: at,
      reason: why,
    }),
    j,
    "PEscalated",
    label,
    ["OpenHumanTask"],
  );
}

/**
 * `model/domain.qnt` decideDispatch — Ready -> Working for THE TICKET THE
 * DISPATCHER CHOSE, charging one gas. The choice is the dispatcher's agency,
 * so any policy refines it; this decider is the decision made first-class.
 */
export function decideDispatch(cfg: Config, c: Core, j: number): Decision {
  invariant(
    dispatchableIn(c, j),
    `decideDispatch: ticket ${String(j)} is not dispatchable`,
  );
  const jb = ticketAt(c, j);
  return move(
    withTicket(c, j, {
      ...spawnOn(jb, { tag: "TKWork" }, cfg.nTasks),
      gasLeft: jb.gasLeft - 1,
    }),
    j,
    "PWorking",
    "dispatch",
    ["SpawnWorkTasks"],
  );
}

/** The model's inline `match v { VPass => TPassed | VFail => TFailed }`. */
function resolutionOf(v: Verdict): TaskOutcome {
  switch (v) {
    case "VPass":
      return "TPassed";
    case "VFail":
      return "TFailed";
    default:
      return assertNever(v, "unhandled Verdict");
  }
}

/**
 * `model/domain.qnt` decideTaskDone — a completion event for task `tid` of
 * ticket j, in either task phase. FIRST WRITE WINS: a task that is not running
 * in the LIVE set makes this a duplicate or a stale delivery, and the decision
 * is a state-identical no-op — staleness absorbed by identity, because task
 * ids are unique across the ticket's whole history.
 *
 * IT ASSERTS WHERE THE MODEL IS TOTAL, and that is a different departure from
 * the file header's rule than every other assertion here. Elsewhere the rule is
 * "every STATED caller guarantee is asserted, by calling the predicate that
 * states it", and the guarantee is stated — in the model's prose, in the
 * action's draw set, or by a `get` the model's own body would error on. Here
 * the model states NONE and the body is total: an unknown `tid` finds no live
 * match and falls to the duplicate arm, and a ticket in no task phase would
 * simply be read. So the two `invariant`s below make a partial function out of
 * a total one, deliberately. `decideCompleteDuplicate` is the only other
 * decider in this file that does it, for the same reason and with the same
 * argument.
 *
 * IT COSTS NO CONFORMANCE, and that is the whole argument for it. The model's
 * own `taskDone` action draws `j` from `taskPhaseTickets` and `tid` from
 * `deliverableTaskIds(core, j)`, and `model/refinement.qnt`'s `cmdEnabled`
 * states the same pair on its `JTaskDone` arm — so no machine step, no journal
 * row and no golden trace can deliver a call these two refuse. What they turn
 * into a loud failure is a CALLER that reached past the guard: an interpreter
 * translating a fabric report, or a suite building a call by hand. Absorbing
 * that silently as a duplicate is the one answer that would be
 * indistinguishable from the absorption the arm below is FOR, which is why the
 * strictness wins over the totality here. `domain.test.ts` pins both refusals,
 * and pins that the absorb-by-identity claim itself is unaffected.
 */
export function decideTaskDone(
  c: Core,
  j: number,
  tid: number,
  v: Verdict,
): Decision {
  invariant(
    taskPhaseIn(c).has(j),
    `decideTaskDone: ticket ${String(j)} holds no task set to complete into`,
  );
  invariant(
    deliverableTaskIds(c, j).has(tid),
    `decideTaskDone: task ${String(tid)} was never issued by ticket ${String(j)}`,
  );
  const jb = ticketAt(c, j);
  if (jb.tasks.some((t) => t.id === tid && t.state.tag === "TSRunning")) {
    return {
      rec: {
        label: "task-done",
        transitions: [],
        effects: [],
        attempt: { tag: "WONone" },
      },
      post: withTicket(c, j, {
        ...jb,
        tasks: resolveTask(jb.tasks, tid, resolutionOf(v)),
      }),
    };
  }
  return noop(c, "task-done-duplicate");
}

/**
 * `model/domain.qnt` decideWorkReduce — the Working task set fully resolved,
 * reduced at CYCLE level. A pass retires the work set, stamps the artifact it
 * produced, and spawns the eval program's LOWEST stage in full; a failed set
 * is a failed cycle and escalates directly, because retry below the cycle is
 * the fabric's and modelling our own is a standing non-goal.
 *
 * `taskPassed` is `measure.ts`'s, which is the same predicate the model writes
 * out here — `t.state == TSResolved(TPassed)` — rather than a second spelling
 * of it.
 */
export function decideWorkReduce(c: Core, j: number): Decision {
  invariant(
    reducibleWorkIn(c).has(j),
    `decideWorkReduce: ticket ${String(j)} is not a Working ticket with a fully-resolved set`,
  );
  const jb = ticketAt(c, j);
  const retired = retireLive(jb);
  if (jb.tasks.every((t) => taskPassed(t))) {
    const lowest = retired.program[0];
    invariant(
      lowest !== undefined,
      `decideWorkReduce: ticket ${String(j)} carries an empty program, which no arrival can author`,
    );
    return move(
      withTicket(c, j, {
        ...spawnOn(retired, { tag: "TKEval", stage: 0 }, lowest.fanout),
        artifact: { tag: "ASome", id: retired.spawned },
      }),
      j,
      "PEvaluating",
      "work-passed",
      ["SpawnEvalTasks"],
    );
  }
  return escalate(
    c,
    j,
    "RWorking",
    "RsWorkFailed",
    "ticket-escalated work_failed",
  );
}

/**
 * `model/domain.qnt` decideEvalStageReduce — THE EVAL-PROGRAM INTERPRETER. The
 * machinery is here; the program is data on the ticket. Three edges out of a
 * fully-resolved stage — advance, pass, short-circuit — and the model's header
 * argues each, including why a skipped stage leaves no task records and why an
 * evaluator's own death is priced as a failed verdict.
 *
 * TWO ENCODINGS, both forced by TypeScript and neither changing an answer:
 *
 *   - The model's `s + 1 < jb.program.length()` becomes the indexed lookup
 *     being defined. Over a dense list they are the same question, and only
 *     the lookup narrows the value the next branch needs.
 *   - `program[s]` is read off the LIVE ticket and `program[s + 1]` off the
 *     retired one, exactly as the model writes it. `retireLive` does not touch
 *     the program, so the two reads see one list.
 */
export function decideEvalStageReduce(
  cfg: Config,
  c: Core,
  j: number,
): Decision {
  invariant(
    reducibleEvalIn(c).has(j),
    `decideEvalStageReduce: ticket ${String(j)} is not an Evaluating ticket with a fully-resolved stage`,
  );
  const jb = ticketAt(c, j);
  const s = evalStage(jb.tasks);
  const retired = retireLive(jb);
  const current = jb.program[s];
  invariant(
    current !== undefined,
    `decideEvalStageReduce: stage ${String(s)} indexes into ticket ${String(j)}'s program of ${String(jb.program.length)}`,
  );
  if (combine(current.combinator, jb.tasks)) {
    const next = retired.program[s + 1];
    if (next !== undefined) {
      return move(
        withTicket(
          c,
          j,
          spawnOn(retired, { tag: "TKEval", stage: s + 1 }, next.fanout),
        ),
        j,
        "PEvaluating",
        "eval-stage-passed",
        ["SpawnEvalTasks"],
      );
    }
    // THE WRAP-UP ROUTE. A `WNone` ticket's effect already happened during
    // work, so evaluation passing IS its completion — and it completes on the
    // RETIRED ticket, because skipping the wrap-up phases skips the retirement
    // they would have done.
    switch (jb.wrapUp.tag) {
      case "WNone":
        return completeTicket(withTicket(c, j, retired), j);
      case "WExclusive":
        return move(withTicket(c, j, retired), j, "PWrapUp", "eval-passed", [
          "EnqueueWrapUp",
        ]);
      default:
        return assertNever(jb.wrapUp, "unhandled WrapUp");
    }
  }
  if (jb.reworkLeft > 0 && jb.gasLeft > 0) {
    return move(
      withTicket(c, j, {
        ...spawnOn(retired, { tag: "TKWork" }, cfg.nTasks),
        reworkLeft: jb.reworkLeft - 1,
        gasLeft: jb.gasLeft - 1,
      }),
      j,
      "PWorking",
      "rework-started eval_failure",
      ["SpawnWorkTasks"],
    );
  }
  if (jb.reworkLeft === 0) {
    return escalate(
      c,
      j,
      "REvaluating",
      "RsReworkBudgetExhausted",
      "ticket-escalated rework_budget_exhausted",
    );
  }
  return escalate(
    c,
    j,
    "REvaluating",
    "RsGasExhausted",
    "ticket-escalated gas_exhausted",
  );
}

/**
 * `model/domain.qnt` wrapUpOutcomes — the outcomes the environment may DRAW for
 * a wrap-up attempt, given its invalidation choice. THE SET IS THE REFUSAL, on
 * `validPrograms`'s shape: a valid artifact has no failure to draw.
 *
 * A `Set` of primitives, so this one really is the model's set — it contains
 * and compares structurally, and no canonical order has to be invented for it.
 */
export function wrapUpOutcomes(
  invalidated: boolean,
): ReadonlySet<WrapUpOutcome> {
  return invalidated
    ? new Set<WrapUpOutcome>(["WOk", "WFailed"])
    : new Set<WrapUpOutcome>(["WOk"]);
}

/**
 * `model/domain.qnt` decideWrapUpStart — THE DEQUEUE, MOVED ARM: the ticket
 * takes its project's depth-1 slot while the candidate is built and validated.
 * Charges nothing; the gate prices only its failures.
 */
export function decideWrapUpStart(c: Core, j: number): Decision {
  invariant(
    wrapUpStartableIn(c, j),
    `decideWrapUpStart: ticket ${String(j)} is not dequeue-able — the depth-1 refusal`,
  );
  return move(c, j, "PWrapUpHolding", "wrapup-started", ["OpenGate"]);
}

/**
 * `model/domain.qnt` decideDequeue — THE ROUTING RULE, hoisted: how a dequeue
 * routes on the environment's invalidated choice is machine semantics, so it
 * lives in a decider rather than in an action's if/else. The model's header
 * records the mutant that made the hoist necessary.
 *
 * It asserts nothing of its own: both arms assert `wrapUpStartableIn`, which is
 * this decider's whole caller guarantee, and a third copy of it here would be
 * the restatement the hoist exists to prevent.
 */
export function decideDequeue(
  cfg: Config,
  c: Core,
  j: number,
  moved: boolean,
): Decision {
  return moved
    ? decideWrapUpStart(c, j)
    : decideWrapUpResolve(cfg, c, j, "WOk", false);
}

/**
 * `model/domain.qnt` completeTicket — THE COMPLETION: the ticket reaches
 * `PDone`, and that is the whole of it. One transition, one effect, and the
 * ghost `completions` counter bumped once.
 *
 * The effect is not a parameter, because both routes in — a `WOk` wrap-up
 * resolution and a `WNone` ticket's passing evaluation — emit the same
 * `Complete`: the domain knows only that the step succeeded and never which
 * mechanism promoted anything.
 */
export function completeTicket(c: Core, j: number): Decision {
  const jb = ticketAt(c, j);
  return {
    rec: {
      label: "ticket-done",
      transitions: [{ ticket: j, from: jb.phase, to: "PDone" }],
      effects: ["Complete"],
      attempt: { tag: "WONone" },
    },
    post: withTicket(c, j, {
      ...jb,
      phase: "PDone",
      completions: jb.completions + 1,
    }),
  };
}

/**
 * The gate rework's re-entry, shared by the two pricings exactly as they share
 * it in the model: respawn the work set, charge what the pricing says.
 *
 * Nothing is retired here, and the model says why at `completeTicket`'s sibling
 * comment: on the lease path the eval set was already retired when the ticket
 * enqueued, so a `retireLive` at this point would retire an empty set and
 * `spawnOn`'s own precondition already holds.
 */
function wrapUpRework(
  cfg: Config,
  c: Core,
  j: number,
  spend: Pick<Ticket, "wrapUpLeft" | "gasLeft">,
): Decision {
  return move(
    withTicket(c, j, {
      ...spawnOn(ticketAt(c, j), { tag: "TKWork" }, cfg.nTasks),
      ...spend,
    }),
    j,
    "PWorking",
    "rework-started wrapup_failure",
    ["SpawnWorkTasks"],
  );
}

/**
 * The model's `match out { WOk => … | WFailed => … }`, as its own definition so
 * that it is a switch with an `assertNever` arm rather than a two-way test on a
 * union that may one day have three constructors.
 */
function resolveWrapUp(
  cfg: Config,
  c: Core,
  j: number,
  out: WrapUpOutcome,
): Decision {
  switch (out) {
    case "WOk":
      return completeTicket(c, j);
    case "WFailed":
      return failWrapUp(cfg, c, j);
    default:
      return assertNever(out, "unhandled WrapUpOutcome");
  }
}

/**
 * The `WFailed` arm of `model/domain.qnt` decideWrapUpResolve, priced per
 * `WRAPUP_PRICING`: `Budgeted(n)` spends the wrap-up account AND gas,
 * `DeadlineOnly` spends gas alone. Either wall parks the ticket with its own
 * name and `resumeAt` `RWrapUp` — re-ENQUEUING, never back into the gate.
 *
 * `DeadlineOnly` passes `wrapUpLeft` through unchanged, which is what its arm
 * not naming the field means: there is no gate account to spend.
 */
function failWrapUp(cfg: Config, c: Core, j: number): Decision {
  const jb = ticketAt(c, j);
  switch (cfg.wrapUpPricing.tag) {
    case "Budgeted":
      if (jb.wrapUpLeft > 0 && jb.gasLeft > 0) {
        return wrapUpRework(cfg, c, j, {
          wrapUpLeft: jb.wrapUpLeft - 1,
          gasLeft: jb.gasLeft - 1,
        });
      }
      if (jb.wrapUpLeft === 0) {
        return escalate(
          c,
          j,
          "RWrapUp",
          "RsWrapUpBudgetExhausted",
          "ticket-escalated wrapup_budget_exhausted",
        );
      }
      return escalate(
        c,
        j,
        "RWrapUp",
        "RsGasExhausted",
        "ticket-escalated gas_exhausted",
      );
    case "DeadlineOnly":
      if (jb.gasLeft > 0) {
        return wrapUpRework(cfg, c, j, {
          wrapUpLeft: jb.wrapUpLeft,
          gasLeft: jb.gasLeft - 1,
        });
      }
      return escalate(
        c,
        j,
        "RWrapUp",
        "RsGasExhausted",
        "ticket-escalated gas_exhausted",
      );
    default:
      return assertNever(cfg.wrapUpPricing, "unhandled WrapUpPricing");
  }
}

/**
 * `model/domain.qnt` decideWrapUpResolve — the wrap-up resolves at the END of a
 * concrete path: the QUIET fast-path straight off the queue, or the GATED
 * resolution out of the held slot. EVERY arm stamps the attempt's attribution.
 *
 * THREE CALLER GUARANTEES, each asserted by calling the definition that states
 * it. The outcome is drawn from `wrapUpOutcomes(moved)` — the draw rule, which
 * is what makes "a valid artifact cannot fail" structural rather than argued.
 * The PATH is the other two: a moved attempt resolves out of the gate, so its
 * ticket is in `holdingIn`; a quiet one resolves at the dequeue, whose guard is
 * `wrapUpStartableIn`. The model states the pair as prose at this decider,
 * checks it on every reachable step as `wrapUpIsolation`'s path iff, and names
 * both halves as enablement in `model/refinement.qnt`'s `cmdEnabled` —
 * `JDequeue` asks `wrapUpStartablesIn`, `JGateResolve` asks `holdingIn` and the
 * same draw rule — so s3's replay checker re-checks exactly these.
 */
export function decideWrapUpResolve(
  cfg: Config,
  c: Core,
  j: number,
  out: WrapUpOutcome,
  moved: boolean,
): Decision {
  invariant(
    wrapUpOutcomes(moved).has(out),
    `decideWrapUpResolve: ${out} is not drawable for an attempt the environment left ${moved ? "invalidated" : "valid"}`,
  );
  if (moved) {
    invariant(
      holdingIn(c).has(j),
      `decideWrapUpResolve: ticket ${String(j)} holds no gate slot, and a moved attempt resolves out of the gate`,
    );
  } else {
    invariant(
      wrapUpStartableIn(c, j),
      `decideWrapUpResolve: ticket ${String(j)} is not dequeue-able, and a quiet attempt resolves at the dequeue`,
    );
  }
  return withWrapUpObs(
    resolveWrapUp(cfg, c, j, out),
    ticketAt(c, j).project,
    moved,
  );
}

/**
 * `model/domain.qnt` decideCompleteDuplicate — a duplicate landing event for an
 * already-Done ticket. NO completion effect is emitted, and that no-op IS the
 * exactly-once-at-the-landing-boundary claim.
 *
 * THE SECOND OF THE TWO DECIDERS THAT ASSERT WHERE THE MODEL IS TOTAL, on
 * `decideTaskDone`'s argument and for its reason: the model's definition is
 * `noop` over any `j` at all, its `completeDuplicate` action draws `j` from
 * `doneTickets`, and `cmdEnabled`'s `JCompleteDuplicate` arm asks `doneIn` — so
 * nothing the machine can take is refused here, and what the assertion catches
 * is a caller that reached past the guard. Absorbing that silently would make a
 * re-delivery for a ticket that never landed indistinguishable from one for a
 * ticket that did, which is the whole claim this decider makes.
 */
export function decideCompleteDuplicate(c: Core, j: number): Decision {
  invariant(
    doneIn(c).has(j),
    `decideCompleteDuplicate: ticket ${String(j)} has not landed, so no landing of it can be re-delivered`,
  );
  return noop(c, "complete-duplicate");
}

/**
 * `model/domain.qnt` decideRevalFail — the world changed under a ticket before
 * it ever ran. Free, and the desk opens; the resume is the pre-work one.
 *
 * Guarded by `isReadyIn` and NOT by `dispatchableIn`: the model's `revalFail`
 * action draws from the same set as `dispatch` but does not conjoin the gas
 * check, and it is right not to — this park spends nothing.
 */
export function decideRevalFail(c: Core, j: number): Decision {
  invariant(
    isReadyIn(c, j),
    `decideRevalFail: ticket ${String(j)} is not Ready — revalidation fails at the moment a ticket would start`,
  );
  return escalate(
    c,
    j,
    "RPending",
    "RsRevalidationFailed",
    "ticket-escalated revalidation_failed",
  );
}

/**
 * `model/domain.qnt` decideOpRetry — THE operator resume: one decider, a flavor
 * per resume point, one trace label, the flavor visible in the transition's
 * target.
 *
 * THE GUARD IS `retryableIn` MINUS THE ARM THE MODEL WROTE, and it is written
 * as that subtraction rather than as a copy: `hasModeledResume` is the conjunct
 * both definitions read. `retryableIn` refuses two disjoint things — a park
 * with NO modeled resume (the `dependency_revoked` wall), and a park whose
 * charging resume it cannot afford. The model answers the first with the
 * guarded no-op arm below, which is total and which this file reproduces, so
 * asserting it away here would delete a documented arm; the second would
 * overdraw gas, so it is refused.
 * That leaves every arm that reads `resumed` holding `resumeCharge <= gasLeft`,
 * which is what keeps `accountsBounded` true of the post-state.
 */
export function decideOpRetry(cfg: Config, c: Core, j: number): Decision {
  const jb = ticketAt(c, j);
  invariant(
    !hasModeledResume(jb) || retryableIn(cfg, c, j),
    `decideOpRetry: ticket ${String(j)} is parked behind a resume it cannot afford, or is not parked at all`,
  );
  // Computed once, before the flavor, as the model computes it. The `RNone`
  // arm never reads it.
  const resumed: Ticket = {
    ...jb,
    reason: "RsNone",
    resumeAt: "RNone",
    gasLeft: jb.gasLeft - resumeCharge(cfg, jb.resumeAt),
  };
  switch (jb.resumeAt) {
    case "RPending":
      return move(
        withTicket(c, j, resumed),
        j,
        "PPending",
        "operator-retry",
        [],
      );
    case "RWorking":
      return move(
        withTicket(c, j, spawnOn(resumed, { tag: "TKWork" }, cfg.nTasks)),
        j,
        "PWorking",
        "operator-retry",
        ["SpawnWorkTasks"],
      );
    case "REvaluating": {
      const lowest = jb.program[0];
      invariant(
        lowest !== undefined,
        `decideOpRetry: ticket ${String(j)} carries an empty program, which no arrival can author`,
      );
      return move(
        withTicket(
          c,
          j,
          spawnOn(resumed, { tag: "TKEval", stage: 0 }, lowest.fanout),
        ),
        j,
        "PEvaluating",
        "operator-retry",
        ["SpawnEvalTasks"],
      );
    }
    case "RWrapUp":
      return move(withTicket(c, j, resumed), j, "PWrapUp", "operator-retry", [
        "EnqueueWrapUp",
      ]);
    case "RNone":
      // Unreachable through the machine: `retryableIn` refuses a ticket with no
      // modeled resume, whose only exit is revoke.
      return noop(c, "operator-retry-unreachable");
    default:
      return assertNever(jb.resumeAt, "unhandled Resume");
  }
}
