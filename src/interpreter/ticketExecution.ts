import * as task from "../domain/chuggernaut/task.js";
import * as ticket from "../domain/chuggernaut/ticket.js";
import { setTimeout as delay } from "node:timers/promises";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { TicketContentStore } from "./ticketCatalog.ts";
import { ticketWorkspaceRead } from "./ticketWorkspace.ts";
import {
  ticketMachineTaskKey,
  type TicketMachineAuthorization,
  type TicketMachineEffects,
  type TicketMachineInput,
} from "./ticketMachine.ts";

export interface TicketExecutionClaim {
  readonly partition: Partition;
  readonly identity: string;
  readonly taskKey: string;
  readonly obligation: task.TaskObligation;
  readonly attempt: number;
  readonly recoveryEpoch: RecoveryEpoch;
}

export interface TicketExecutionStore {
  execute(
    partition: Partition,
    identity: string,
    taskKey: string,
    obligation: task.TaskObligation,
  ): Promise<boolean>;
  cancel(
    partition: Partition,
    identity: string,
    taskKey: string,
  ): Promise<boolean>;
  claim(
    owner: string,
    recoveryEpoch: RecoveryEpoch,
    leaseSecs: number,
    limit: number,
  ): Promise<readonly TicketExecutionClaim[]>;
  retry(claim: TicketExecutionClaim, retryAfterSecs: number): Promise<void>;
  terminal(
    claim: TicketExecutionClaim,
    input: TicketMachineInput,
  ): Promise<boolean>;
  cancelled(claim: TicketExecutionClaim): Promise<boolean>;
}

/**
 * What the fabric answers with, which is no longer a `TaskTerminal`.
 *
 * THE DOMAIN NOW ASKS THE FABRIC TO CLASSIFY ITS OWN RESULT. A work result
 * must name the source the machine is to accept, and an evaluator result must
 * carry a verdict, because the domain reads neither out of a manifest any
 * more. Both are the runner's to decide, so the runner hands back the report
 * it decided rather than a terminal the machine would have to decode.
 */
export type TicketExecutionResult =
  | {
      readonly result: "Produced";
      readonly report: ticket.WorkResultReport | ticket.EvaluationResultReport;
    }
  | {
      readonly result: "ProcessFailed";
      readonly failure: task.TaskFailure;
    }
  | {
      readonly result: "ExecutionUnavailable";
      readonly evidence: task.ContentRef;
    }
  | {
      readonly result: "Retry";
      readonly retryAfterSecs: number;
      readonly evidence: task.ContentRef;
    };

export interface TicketExecutionRunner {
  run(
    claim: TicketExecutionClaim,
    view: TicketExecutionView,
  ): Promise<TicketExecutionResult>;
  cancel(claim: TicketExecutionClaim): Promise<void>;
}

export type TicketExecutionAccess =
  "ReadRepository" | "PublishRepositoryResult";

export interface TicketExecutionView {
  readonly workload: unknown;
  readonly inputs: unknown;
  readonly resultContract: unknown;
  readonly repository: string;
  readonly commit: string;
  readonly source: task.ContentRef;
  readonly access: TicketExecutionAccess;
  readonly requiredCapabilities: readonly string[];
  readonly context: readonly {
    readonly reference: task.ContentRef;
    readonly value: unknown;
  }[];
}

export type TicketExecutionContent = (
  partition: Partition,
) => TicketContentStore;

/** Answers the graph a claimed obligation belongs to, or nothing for a project the machine does not drive. */
export type TicketExecutionTickets = (
  partition: Partition,
) => Promise<ticket.TicketGraph | undefined>;

export function ticketExecutionResultRef(commit: string): string {
  if (!/^[0-9a-f]{40}$/u.test(commit))
    throw new TypeError(
      "ticket execution result commit is not lowercase SHA-1",
    );
  return `refs/chuggy/results/${commit}`;
}

function ticketExecutionJson(content: string, what: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`ticket execution ${what} is not JSON`);
  }
}

