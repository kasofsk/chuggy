/**
 * The ports a claimed ticket task is run and reported through, and the view a
 * runner is handed.
 *
 * AN OBLIGATION CARRIES NEITHER SOURCE NOR CONTEXT any more: the domain
 * reduced it to a task, its definition and a context reference naming the work
 * cycle. So both are read back out of the ticket the obligation belongs to,
 * which is where they were always true — the machine holds the source it
 * dispatched and the input it entered the cycle with. An obligation whose
 * ticket has moved on resolves nothing rather than running against material
 * the machine left behind, and its terminal is one the machine would refuse.
 *
 * A RESULT IS CLASSIFIED BY WHOEVER PRODUCED IT. A work result must name the
 * source the machine is to accept and an evaluator result must carry a
 * verdict, because the domain reads neither out of a manifest, so the runner
 * hands back the report it decided.
 */
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
  /**
   * The queued work this claimant may run, which is the work whose required
   * capabilities its own set covers. Matching before the claim rather than
   * after it is what stops two claimants of different capabilities racing for
   * every row and the wrong one spending an attempt to report it unavailable.
   */
  claim(
    owner: string,
    recoveryEpoch: RecoveryEpoch,
    leaseSecs: number,
    limit: number,
    capabilities: readonly string[],
  ): Promise<readonly TicketExecutionClaim[]>;
  /**
   * Queued work older than its window that no claimant ever took, claimed by
   * the caller so it can be settled. Under claiming this is the one shape that
   * would otherwise wait forever, looking exactly like work whose turn has not
   * come.
   */
  unclaimable(
    owner: string,
    recoveryEpoch: RecoveryEpoch,
    leaseSecs: number,
    limit: number,
    windowSecs: number,
  ): Promise<readonly TicketExecutionClaim[]>;
  retry(claim: TicketExecutionClaim, retryAfterSecs: number): Promise<void>;
  terminal(
    claim: TicketExecutionClaim,
    input: TicketMachineInput,
  ): Promise<boolean>;
  cancelled(claim: TicketExecutionClaim): Promise<boolean>;
}

/** What the fabric answers with, which is a report rather than a `TaskTerminal`. */
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

/** The source and context material a claimed obligation runs against. */
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

/**
 * Settles the work that waited out its window with no claimant, as
 * `ExecutionUnavailable` against evidence naming what it asked for.
 *
 * Placement gets one answer for free — a backend offered work that it cannot
 * place says so — whereas nothing claiming a row is silence, and work merely
 * waiting its turn sounds exactly the same, so the window is what turns a
 * requirement no claimant covers into a fact the ticket carries.
 */
export async function ticketExecutionUnclaimableRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  owner: string,
  recoveryEpoch: RecoveryEpoch,
  authorization: TicketMachineAuthorization,
  leaseSecs: number,
  limit: number,
  windowSecs: number,
): Promise<number> {
  if (
    ![leaseSecs, limit, windowSecs].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new RangeError(
      "ticket execution unclaimable bounds must be positive safe integers",
    );
  const claims = await store.unclaimable(
    owner,
    recoveryEpoch,
    leaseSecs,
    limit,
    windowSecs,
  );
  if (claims.length > limit)
    throw new Error("ticket execution store exceeded claim limit");
  const settled = await Promise.all(
    claims.map(async (claim) => {
      const evidence = await content(claim.partition).put(
        "application/json",
        ticketExecutionUnclaimableEvidence(claim, windowSecs),
      );
      const submitted = await store.terminal(claim, {
        identity: `execution-terminal:${claim.taskKey}`,
        origin: "Execution",
        authorization,
        command: new ticket.ReportTaskTerminal(
          ticketExecutionReport(claim, {
            result: "ExecutionUnavailable",
            evidence,
          }),
        ),
      });
      return submitted ? 1 : 0;
    }),
  );
  return settled.reduce<number>((total, value) => total + value, 0);
}

/** What the ticket is told: what the work asked for, and how long nothing offering it appeared. */
function ticketExecutionUnclaimableEvidence(
  claim: TicketExecutionClaim,
  windowSecs: number,
): string {
  return JSON.stringify({
    reason: "no claimant covering the required capabilities appeared in time",
    taskKey: claim.taskKey,
    requiredCapabilities: [
      ...claim.obligation.definition.execution_requirements
        .required_capabilities,
    ],
    windowSecs,
  });
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
  capabilities: readonly string[],
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
  const claims = await store.claim(
    owner,
    recoveryEpoch,
    leaseSecs,
    limit,
    capabilities,
  );
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
