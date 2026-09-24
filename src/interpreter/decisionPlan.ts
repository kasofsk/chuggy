/**
 * Every durable consequence of one pure decision, derived from the event it
 * journals, the obligations it owes and the two `TicketGraph`s it stands
 * between.
 *
 * AN OPEN ACTION ADMITS THE ANSWERS THE ACTOR WILL ACCEPT, not a part of them.
 * `decide` refuses a resume only at a ticket parked at no wall, and every wall
 * the machine parks a ticket at has a resume. A raise is on a parked ticket,
 * so the resume and the revoke (refused only outside the phases a revocation
 * is allowed in) are both accepted at it, and offering fewer would hand a
 * person a shorter list than the actor accepts.
 *
 * THE SET IS DECIDED AT THE RAISE, AND THAT IS ENOUGH BECAUSE NOTHING A
 * PARKED TICKET ADMITS CAN MOVE WHILE IT IS PARKED. Both answers are enabled
 * on the phase, and the only steps that leave it are the two this action
 * offers. So a set that is right when the action opens stays right for as long
 * as there is anyone to serve it to, which is why `nativeActionAdmits` reading
 * the stored row back is sound.
 */

import type { Entry } from "../actor/journal.ts";
import { eventTicket } from "../domain/evolve.ts";
import { ticketAt } from "../domain/ticketGraph.ts";
import type {
  TicketGraph,
  Obligation,
  Phase,
  TaskIdentity,
  Ticket,
} from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import { currentInstance, runningStageIndex } from "../domain/ticket.ts";
import type { DecisionInput } from "./projectDiscovery.ts";
import type { ExecutionSourceObservation } from "./executionSource.ts";
import {
  inputBundleReferencesMax,
  type InputBundleReference,
} from "./finalizer.ts";
import {
  inputBundleIdentityKind,
  type ConfigurationPin,
  type DecisionMaterialization,
  type ExecutionRequestBundle,
  type ExecutionRequestPlan,
  type NativeActionPlan,
  type TicketSourceRecord,
} from "./projectDecision.ts";

/**
 * A durable row's name: the decision's sequence, the index of the obligation
 * the row answers, and that obligation's kind. Nothing parses one back.
 */
function identity(
  entry: Entry,
  index: number,
  kind: Obligation["type"] | typeof inputBundleIdentityKind,
): string {
  return `${String(entry.seq)}:${String(index)}:${kind}`;
}

/**
 * The obligations of one kind a decision owes, each at its index in the
 * decision's list. A decision concerns the one ticket its event names, so an
 * obligation naming another is a decision contradicting itself.
 */
function obligationsOf<Kind extends Obligation["type"]>(
  entry: Entry,
  obligations: readonly Obligation[],
  kind: Kind,
): readonly {
  readonly index: number;
  readonly obligation: Extract<Obligation, { readonly type: Kind }>;
}[] {
  const ticket = eventTicket(entry.event);
  return obligations.flatMap((obligation, index) => {
    if (obligation.value.ticket !== ticket)
      throw new Error(
        "decision plan: an obligation names a ticket its event does not",
      );
    return obligation.type === kind
      ? [
          {
            index,
            obligation: obligation as Extract<
              Obligation,
              { readonly type: Kind }
            >,
          },
        ]
      : [];
  });
}

/**
 * The slots the ticket's newest spawn claimed, and the position each of them
 * is numbered at. A work cycle claims one; an evaluation run claims the whole
 * roster of the stage it is running, whether or not every evaluator in it was
 * asked, which is what keeps `spawned` a function of the instance alone.
 */
function liveSlotRoster(ticket: Ticket): readonly number[] {
  if (ticket.phase !== "Evaluation") return [0];
  const stage =
    ticket.definition.evaluationPlan.stages[
      runningStageIndex(currentInstance(ticket))
    ];
  if (stage === undefined)
    throw new Error("decision plan: the running stage is outside the plan");
  return stage.evaluators.map((entry) => entry.key);
}

/**
 * THE WIRE'S NAME FOR EACH TASK, MINTED HERE AND NOWHERE ELSE, beside the
 * identity the machine knows it by: a spawn's numbers continue the ticket's
 * spawn count and a task takes the position its evaluator holds in the stage
 * its run is running, so what a ticket hands out is injective and ascending
 * over its whole history and a cancellation naming part of a run names it by
 * the numbers its spawn minted. THE BASE MOVES BY THE WHOLE ROSTER AND NOT BY
 * WHAT WAS ASKED, because a resume re-asks only the evaluators a wall stopped
 * and claims the roster again — numbering by the tasks dispatched would
 * restart the second generation inside the first's numbers and re-mint one,
 * which `execution_names_one_logical_task` absorbs as a silent no-op insert
 * under `ON CONFLICT`.
 */
