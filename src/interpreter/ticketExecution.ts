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
 * A RUNNER PLACES WORK AND DECIDES NOTHING. A work result must name the source
 * the machine is to accept and an evaluator result must carry a verdict,
 * because the domain reads neither out of a manifest; but that reading is one
 * protocol above every backend, in `ticketExecutionOutcome.ts`, so a placement
 * backend hands back the harness's own wire outcome and never a report.
 */
import * as task from "../domain/chuggernaut/task.js";
import * as ticket from "../domain/chuggernaut/ticket.js";
import { setTimeout as delay } from "node:timers/promises";
import type { RepositoryId } from "./finalizer.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { TicketContentStore } from "./ticketCatalog.ts";
import { ticketWorkspaceRead } from "./ticketWorkspace.ts";
import {
  ticketExecutionOutcomeReport,
  type TicketExecutionAccess,
} from "./ticketExecutionOutcome.ts";
import {
  ticketMachineTaskKey,
  type TicketMachineAuthorization,
  type TicketMachineEffects,
  type TicketMachineInput,
} from "./ticketMachine.ts";

/**
 * The bound two tiers must agree on, defaulted here so they agree by
 * construction. The scheduler sweeps work that reached it and the plane
 * serving pools stops claiming there; a deployment that moves one moves both,
 * by naming each.
 */
export const ticketExecutionDefaults = { attemptsUnreportedMax: 3 } as const;

export interface TicketExecutionClaim {
  readonly partition: Partition;
  readonly identity: string;
  readonly taskKey: string;
  readonly obligation: task.TaskObligation;
  readonly attempt: number;
  readonly recoveryEpoch: RecoveryEpoch;
}

/** One queued row as the preparation pass needs it, which is its obligation and where it lives. */
export interface TicketExecutionQueued {
  readonly partition: Partition;
  readonly taskKey: string;
  readonly obligation: task.TaskObligation;
}

/** One pool-held attempt awaiting its terminal, and the one thing it has to say. */
export interface TicketExecutionSettlement {
  readonly claim: TicketExecutionClaim;
  readonly outcome?: unknown;
  readonly refusal?: string;
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
    attemptsUnreportedMax: number,
  ): Promise<readonly TicketExecutionClaim[]>;
  /**
   * The work whose attempts kept ending without a word, claimed by the caller
   * so it can be settled. A claim spent on work no fabric can ever run says
   * nothing where a busy fabric releases the row and an unwilling one records
   * its refusal, so the silence is what is counted and the ceiling on it is
   * what every claim predicate stops at.
   */
  unreported(
    owner: string,
    recoveryEpoch: RecoveryEpoch,
    leaseSecs: number,
    limit: number,
    attemptsUnreportedMax: number,
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
  /**
   * Queued work whose harness view has not been resolved yet, which is the work
   * a pool could otherwise be handed nothing for. It is read rather than
   * claimed, because resolving a view spends no attempt and changes no state a
   * claimant would see.
   */
  unprepared(limit: number): Promise<readonly TicketExecutionQueued[]>;
  prepare(
    partition: Partition,
    taskKey: string,
    view: TicketExecutionView,
  ): Promise<boolean>;
  /**
   * The pool-held attempts that have something to settle: a harness outcome
   * recorded through the worker plane, or the pool's own settled no. Nothing
   * orchestrator-side is waiting on either, so a pass is what picks them up.
   */
  settlements(limit: number): Promise<readonly TicketExecutionSettlement[]>;
  retry(claim: TicketExecutionClaim, retryAfterSecs: number): Promise<void>;
  terminal(
    claim: TicketExecutionClaim,
    input: TicketMachineInput,
  ): Promise<boolean>;
  cancelled(claim: TicketExecutionClaim): Promise<boolean>;
}

/**
 * What a placement backend answers with, which names no domain value at all: it
 * placed the work and the harness reported through the plane, or it could not,
 * and its evidence is the plain text a backend can write without reading the
 * machine's language.
 */
export type TicketExecutionPlacement =
  | {
      readonly placed: "Reported";
      readonly outcome: unknown;
    }
  | {
      readonly placed: "Unavailable";
      readonly evidence: string;
    }
  | {
      readonly placed: "Retry";
      readonly retryAfterSecs: number;
      readonly evidence: string;
    };

export interface TicketExecutionRunner {
  run(
    claim: TicketExecutionClaim,
    view: TicketExecutionView,
  ): Promise<TicketExecutionPlacement>;
  cancel(claim: TicketExecutionClaim): Promise<void>;
}

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

export type { TicketExecutionAccess };

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

/**
 * What a harness is served over its callback, which is the resolved view with
 * the machine's own source reference left out: a harness names a source it
 * never reads, and a reference this project's content store keys on is nothing
 * a pool beyond this cluster is entitled to.
 */
