/**
 * `model/domain.qnt`'s AUTHORING-AND-WORK HALF in TypeScript: the machine's
 * consts, the authoring universes, the decision plumbing, twelve of the twenty
 * `*In` enablement predicates, and six of the thirteen deciders.
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
 * DEFINITION ORDER IS THE MODEL'S, so the two files read side by side. The gaps
 * are the other half's — the eval/gate/desk predicates and deciders
 * (`reducibleEvalIn`, `wrapUpStartableIn`, `leaseFreeIn`, `holdingIn`,
 * `doneIn`, `retryablesIn`, `retryableIn`, `wrapUpOutcomes`, `resumeCharge`,
 * `leaseOf`, `withWrapUpObs`, `completeTicket`, and the seven remaining
 * deciders) land in the same order in the same file, in their model positions.
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
 * machine: a repo id by `N_REPOS`, a task id by the ticket's own spawn
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
  readonly nRepos: number;
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
    atLeastOne(cfg.nRepos) &&
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
  for (const r of repos(cfg)) {
    choices.push({ tag: "WExclusive", resource: r });
  }
  return choices;
}

/** `model/domain.qnt` repos — the repo universe an arrival's target is drawn from. */
export function repos(cfg: Config): ReadonlySet<number> {
  return rangeSet(1, cfg.nRepos);
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
  repo: number,
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
    repo,
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
      landing: { tag: "WONone" },
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
    rec: { label, transitions: [], effects: [], landing: { tag: "WONone" } },
    post: c,
  };
}

// --- Authoring: arrival, release, revoke -----------------------------------

/**
 * `model/domain.qnt` decideArrive — a ticket ARRIVES as a Draft. Ids are dense
 * and never reused (next id = fleet size + 1).
 *
 * THE MODEL'S FOUR STATED CALLER GUARANTEES ARE ASSERTED, each by calling the
 * definition that states it: deps drawn from `dependableIn` (no tombstones),
 * the program from `validPrograms`, the repo from `repos`, the wrap-up kind
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
  repo: number,
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
    repos(cfg).has(repo),
    `decideArrive: repo ${String(repo)} is outside the repo universe`,
  );
  const kind = wrapUpKey(wrapUp);
  invariant(
    wrapUpChoices(cfg).some((w) => wrapUpKey(w) === kind),
    `decideArrive: ${kind} is not an authorable wrap-up kind`,
  );

  const id = c.tickets.size + firstTicketId;
  invariant(
    !c.tickets.has(id),
    `decideArrive: id ${String(id)} is taken, so the fleet's ids are not dense`,
  );
  const tickets = new Map(c.tickets);
  tickets.set(id, freshTicket(cfg, deps, program, repo, wrapUp));
  return {
    rec: {
      label: "ticket-arrived",
      transitions: [],
      effects: ["CreateDraft"],
      landing: { tag: "WONone" },
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
      landing: { tag: "WONone" },
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
 * would answer with unequal arrays, and s2b's release read would compare them
 * and disagree with the model.
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

/** `model/domain.qnt` depsDoneIn — location-blind: Done-ness, never repo. */
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
        landing: { tag: "WONone" },
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