function requestTasks(
  ticket: Ticket,
  identities: readonly TaskIdentity[],
): ExecutionRequestPlan["tasks"] {
  const roster = liveSlotRoster(ticket);
  const base = ticket.spawned - roster.length;
  return identities.map((identity) => {
    const slot =
      identity.type === "WorkTask"
        ? 0
        : roster.indexOf(identity.value.evaluator);
    if (slot < 0)
      throw new Error("decision plan: a task names no slot of its run");
    return { task: base + slot + 1, identity };
  });
}

/**
 * The bundle a spawn pins, carrying the evidence of the finalization that
 * caused it where one did. A bundle built from evidence pins no source of its
 * own, because the evidence carries the failed attempt's whole bundle forward
 * — target commit and all — and a second one under that kind leaves a worker
 * two answers to what its work is based on.
 */
function executionRequestBundle(
  input: DecisionInput,
  entry: Entry,
  index: number,
  source: ExecutionSourceObservation | undefined,
): ExecutionRequestBundle {
  const evidence =
    entry.event.type === "TicketFinalizationNeedsWork"
      ? input.source.finalizationRequest?.evidence
      : undefined;
  return {
    bundle: identity(entry, index, inputBundleIdentityKind),
    ...(evidence === undefined ? {} : { evidence }),
    ...(source === undefined || evidence !== undefined
      ? {}
      : {
          source: {
            repository: source.repository,
            ...(source.target.ref === undefined
              ? {}
              : { targetRef: source.target.ref }),
            targetCommit: source.target.commit,
            manifests: source.manifests,
          },
        }),
  };
}

/**
 * A decision's `ExecuteTask`s as the one request they run as: one bundle, one
 * capacity account, one configuration pin, numbered at the index of the first.
 * The request's kind is the scheduler's own word for which phase the tasks
 * run in, read off the identities they carry.
 */
function executeRequest(
  input: DecisionInput,
  entry: Entry,
  obligations: readonly Obligation[],
  post: TicketGraph,
  source: ExecutionSourceObservation | undefined,
): readonly ExecutionRequestPlan[] {
  const run = obligationsOf(entry, obligations, "ExecuteTask");
  const first = run[0];
  if (first === undefined) return [];
  const identities = run.map((each) => each.obligation.value.task.task);
  const phase = first.obligation.value.task.task.type;
  if (identities.some((task) => task.type !== phase))
    throw new Error("decision plan: one decision owes tasks of two phases");
  const ticket = eventTicket(entry.event);
  return [
    {
      request: identity(entry, first.index, "ExecuteTask"),
      effectPosition: first.index,
      ticket,
      ticketVersion: entry.seq,
      kind: phase === "WorkTask" ? "SpawnWork" : "SpawnEvaluation",
      bundle: executionRequestBundle(input, entry, first.index, source),
      tasks: requestTasks(ticketAt(post, ticket), identities),
    },
  ];
}

/**
 * A decision's `CancelTask`s as the one request that retires them, numbered
 * off the ticket as it stood before the decision, which is the spawn that
 * minted them. A cancellation authorizes no work and pins no bundle.
 */
function cancelRequest(
  entry: Entry,
  obligations: readonly Obligation[],
  pre: TicketGraph,
): readonly ExecutionRequestPlan[] {
  const run = obligationsOf(entry, obligations, "CancelTask");
  const first = run[0];
  if (first === undefined) return [];
  const ticket = eventTicket(entry.event);
  return [
    {
      request: identity(entry, first.index, "CancelTask"),
      effectPosition: first.index,
      ticket,
      ticketVersion: entry.seq,
      kind: "CancelTicketWork",
      tasks: requestTasks(
        ticketAt(pre, ticket),
        run.map((each) => each.obligation.value.task),
      ),
    },
  ];
}

/** A decision's `FinalizeTicket`, as the request the finalizer claims. */
function finalizationRequests(
  entry: Entry,
  obligations: readonly Obligation[],
  post: TicketGraph,
): DecisionMaterialization["finalization"] {
  return obligationsOf(entry, obligations, "FinalizeTicket").map(
    ({ index, obligation }) => {
      const ticket = eventTicket(entry.event);
      if (ticketAt(post, ticket).phase !== "Finalization")
        throw new Error(
          "decision plan: a finalization is owed by a ticket not finalizing",
        );
      return {
        request: identity(entry, index, "FinalizeTicket"),
        effectPosition: index,
        ticket,
        ticketVersion: entry.seq,
        requestGeneration: entry.seq,
        workCycle: obligation.value.finalization.workCycle,
        generation: obligation.value.finalization.generation,
        kind: "RunFinalizer" as const,
      };
    },
  );
}

/**
 * The desk a decision opens, which no obligation names: a ticket the decision
 * moved into `Escalated` is asked of a person, and one decision escalates at
 * most the one ticket it is about.
 */
function nativeActions(
  entry: Entry,
  pre: TicketGraph,
  post: TicketGraph,
): readonly NativeActionPlan[] {
  const ticket = eventTicket(entry.event);
  const after = ticketAt(post, ticket);
  if (
    pre.tickets.get(ticket)?.phase === "Escalated" ||
    after.phase !== "Escalated"
  )
    return [];
  return [
    {
      action: `${String(entry.seq)}:TicketEscalation`,
      ticket,
      version: entry.seq,
      kind: "TicketEscalation",
      escalation: after.escalation,
      capability: "ResolveTicket",
      resolutions: ["Resume", "Revoke"],
    },
  ];
}