export interface TicketExecutionWorkerView {
  readonly workload: unknown;
  readonly inputs: unknown;
  readonly resultContract: unknown;
  readonly requiredCapabilities: readonly string[];
  readonly context: readonly {
    readonly reference: task.ContentRef;
    readonly value: unknown;
  }[];
  readonly repository: string;
  readonly commit: string;
  readonly access: TicketExecutionAccess;
}

/**
 * Whom one attempt's git credential is minted for, read off the attempt's own
 * row rather than out of the request asking. The access is the scheduler's
 * reading of the workload and was recorded before a harness existed, so a
 * harness that asked for a push it was not given is answered the read it was.
 */
export interface TicketExecutionCredentialSubject {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly access: TicketExecutionAccess;
}

export function ticketExecutionWorkerView(
  view: TicketExecutionView,
): TicketExecutionWorkerView {
  return {
    workload: view.workload,
    inputs: view.inputs,
    resultContract: view.resultContract,
    requiredCapabilities: view.requiredCapabilities,
    context: view.context,
    repository: view.repository,
    commit: view.commit,
    access: view.access,
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

/** What a ticket is told about an attempt no backend could carry to a harness. */
function ticketExecutionUnavailableReport(
  claim: TicketExecutionClaim,
  evidence: task.ContentRef,
): ticket.TerminalFailureReport {
  return new ticket.TerminalFailureReport(
    task.task_owner(claim.obligation.task),
    new task.TaskFailure(claim.obligation.task, evidence),
    new ticket.ExecutionUnavailableFailure(),
  );
}

async function ticketExecutionCancelled(
  store: TicketExecutionStore,
  runner: TicketExecutionRunner,
  claim: TicketExecutionClaim,
  running: Promise<TicketExecutionPlacement>,
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
 * Settles the claims a sweep took, each as `ExecutionUnavailable` against the
 * evidence it writes for it. What the two sweeps found differs and what the
 * ticket is owed for it does not, so only the evidence is theirs.
 */
async function ticketExecutionSweptRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  claims: readonly TicketExecutionClaim[],
  authorization: TicketMachineAuthorization,
  limit: number,
  evidenceOf: (claim: TicketExecutionClaim) => string,
): Promise<number> {
  if (claims.length > limit)
    throw new Error("ticket execution store exceeded claim limit");
  const settled = await Promise.all(
    claims.map(async (claim) => {
      const evidence = await content(claim.partition).put(
        "application/json",
        evidenceOf(claim),
      );
      const submitted = await store.terminal(claim, {
        identity: `execution-terminal:${claim.taskKey}`,
        origin: "Execution",
        authorization,
        command: new ticket.ReportTaskTerminal(
          ticketExecutionUnavailableReport(claim, evidence),
        ),
      });
      return submitted ? 1 : 0;
    }),
  );
  return settled.reduce<number>((total, value) => total + value, 0);
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
  return ticketExecutionSweptRun(
    store,
    content,
    await store.unclaimable(owner, recoveryEpoch, leaseSecs, limit, windowSecs),
    authorization,
    limit,
    (claim) => ticketExecutionUnclaimableEvidence(claim, windowSecs),
  );
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

/**
 * Settles the work whose claims kept ending in silence, which is the other way
 * work runs forever without ever becoming a fact: a busy or unwilling pool
 * answers the offer, whereas a workload a fabric accepted and no node can ever
 * schedule lets the lease run out and says nothing the ticket could carry.
 * The ceiling both claim predicates stop at is what ends the cycle, and this
 * pass is what the ticket hears instead.
 */
export async function ticketExecutionUnreportedRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  owner: string,
  recoveryEpoch: RecoveryEpoch,
  authorization: TicketMachineAuthorization,
  leaseSecs: number,
  limit: number,
  attemptsUnreportedMax: number,
): Promise<number> {
  if (
    ![leaseSecs, limit, attemptsUnreportedMax].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new RangeError(
      "ticket execution unreported bounds must be positive safe integers",
    );
  return ticketExecutionSweptRun(
    store,
    content,
    await store.unreported(
      owner,
      recoveryEpoch,
      leaseSecs,
      limit,
      attemptsUnreportedMax,
    ),
    authorization,
    limit,
    (claim) => ticketExecutionUnreportedEvidence(claim, attemptsUnreportedMax),
  );
}

/** What the ticket is told: what the work asked for, and how many claims of it said nothing. */
function ticketExecutionUnreportedEvidence(
  claim: TicketExecutionClaim,
  attemptsUnreportedMax: number,
): string {
  return JSON.stringify({
    reason: "every claim of this work expired without reporting an outcome",
    taskKey: claim.taskKey,
    requiredCapabilities: [
      ...claim.obligation.definition.execution_requirements
        .required_capabilities,
    ],
    attempts: claim.attempt,
    attemptsUnreportedMax,
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
  attemptsUnreportedMax: number,
  cancellationPollMs = 1_000,
): Promise<number> {
  if (
    ![
      leaseSecs,
      attemptsMax,
      limit,
      attemptsUnreportedMax,
      cancellationPollMs,
    ].every((value) => Number.isSafeInteger(value) && value > 0)
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
    attemptsUnreportedMax,
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
  const attemptContent = content(claim.partition);
  const view = await ticketExecutionView(
    attemptContent,
    graph,
    claim.obligation,
  );
  const running = runner.run(claim, view);
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
  const placement = await running;
  if (placement.placed === "Retry" && claim.attempt < attemptsMax) {
    await store.retry(claim, placement.retryAfterSecs);
    return 0;
  }
  const submitted = await store.terminal(claim, {
    identity: `execution-terminal:${claim.taskKey}`,
    origin: "Execution",
    authorization,
    command: new ticket.ReportTaskTerminal(
      placement.placed === "Reported"
        ? await ticketExecutionOutcomeReport(
            attemptContent,
            claim.obligation,
            view,
            placement.outcome,
          )
        : ticketExecutionUnavailableReport(
            claim,
            await attemptContent.put("text/plain", placement.evidence),
          ),
    ),
  });
  return submitted ? 1 : 0;
}

/**
 * Resolves the harness view of queued work before anything claims it, because
 * the view is the one thing an assignment needs that only the journal holds and
 * the plane serving pools must never read the journal. A row whose obligation
 * no longer matches its ticket is left unprepared rather than settled, the
 * unclaimed window being what turns work no claimant can take into evidence.
 */
export async function ticketExecutionPrepareRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  tickets: TicketExecutionTickets,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new RangeError("ticket execution prepare limit must be positive");
  const queued = await store.unprepared(limit);
  if (queued.length > limit)
    throw new Error("ticket execution store exceeded prepare limit");
  const prepared = await Promise.all(
    queued.map(async (row) => {
      const graph = await tickets(row.partition);
      if (graph === undefined) return 0;
      const view = await ticketExecutionPrepared(
        content(row.partition),
        graph,
        row.obligation,
      );
      return view !== undefined &&
        (await store.prepare(row.partition, row.taskKey, view))
        ? 1
        : 0;
    }),
  );
  return prepared.reduce<number>((total, value) => total + value, 0);
}

/** The view of one queued obligation, or nothing where its ticket has moved past it. */
async function ticketExecutionPrepared(
  content: TicketContentStore,
  graph: ticket.TicketGraph,
  obligation: task.TaskObligation,
): Promise<TicketExecutionView | undefined> {
  try {
    return await ticketExecutionView(content, graph, obligation);
  } catch {
    return undefined;
  }
}

/**
 * Settles the attempts a pool ran, which nothing orchestrator-side is waiting
 * on: the harness reported to the worker plane, which recorded the outcome and
 * returned, and the pool went back to polling. The same result protocol is
 * called here rather than inside the plane the harness reached, because
 * deriving a report there would widen that process to the whole ticket machine.
 */
export async function ticketExecutionSettlementRun(
  store: TicketExecutionStore,
  content: TicketExecutionContent,
  tickets: TicketExecutionTickets,
  authorization: TicketMachineAuthorization,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new RangeError("ticket execution settlement limit must be positive");
  const pending = await store.settlements(limit);
  if (pending.length > limit)
    throw new Error("ticket execution store exceeded settlement limit");
  const settled = await Promise.all(
    pending.map(async (settlement) => {
      const submitted = await store.terminal(settlement.claim, {
        identity: `execution-terminal:${settlement.claim.taskKey}`,
        origin: "Execution",
        authorization,
        command: new ticket.ReportTaskTerminal(
          await ticketExecutionSettled(content, tickets, settlement),
        ),
      });
      return submitted ? 1 : 0;
    }),
  );
  return settled.reduce<number>((total, value) => total + value, 0);
}

/** A pool's settled no is evidence; a harness outcome is the result protocol's to read. */
async function ticketExecutionSettled(
  content: TicketExecutionContent,
  tickets: TicketExecutionTickets,
  settlement: TicketExecutionSettlement,
): Promise<ticket.TaskTerminalReport> {
  const claim = settlement.claim;
  const attemptContent = content(claim.partition);
  if (settlement.refusal !== undefined)
    return ticketExecutionUnavailableReport(
      claim,
      await attemptContent.put("text/plain", settlement.refusal),
    );
  const graph = await tickets(claim.partition);
  if (graph === undefined)
    throw new Error("ticket execution settlement has no ticket machine");
  return ticketExecutionOutcomeReport(
    attemptContent,
    claim.obligation,
    await ticketExecutionView(attemptContent, graph, claim.obligation),
    settlement.outcome,
  );
}
