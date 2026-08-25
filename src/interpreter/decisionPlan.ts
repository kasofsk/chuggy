import type { Entry } from "../actor/journal.ts";
import { assertNever } from "../domain/assertNever.ts";
import { effectFromLabel } from "../domain/effect.ts";
import { ticketAt } from "../domain/core.ts";
import type { Core, Phase, Task } from "../domain/generated/modelTypes.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import { tasksInIdOrder } from "../domain/task.ts";
import { reducibleEvalIn, reducibleWorkIn } from "../domain/enablement.ts";
import type { DecisionInput } from "./projectDiscovery.ts";
import type { ExecutionSourceObservation } from "./projectWriter.ts";
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
  return tasksInIdOrder(tasks).filter((task) => task.state === "Outstanding");
}

function requestTasks(tasks: readonly Task[]): ExecutionRequestPlan["tasks"] {
  return tasks.map((task) =>
    task.kind === "Work"
      ? { task: task.id, kind: "Work" as const }
      : { task: task.id, kind: "Evaluation" as const, stage: task.kind.value },
  );
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
    entry.event.value.out === "FinalizationFailed"
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
            targetRef: source.target.ref,
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
  pre: Core,
  post: Core,
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
      const beforeIds = new Set(
        before === undefined
          ? []
          : tasksInIdOrder(before.tasks).map((task) => task.id),
      );
      const created = outstanding(after.tasks).filter(
        (task) => !beforeIds.has(task.id),
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
        tasks: requestTasks(created),
      };
    }
    case "CancelTicketWork": {
      const afterOutstanding = new Set(
        outstanding(after.tasks).map((task) => task.id),
      );
      const retired =
        before === undefined
          ? []
          : outstanding(before.tasks).filter(
              (task) => !afterOutstanding.has(task.id),
            );
      return {
        request: identity(entry, effectPosition, effect),
        effectPosition,
        ticket,
        ticketVersion: entry.seq,
        kind: "CancelTicketWork",
        tasks: requestTasks(retired),
      };
    }
    case "RunFinalizer":
    case "PublishHandoff":
    case "OpenHumanTask":
      throw new Error(`decision plan: ${effect} is not an execution request`);
  }
}

function nativeAction(
  entry: Entry,
  effectPosition: number,
  post: Core,
): NativeActionPlan {
  const ticket = subject(entry, effectPosition);
  const value = ticketAt(post, ticket);
  if (value.phase !== "Escalated" && value.phase !== "HandoffBlocked") {
    throw new Error(
      "decision plan: a native action requires an escalated ticket",
    );
  }
  if (value.phase === "HandoffBlocked") {
    return {
      action: identity(entry, effectPosition, "HandoffBlock"),
      effectPosition,
      ticket,
      version: entry.seq,
      kind: "HandoffBlock",
      reason: "NoReason",
      capability: "ResolveTicket",
      resolutions: ["RetryHandoff", "AbandonHandoff"],
    };
  }
  const resolutions =
    value.reason === "DependencyRevoked" || value.resumeAt === "NoResume"
      ? ["Revoke" as const]
      : ["Resume" as const, "Revoke" as const];
  return {
    action: identity(entry, effectPosition, "TicketEscalation"),
    effectPosition,
    ticket,
    version: entry.seq,
    kind: "TicketEscalation",
    reason: value.reason,
    capability: "ResolveTicket",
    resolutions,
  };
}

function effectPlans(
  input: DecisionInput,
  entry: Entry,
  pre: Core,
  post: Core,
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
      case "RunFinalizer":
      case "PublishHandoff": {
        const ticket = subject(entry, effectPosition);
        const expectedPhase =
          effect === "RunFinalizer" ? "Finalizing" : "PublishingHandoff";
        if (
          pre.tickets.get(ticket)?.phase === expectedPhase ||
          ticketAt(post, ticket).phase !== expectedPhase
        ) {
          throw new Error(
            `decision plan: ${effect} does not enter ${expectedPhase}`,
          );
        }
        finalization.push({
          request: identity(entry, effectPosition, effect),
          effectPosition,
          ticket,
          ticketVersion: entry.seq,
          requestGeneration: entry.seq,
          kind: effect,
          ...(effect === "PublishHandoff" &&
          input.source.kind === "Operation" &&
          input.source.finalizationRequest?.acceptedPromotion !== undefined
            ? {
                acceptedPromotion:
                  input.source.finalizationRequest.acceptedPromotion,
              }
            : {}),
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
 * task, `Finalizing` carries the finalization approval. `native_action` admits
 * one open row per ticket, so a ticket leaving either phase must take its
 * question with it or the next one cannot be opened at all.
 */
const materializationActionablePhases: readonly Phase[] = [
  "Escalated",
  "Finalizing",
  "PublishingHandoff",
  "HandoffBlocked",
];

/**
 * The tickets whose open action this decision leaves standing on a question
 * nobody is being asked any more. An answer withdraws nothing, because the
 * resolution it carries is the same row's own fence.
 */
function materializationWithdrawals(
  input: DecisionInput,
  entry: Entry,
  pre: Core,
  post: Core,
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
  pre: Core,
  post: Core,
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
