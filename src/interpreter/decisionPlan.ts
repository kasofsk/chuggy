/**
 * Every durable consequence of one pure decision, derived from the journal
 * entry and the two `TicketGraph`s it stands between.
 *
 * AN OPEN ACTION ADMITS THE ANSWERS THE ACTOR WILL ACCEPT, not a part of them.
 * `decisionEventEnabled` puts a resume through `retryableIn`, which is the
 * ticket being parked and nothing else once the resume is derived from the
 * escalation: every wall the machine parks a ticket at has one. A raise is on
 * a parked ticket, so the resume and the revoke (`revocableIn`, the phase
 * alone) are both enabled at it, and offering fewer would hand a person a
 * shorter list than the actor accepts.
 *
 * THE SET IS DECIDED AT THE RAISE, AND THAT IS ENOUGH BECAUSE NOTHING A
 * PARKED TICKET ADMITS CAN MOVE WHILE IT IS PARKED. Both answers are enabled
 * on the phase, and the only steps that leave it are the two this action
 * offers. So a set that is right when the action opens stays right for as long
 * as there is anyone to serve it to, which is why `nativeActionAdmits` reading
 * the stored row back is sound.
 */

import type { Entry } from "../actor/journal.ts";
import { assertNever } from "../domain/assertNever.ts";
import { effectFromLabel } from "../domain/effect.ts";
import { ticketAt } from "../domain/ticketGraph.ts";
import type {
  TicketGraph,
  Phase,
  Task,
  TaskIdentity,
  Ticket,
} from "../domain/generated/modelTypes.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import {
  taskIdentityEquals,
  taskPositionInSet,
  tasksInEvaluatorKeyOrder,
} from "../domain/task.ts";
import { reducibleEvalIn, reducibleWorkIn } from "../domain/enablement.ts";
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
} from "./projectDecision.ts";

function identity(entry: Entry, effectPosition: number, kind: string): string {
  return `${String(entry.seq)}:${String(effectPosition)}:${kind}`;
}

function subject(entry: Entry, effectPosition: number): TicketId {
  const transition = entry.rec.transitions[effectPosition];
  if (transition === undefined) {
    throw new Error(
      `decision plan: effect ${String(effectPosition)} has no transition`,
    );
  }
  return asTicketId(transition.ticket);
}

function outstanding(tasks: ReadonlySet<Task>): readonly Task[] {
  return tasksInEvaluatorKeyOrder(tasks).filter(
    (task) => task.state === "Outstanding",
  );
}

/** Whether these tasks already hold the named identity. */
function named(tasks: readonly Task[], wanted: TaskIdentity): boolean {
  return tasks.some((task) => taskIdentityEquals(task.identity, wanted));
}

/**
 * How many tasks the ticket had spawned before the set it holds live now. The
 * ghost counter is the running total and a live set is the newest run of it,
 * so the difference is where that set's numbering starts.
 */
function spawnedBeforeLiveSet(ticket: Ticket): number {
  return ticket.spawned - ticket.tasks.size;
}

/**
 * THE WIRE'S NAME FOR EACH TASK, MINTED HERE AND NOWHERE ELSE, beside the
 * identity the machine knows it by: a set's numbers continue the ticket's
 * spawn count and a task takes its position in the whole set ordered by
 * evaluator key, so what a ticket hands out is injective and ascending over
 * its whole history, and a cancellation naming part of a set names it by the
 * numbers its spawn minted. Numbering by the evaluator key itself, or per
 * cycle or per generation, satisfies the identity and turns the repeat that
 * `execution_names_one_logical_task` catches into a silent no-op insert — a
 * stage keyed `{1, 3}` spends two of the count and would mint three.
 */
function requestTasks(
  spawnedBefore: number,
  set: ReadonlySet<Task>,
  tasks: readonly Task[],
): ExecutionRequestPlan["tasks"] {
  return tasks.map((task) => ({
    task: spawnedBefore + taskPositionInSet(set, task.identity),
    identity: task.identity,
  }));
}

/**
 * The bundle a spawn pins, carrying the evidence of the finalization that
 * caused it where one did. A cancellation authorizes no work, so it pins none.
 */
