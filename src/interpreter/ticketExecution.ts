import * as task from "../domain/chuggernaut/task.js";
import * as ticket from "../domain/chuggernaut/ticket.js";
import { setTimeout as delay } from "node:timers/promises";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { TicketContentStore } from "./ticketCatalog.ts";
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

export type TicketExecutionResult =
  | { readonly result: "Produced"; readonly terminal: task.TaskResultProduced }
  | {
      readonly result: "ProcessFailed";
      readonly terminal: task.TaskProcessFailed;
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

export interface TicketExecutionView {
  readonly workload: unknown;
  readonly inputs: unknown;
  readonly resultContract: unknown;
  readonly repository: string;
  readonly commit: string;
  readonly access: task.GitAccess["kind"];
  readonly requiredCapabilities: readonly string[];
  readonly context: readonly {
    readonly reference: task.ContentRef;
    readonly value: unknown;
  }[];
}

export type TicketExecutionContent = (
  partition: Partition,
) => TicketContentStore;

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

export async function ticketExecutionView(
  content: TicketContentStore,
  obligation: task.TaskObligation,
): Promise<TicketExecutionView> {
  const definition = obligation.definition;
  const references = await Promise.all([
    ticketExecutionContent(content, definition.workload, "workload"),
    ticketExecutionContent(content, definition.inputs, "inputs"),
    ticketExecutionContent(
      content,
      definition.result_contract,
      "result contract",
    ),
    ticketExecutionContent(content, obligation.source.repository, "repository"),
    ticketExecutionContent(
      content,
      task.ContentRef(obligation.source.commit),
      "commit",
    ),
    ...obligation.context.map((reference) =>
      ticketExecutionContent(content, reference, "context"),
    ),
  ]);
  const [workload, inputs, resultContract, repository, commit, ...contexts] =
    references;
  if (
    workload === undefined ||
    inputs === undefined ||
    resultContract === undefined ||
    repository === undefined ||
    commit === undefined
  )
    throw new Error("ticket execution view is incomplete");
  return {
    workload: ticketExecutionJson(workload.content, "workload"),
    inputs: ticketExecutionJson(inputs.content, "inputs"),
    resultContract: ticketExecutionJson(
      resultContract.content,
      "result contract",
    ),
    repository: repository.content,
    commit: commit.content,
    access: definition.execution_requirements.access.kind,
    requiredCapabilities:
      definition.execution_requirements.required_capabilities,
    context: obligation.context.map((reference, index) => {
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

function ticketExecutionTerminal(
  claim: TicketExecutionClaim,
  result: Exclude<TicketExecutionResult, { readonly result: "Retry" }>,
): task.TaskTerminal {
  if (result.result === "Produced" || result.result === "ProcessFailed")
    return result.terminal;
  return new task.TaskExecutionUnavailable(
    new task.TaskFailure(claim.obligation.task, result.evidence),
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
  runner: TicketExecutionRunner,
  claim: TicketExecutionClaim,
  authorization: TicketMachineAuthorization,
  attemptsMax: number,
  cancellationPollMs: number,
): Promise<number> {
  const running = runner.run(
    claim,
    await ticketExecutionView(content(claim.partition), claim.obligation),
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
  const terminal =
    result.result === "Retry"
      ? new task.TaskExecutionUnavailable(
          new task.TaskFailure(claim.obligation.task, result.evidence),
        )
      : ticketExecutionTerminal(claim, result);
  const submitted = await store.terminal(claim, {
    identity: `execution-terminal:${claim.taskKey}`,
    origin: "Execution",
    authorization,
    command: new ticket.ReportTaskTerminal(
      new ticket.TaskTerminalReport(
        task.task_owner(claim.obligation.task),
        terminal,
      ),
    ),
  });
  return submitted ? 1 : 0;
}
