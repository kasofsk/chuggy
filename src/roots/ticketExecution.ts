import type pg from "pg";
import {
  kubernetesTicketExecutionRunner,
  type TicketRepositoryCredentials,
} from "../adapters/kubernetes/ticketExecution.ts";
import {
  postgresTicketExecution,
  postgresTicketExecutionTerminals,
} from "../adapters/postgres/ticketExecution.ts";
import { postgresTicketContent } from "../adapters/postgres/ticketContent.ts";
import { postgresTicketMachine } from "../adapters/postgres/ticketMachine.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import {
  composeForgeRepositoryMinting,
  composeRepositoryCredentials,
} from "../compose.ts";
import { workerPodForgeApp } from "../interpreter/forgeInstallation.ts";
import { asRepositoryId } from "../interpreter/finalizer.ts";
import {
  ticketExecutionRun,
  ticketExecutionUnclaimableRun,
  type TicketExecutionContent,
  type TicketExecutionTickets,
} from "../interpreter/ticketExecution.ts";
import type {
  SchedulerCommandConfig,
  SchedulerTicketExecutionConfig,
} from "./schedulerConfig.ts";

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
    postgresProjectRepositoryBinding(pool),
    ticketExecutionCredentials(pool, settings),
    {
      ...config.workers,
      image: settings.image,
      callbackUrl: new URL(
        "/v1/ticket-execution/terminal",
        config.workers.workerPlaneUrl,
      ).toString(),
      credentialUsername: settings.credentialUsername,
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

export function ticketExecutionCredentials(
  pool: pg.Pool,
  settings: Pick<SchedulerTicketExecutionConfig, "forge" | "credentialSources">,
): TicketRepositoryCredentials {
  const minting = composeForgeRepositoryMinting(
    pool,
    settings.forge,
    workerPodForgeApp,
  );
  const ports = {
    read: credentialPort("read"),
    write: credentialPort("write"),
  };
  function credentialPort(permissions: "read" | "write") {
    return composeRepositoryCredentials({
      sources: settings.credentialSources
        .filter((source) => source.permissions === permissions)
        .map((source) => ({
          repository: asRepositoryId(source.repository),
          path: source.path,
          ...(source.credentialReference === undefined
            ? {}
            : { credentialReference: source.credentialReference }),
        })),
      permissions,
      ...(minting === undefined ? {} : { minting }),
    });
  }
  return {
    credential: (binding, access) =>
      ports[access === "ReadRepository" ? "read" : "write"].credential(binding),
  };
}
