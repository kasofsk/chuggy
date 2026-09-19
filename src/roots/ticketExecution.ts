import type pg from "pg";
import { kubernetesTicketExecutionRunner } from "../adapters/kubernetes/ticketExecution.ts";
import {
  postgresTicketExecution,
  postgresTicketExecutionTerminals,
} from "../adapters/postgres/ticketExecution.ts";
import { postgresTicketContent } from "../adapters/postgres/ticketContent.ts";
import { postgresTicketMachine } from "../adapters/postgres/ticketMachine.ts";
import {
  ticketExecutionPrepareRun,
  ticketExecutionRun,
  ticketExecutionSettlementRun,
  ticketExecutionUnclaimableRun,
  type TicketExecutionContent,
  type TicketExecutionTickets,
} from "../interpreter/ticketExecution.ts";
import type { SchedulerCommandConfig } from "./schedulerConfig.ts";

export function ticketExecutionRuntime(
  pool: pg.Pool,
  config: SchedulerCommandConfig,
): { run(): Promise<void> } {
  const settings = config.tickets;
  const content: TicketExecutionContent = (partition) =>
    postgresTicketContent(pool, partition);
  const runner = ticketExecutionRuntimeRunner(pool, config);
  const store = postgresTicketExecution(pool);
  const machine = postgresTicketMachine(pool);
  const tickets: TicketExecutionTickets = async (partition) => {
    const graph = await machine.read(partition);
    return graph === "LegacyModelUnsupported" ? undefined : graph;
  };
  const authorization = {
    principal: config.identity.owner,
    authorizedOperation: "ReportTaskTerminal",
    authorityKind: "ExecutionScheduler",
    authoritySubject: config.identity.owner,
    policyRevision: "ticket-execution-v1",
  } as const;
  return {
    run: async () => {
      await ticketExecutionPrepareRun(
        store,
        content,
        tickets,
        settings.claimsPerPassMax,
      );
      await ticketExecutionSettlementRun(
        store,
        content,
        tickets,
        authorization,
        settings.claimsPerPassMax,
      );
      await ticketExecutionUnclaimableRun(
        store,
        content,
        config.identity.owner,
        config.identity.recoveryEpoch,
        authorization,
        settings.leaseSecs,
        settings.claimsPerPassMax,
        settings.unclaimedWindowSecs,
      );
      await ticketExecutionRun(
        store,
        content,
        tickets,
        runner,
        config.identity.owner,
        config.identity.recoveryEpoch,
        authorization,
        settings.leaseSecs,
        settings.attemptsMax,
        settings.claimsPerPassMax,
        settings.capabilities,
      );
    },
  };
}

/** The one backend this deployment runs its own claims on, built from the site it names. */
function ticketExecutionRuntimeRunner(
  pool: pg.Pool,
  config: SchedulerCommandConfig,
): ReturnType<typeof kubernetesTicketExecutionRunner> {
  const settings = config.tickets;
  return kubernetesTicketExecutionRunner(
    postgresTicketExecutionTerminals(pool),
    {
      ...config.workers,
      image: settings.image,
      callbackUrl: new URL(
        "/v1/ticket-execution",
        config.workers.workerPlaneUrl,
      ).toString(),
      timeoutSecsMax: config.workers.activeDeadlineSecs,
      outputBytesMax: settings.outputBytesMax,
      outcomePollMs: settings.outcomePollMs,
      outcomePollsMax:
        Math.ceil(
          (config.workers.activeDeadlineSecs * 1000) / settings.outcomePollMs,
        ) + 1,
      leaseSecs: settings.leaseSecs,
      retryAfterSecs: config.workers.unavailableRetryAfterSecs,
    },
  );
}