/**
 * The references one spawn's bundle pins, in the order a holder reads them and
 * with no reference declared twice. A failed finalization contributes the exact
 * immutable identities its evidence named, so a worker forms its reconciliation
 * objective from the bundle rather than from whatever a ref holds now.
 */
export function inputBundleReferencesOf(
  configuration: ConfigurationPin,
  bundle: ExecutionRequestBundle,
): readonly InputBundleReference[] {
  const evidence = bundle.evidence;
  const source = bundle.source;
  const named: readonly InputBundleReference[] = [
    {
      kind: "ConfigurationRevision",
      reference: configuration.configurationRevision,
      digest: configuration.configurationDigest,
    },
    ...(source === undefined
      ? []
      : [
          { kind: "Repository" as const, reference: source.repository },
          { kind: "TargetCommit" as const, reference: source.targetCommit },
          ...source.manifests.map((manifest) => ({
            kind: "ResultManifest" as const,
            reference: manifest,
          })),
        ]),
    ...(evidence === undefined
      ? []
      : [
          ...evidence.preparation,
          {
            kind: "FinalizationAttempt" as const,
            reference: evidence.attempt,
            digest: evidence.attemptDigest,
          },
          { kind: "TargetCommit" as const, reference: evidence.targetCommit },
          ...(evidence.conflictManifest === undefined
            ? []
            : [
                {
                  kind: "ConflictManifest" as const,
                  reference: evidence.conflictManifest,
                  ...(evidence.conflictManifestDigest === undefined
                    ? {}
                    : { digest: evidence.conflictManifestDigest }),
                },
              ]),
        ]),
  ];
  const seen = new Set<string>();
  const references = named.filter((reference) => {
    const key = `${reference.kind}:${reference.reference}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (references.length > inputBundleReferencesMax) {
    throw new RangeError(
      `decision plan: ${String(references.length)} references is past the most one bundle pins`,
    );
  }
  return references;
}

/**
 * The phases an open native action can stand in: `Escalated` carries the desk
 * task, `Finalization` carries the finalization approval. `native_action` admits
 * one open row per ticket, so a ticket leaving either phase must take its
 * question with it or the next one cannot be opened at all.
 */
const materializationActionablePhases: readonly Phase[] = [
  "Escalated",
  "Finalization",
];

/**
 * The tickets whose open action this decision leaves standing on a question
 * nobody is being asked any more. An answer withdraws nothing, because the
 * resolution it carries is the same row's own fence.
 */
function materializationWithdrawals(
  input: DecisionInput,
  entry: Entry,
  pre: TicketGraph,
  post: TicketGraph,
): readonly TicketId[] {
  if (input.source.nativeAction !== undefined) return [];
  const ticket = eventTicket(entry.event);
  const before = pre.tickets.get(ticket);
  const after = post.tickets.get(ticket);
  return before !== undefined &&
    after !== undefined &&
    materializationActionablePhases.includes(before.phase) &&
    after.phase !== before.phase
    ? [ticket]
    : [];
}

/**
 * What a decision's spawns run against: the source the requests are built from,
 * and the row a dispatch's own observation adds to the ticket's sources. Only a
 * dispatch carries the second, every other spawn running at a source some
 * earlier decision already wrote down.
 */
export interface SpawnSources {
  readonly source?: ExecutionSourceObservation;
  readonly pinned?: TicketSourceRecord;
}

/** The event arms a finalizer's result is journalled at, each of which fulfils the request it answered. */
const finalizationAnsweredEvents: readonly Entry["event"]["type"][] = [
  "TicketFinalizationSucceeded",
  "TicketFinalizationNeedsWork",
  "TicketFinalizationUnavailable",
];

/**
 * Derives every durable consequence of one decision from the event it
 * journals, the obligations it owes and the two graphs it stands between.
 */
export function materializationOf(
  input: DecisionInput,
  pre: TicketGraph,
  post: TicketGraph,
  entry: Entry,
  obligations: readonly Obligation[],
  spawn: SpawnSources = {},
): DecisionMaterialization {
  return {
    execution: [
      ...executeRequest(input, entry, obligations, post, spawn.source),
      ...cancelRequest(entry, obligations, pre),
    ],
    actions: nativeActions(entry, pre, post),
    finalization: finalizationRequests(entry, obligations, post),
    fulfillFinalizationFor: finalizationAnsweredEvents.includes(
      entry.event.type,
    )
      ? [eventTicket(entry.event)]
      : [],
    withdrawActionsFor: materializationWithdrawals(input, entry, pre, post),
    ...(input.source.nativeAction === undefined
      ? {}
      : { resolveAction: input.source.nativeAction }),
    ...(spawn.pinned === undefined ? {} : { ticketSource: spawn.pinned }),
  };
}