function executionRequestBundle(
  input: DecisionInput,
  entry: Entry,
  effectPosition: number,
  source: ExecutionSourceObservation | undefined,
): ExecutionRequestBundle {
  const evidence =
    input.source.kind === "Operation" &&
    entry.event.type === "FinalizationResult" &&
    entry.event.value.out === "FinalizationNeedsWork"
      ? input.source.finalizationRequest?.evidence
      : undefined;
  return {
    bundle: identity(entry, effectPosition, inputBundleIdentityKind),
    ...(evidence === undefined ? {} : { evidence }),
    ...(source === undefined
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

function executionRequest(
  input: DecisionInput,
  entry: Entry,
  effectPosition: number,
  pre: TicketGraph,
  post: TicketGraph,
  source: ExecutionSourceObservation | undefined,
): ExecutionRequestPlan {
  const ticket = subject(entry, effectPosition);
  const effect = effectFromLabel(entry.rec.effects[effectPosition] ?? "");
  const before = pre.tickets.get(ticket);
  const after = post.tickets.get(ticket);
  if (after === undefined)
    throw new Error("decision plan: effect has no post ticket");
  switch (effect) {
    case "SpawnWorkTasks":
    case "SpawnEvalTasks": {
      const held = before === undefined ? [] : [...before.tasks];
      const created = outstanding(after.tasks).filter(
        (task) => !named(held, task.identity),
      );
      const kind =
        effect === "SpawnWorkTasks" ? "SpawnWork" : "SpawnEvaluation";
      if (created.length === 0)
        throw new Error(`decision plan: ${effect} created no tasks`);
      return {
        request: identity(entry, effectPosition, kind),
        effectPosition,
        ticket,
        ticketVersion: entry.seq,
        kind,
        bundle: executionRequestBundle(input, entry, effectPosition, source),
        tasks: requestTasks(spawnedBeforeLiveSet(after), after.tasks, created),
      };
    }
    case "CancelTicketWork": {
      const stillOutstanding = outstanding(after.tasks);
      const retired =
        before === undefined
          ? []
          : outstanding(before.tasks).filter(
              (task) => !named(stillOutstanding, task.identity),
            );
      return {
        request: identity(entry, effectPosition, effect),
        effectPosition,
        ticket,
        ticketVersion: entry.seq,
        kind: "CancelTicketWork",
        tasks:
          before === undefined
            ? []
            : requestTasks(spawnedBeforeLiveSet(before), before.tasks, retired),
      };
    }
    case "RunFinalizer":
    case "OpenHumanTask":
      throw new Error(`decision plan: ${effect} is not an execution request`);
  }
}

function nativeAction(
  entry: Entry,
  effectPosition: number,
  post: TicketGraph,
): NativeActionPlan {
  const ticket = subject(entry, effectPosition);
  const value = ticketAt(post, ticket);
  if (value.phase !== "Escalated") {
    throw new Error(
      "decision plan: a native action requires an escalated ticket",
    );
  }
  return {
    action: identity(entry, effectPosition, "TicketEscalation"),
    effectPosition,
    ticket,
    version: entry.seq,
    kind: "TicketEscalation",
    escalation: value.escalation,
    capability: "ResolveTicket",
    resolutions: ["Resume", "Revoke"],
  };
}

function effectPlans(
  input: DecisionInput,
  entry: Entry,
  pre: TicketGraph,
  post: TicketGraph,
  source: ExecutionSourceObservation | undefined,
): {
  readonly execution: readonly ExecutionRequestPlan[];
  readonly actions: readonly NativeActionPlan[];
  readonly finalization: DecisionMaterialization["finalization"];
} {
  const execution: ExecutionRequestPlan[] = [];
  const actions: NativeActionPlan[] = [];
  const finalization: Array<DecisionMaterialization["finalization"][number]> =
    [];
  entry.rec.effects.forEach((label, effectPosition) => {
    const effect = effectFromLabel(label);
    switch (effect) {
      case "SpawnWorkTasks":
      case "SpawnEvalTasks":
      case "CancelTicketWork":
        execution.push(
          executionRequest(input, entry, effectPosition, pre, post, source),
        );
        break;
      case "OpenHumanTask":
        actions.push(nativeAction(entry, effectPosition, post));
        break;
      case "RunFinalizer": {
        const ticket = subject(entry, effectPosition);
        if (
          pre.tickets.get(ticket)?.phase === "Finalization" ||
          ticketAt(post, ticket).phase !== "Finalization"
        ) {
          throw new Error(
            `decision plan: ${effect} does not enter Finalization`,
          );
        }
        finalization.push({
          request: identity(entry, effectPosition, effect),
          effectPosition,
          ticket,
          ticketVersion: entry.seq,
          requestGeneration: entry.seq,
          kind: effect,
        });
        break;
      }
      default:
        assertNever(effect);
    }
  });
  return { execution, actions, finalization };
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
  if (
    input.source.kind === "Operation" &&
    input.source.nativeAction !== undefined
  )
    return [];
  const moved = new Set(
    entry.rec.transitions.map((transition) => transition.ticket),
  );
  return [...moved].map(asTicketId).filter((ticket) => {
    const before = pre.tickets.get(ticket);
    const after = post.tickets.get(ticket);
    return (
      before !== undefined &&
      after !== undefined &&
      materializationActionablePhases.includes(before.phase) &&
      after.phase !== before.phase
    );
  });
}

/** Derives every durable consequence of one pure ticket decision. */
export function materializationOf(
  input: DecisionInput,
  pre: TicketGraph,
  post: TicketGraph,
  entry: Entry,
  source?: ExecutionSourceObservation,
): DecisionMaterialization {
  const effects = effectPlans(input, entry, pre, post, source);

  const eventTicket =
    entry.event.type === "TaskDone"
      ? asTicketId(entry.event.value.ticket)
      : undefined;
  const continuation =
    eventTicket !== undefined && reducibleWorkIn(post).includes(eventTicket)
      ? {
          continuation: identity(entry, entry.rec.effects.length, "ReduceWork"),
          kind: "ReduceWork" as const,
          ticket: eventTicket,
          expectedTicketVersion: entry.seq,
          expectedPhase: ticketAt(post, eventTicket).phase,
          taskSetGeneration: ticketAt(post, eventTicket).spawned,
        }
      : eventTicket !== undefined && reducibleEvalIn(post).includes(eventTicket)
        ? {
            continuation: identity(
              entry,
              entry.rec.effects.length,
              "ReduceEvaluation",
            ),
            kind: "ReduceEvaluation" as const,
            ticket: eventTicket,
            expectedTicketVersion: entry.seq,
            expectedPhase: ticketAt(post, eventTicket).phase,
            taskSetGeneration: ticketAt(post, eventTicket).spawned,
          }
        : undefined;

  return {
    ...(continuation === undefined ? {} : { continuation }),
    ...effects,
    fulfillFinalizationFor:
      entry.event.type === "FinalizationResult"
        ? [asTicketId(entry.event.value.ticket)]
        : [],
    withdrawActionsFor: materializationWithdrawals(input, entry, pre, post),
    ...(input.source.kind === "Operation" &&
    input.source.nativeAction !== undefined
      ? { resolveAction: input.source.nativeAction }
      : {}),
  };
}