async function ticketExecutionContent(
  content: TicketContentStore,
  reference: task.ContentRef,
  what: string,
): Promise<{ readonly mediaType: string; readonly content: string }> {
  const found = await content.read(reference);
  if (found === undefined)
    throw new Error(`ticket execution ${what} is missing`);
  return found;
}

/**
 * The source and context material a claimed obligation runs against.
 *
 * THE OBLIGATION NO LONGER CARRIES EITHER. v0.4.0 reduced it to a task, its
 * definition and a context reference naming the work cycle, so what a worker
 * needs is read back out of the ticket the obligation belongs to. That is
 * where it has always been true: the machine holds the source it dispatched
 * and the input it entered the cycle with, and an obligation whose ticket has
 * moved on is one whose terminal the machine would refuse anyway.
 */
export interface TicketExecutionMaterial {
  readonly source: task.ContentRef;
  readonly context: readonly task.ContentRef[];
}

function ticketExecutionWorkContext(
  input: ticket.WorkInput,
): readonly task.ContentRef[] {
  const cause = input.cause;
  return [
    input.released.content,
    input.released.input_bindings,
    ...(cause instanceof ticket.InitialWork
      ? []
      : cause instanceof ticket.EvaluationRework
        ? cause.entries.map((entry) => entry.result_ref)
        : [cause.evidence]),
    ...input.retry_evidence,
  ];
}

export function ticketExecutionMaterial(
  graph: ticket.TicketGraph,
  obligation: task.TaskObligation,
): TicketExecutionMaterial {
  const state = graph.tickets.get(task.task_owner(obligation.task))?.state;
  if (obligation.task instanceof task.WorkTaskId) {
    if (!(state instanceof ticket.Work))
      throw new Error("ticket execution work obligation is not current");
    return {
      source: state.execution.source,
      context: ticketExecutionWorkContext(state.execution.input),
    };
  }
  if (!(state instanceof ticket.Evaluation))
    throw new Error("ticket execution evaluation obligation is not current");
  return {
    source: state.evaluation.input.accepted_source_ref,
    context: [state.evaluation.input.work_result],
  };
}

/** A work task publishes unless its workload declines; an evaluator never does. */
function ticketExecutionAccess(
  held: task.TaskId,
  workload: unknown,
): TicketExecutionAccess {
  const declared =
    workload !== null && typeof workload === "object"
      ? (workload as Record<string, unknown>)["publishes_repository_result"]
      : undefined;
  return held instanceof task.WorkTaskId && declared !== false
    ? "PublishRepositoryResult"
    : "ReadRepository";
}

export async function ticketExecutionView(
  content: TicketContentStore,
  graph: ticket.TicketGraph,
  obligation: task.TaskObligation,
): Promise<TicketExecutionView> {
  const definition = obligation.definition;
  const material = ticketExecutionMaterial(graph, obligation);
  const workspace = await ticketWorkspaceRead(content, material.source);
  const references = await Promise.all([
    ticketExecutionContent(content, definition.workload, "workload"),
    ticketExecutionContent(content, definition.inputs, "inputs"),
    ticketExecutionContent(
      content,
      definition.result_contract,
      "result contract",
    ),
    ...material.context.map((reference) =>
      ticketExecutionContent(content, reference, "context"),
    ),
  ]);
  const [workload, inputs, resultContract, ...contexts] = references;
  if (
    workload === undefined ||
    inputs === undefined ||
    resultContract === undefined
  )
    throw new Error("ticket execution view is incomplete");
  const declaration = ticketExecutionJson(workload.content, "workload");
  return {
    workload: declaration,
    inputs: ticketExecutionJson(inputs.content, "inputs"),
    resultContract: ticketExecutionJson(
      resultContract.content,
      "result contract",
    ),
    repository: workspace.repository,
    commit: workspace.commit,
    source: material.source,
    access: ticketExecutionAccess(obligation.task, declaration),
    requiredCapabilities:
      definition.execution_requirements.required_capabilities,
    context: material.context.map((reference, index) => {
      const context = contexts[index];
      if (context === undefined)
        throw new Error("ticket execution context is incomplete");
      return {
        reference,
        value:
          context.mediaType === "application/json"
            ? ticketExecutionJson(context.content, "context")
            : context.content,
      };
    }),
  };
}

