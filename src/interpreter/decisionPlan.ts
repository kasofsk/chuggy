import type { Entry } from "../actor/journal.ts";
import { assertNever } from "../domain/assertNever.ts";
import { effectFromLabel } from "../domain/effect.ts";
import { ticketAt } from "../domain/core.ts";
import type { Core, Task } from "../domain/generated/modelTypes.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import { tasksInIdOrder } from "../domain/task.ts";
import { reducibleEvalIn, reducibleWorkIn } from "../domain/enablement.ts";
import type { DecisionInput } from "./projectDiscovery.ts";
import type {
  DecisionMaterialization,
  ExecutionRequestPlan,
  NativeActionPlan,
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

function executionRequest(
  entry: Entry,
  effectPosition: number,
  pre: Core,
  post: Core,
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
  if (value.phase !== "Escalated") {
    throw new Error(
      "decision plan: a native action requires an escalated ticket",
    );
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
  entry: Entry,
  pre: Core,
  post: Core,
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
        execution.push(executionRequest(entry, effectPosition, pre, post));
        break;
      case "OpenHumanTask":
        actions.push(nativeAction(entry, effectPosition, post));
        break;
      case "RunFinalizer": {
        const ticket = subject(entry, effectPosition);
        if (
          pre.tickets.get(ticket)?.phase === "Finalizing" ||
          ticketAt(post, ticket).phase !== "Finalizing"
        ) {
          throw new Error(
            "decision plan: finalizer effect does not enter Finalizing",
          );
        }
        finalization.push({
          request: identity(entry, effectPosition, effect),
          effectPosition,
          ticket,
          ticketVersion: entry.seq,
          requestGeneration: entry.seq,
        });
        break;
      }
      default:
        assertNever(effect);
    }
  });
  return { execution, actions, finalization };
}

/** Derives every durable consequence of one pure ticket decision. */
export function materializationOf(
  input: DecisionInput,
  pre: Core,
  post: Core,
  entry: Entry,
): DecisionMaterialization {
  const effects = effectPlans(entry, pre, post);

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
    ...(input.source.kind === "Operation" &&
    input.source.nativeAction !== undefined
      ? { resolveAction: input.source.nativeAction }
      : {}),
  };
}