export function ticketExecutionEffects(
  store: TicketExecutionStore,
): Pick<TicketMachineEffects, "execute" | "cancel"> {
  return {
    execute: (partition, identity, effect) =>
      store.execute(
        partition,
        identity,
        ticketMachineTaskKey(effect.task.task),
        effect.task,
      ),
    cancel: (partition, identity, effect) =>
      store.cancel(partition, identity, ticketMachineTaskKey(effect.task)),
  };
}

function ticketExecutionReport(
  claim: TicketExecutionClaim,
  result: TicketExecutionResult,
): ticket.TaskTerminalReport {
  if (result.result === "Produced") return result.report;
  return new ticket.TerminalFailureReport(
    task.task_owner(claim.obligation.task),
    result.result === "ProcessFailed"
      ? result.failure
      : new task.TaskFailure(claim.obligation.task, result.evidence),
    result.result === "ProcessFailed"
      ? new ticket.ProcessFailure()
      : new ticket.ExecutionUnavailableFailure(),
  );
}

async function ticketExecutionCancelled(
  store: TicketExecutionStore,
  runner: TicketExecutionRunner,
  claim: TicketExecutionClaim,
  running: Promise<TicketExecutionResult>,
  cancellationPollMs: number,
): Promise<boolean> {
  let cancelled = await store.cancelled(claim);
  while (!cancelled) {
    const observed = await Promise.race([
      running.then(() => "Terminal" as const),
      delay(cancellationPollMs, "Poll" as const),
    ]);
    if (observed === "Terminal") return false;
    cancelled = await store.cancelled(claim);
  }
  await runner.cancel(claim);
  await running;
  return true;
}

export async function ticketExecutionRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  tickets: TicketExecutionTickets,
  runner: TicketExecutionRunner,
  owner: string,
  recoveryEpoch: RecoveryEpoch,
  authorization: TicketMachineAuthorization,
  leaseSecs: number,
  attemptsMax: number,
  limit: number,
  cancellationPollMs = 1_000,
): Promise<number> {
  if (
    ![leaseSecs, attemptsMax, limit, cancellationPollMs].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new RangeError(
      "ticket execution bounds must be positive safe integers",
    );
  const claims = await store.claim(owner, recoveryEpoch, leaseSecs, limit);
  if (claims.length > limit)
    throw new Error("ticket execution store exceeded claim limit");
  const completed = await Promise.all(
    claims.map((claim) =>
      ticketExecutionClaimRun(
        store,
        content,
        tickets,
        runner,
        claim,
        authorization,
        attemptsMax,
        cancellationPollMs,
      ),
    ),
  );
  return completed.reduce((total, value) => total + value, 0);
}

async function ticketExecutionClaimRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  tickets: TicketExecutionTickets,
  runner: TicketExecutionRunner,
  claim: TicketExecutionClaim,
  authorization: TicketMachineAuthorization,
  attemptsMax: number,
  cancellationPollMs: number,
): Promise<number> {
  const graph = await tickets(claim.partition);
  if (graph === undefined)
    throw new Error("ticket execution claim has no ticket machine");
  const running = runner.run(
    claim,
    await ticketExecutionView(
      content(claim.partition),
      graph,
      claim.obligation,
    ),
  );
  if (
    await ticketExecutionCancelled(
      store,
      runner,
      claim,
      running,
      cancellationPollMs,
    )
  )
    return 0;
  const result = await running;
  if (result.result === "Retry" && claim.attempt < attemptsMax) {
    await store.retry(claim, result.retryAfterSecs);
    return 0;
  }
  const submitted = await store.terminal(claim, {
    identity: `execution-terminal:${claim.taskKey}`,
    origin: "Execution",
    authorization,
    command: new ticket.ReportTaskTerminal(
      ticketExecutionReport(claim, result),
    ),
  });
  return submitted ? 1 : 0;
}
