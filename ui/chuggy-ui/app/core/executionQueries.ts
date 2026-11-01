/**
 * An execution's reads: the execution itself, which an `Execution` frame marks
 * to be read again, the parts under it that no frame names — a run's turns,
 * its configuration, its error, an output's body — which the partition's
 * refetch reaches, and a ticket's page of them, which a frame's row folds into.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ExecutionsResponse } from "../../../../src/contract/responses.ts";
import {
  apiExecution,
  apiExecutions,
  apiOutputContent,
  apiRunConfiguration,
  apiRunError,
  apiRunTurns,
} from "./apiRoutes.ts";
import { consoleListQuery, consoleProjectQuery } from "./consoleQuery.ts";
import type { ConsoleQueryKept } from "./consoleQuery.ts";
import { projectListFolded } from "./projectQueryKeys.ts";
import { ticketExecutionsFolded } from "./ticketExecutions.ts";

export function executionQuery(
  partition: PartitionIdentity,
  execution: string,
  kept: ConsoleQueryKept = "Read",
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    execution,
    (ports) => apiExecution(ports, partition, execution),
    undefined,
    kept,
  );
}

/** One part of one attempt, named under the execution the frames carry. */
function executionAttemptResource(
  execution: string,
  attempt: string,
  part: string,
): string {
  return `${execution}/attempts/${attempt}/${part}`;
}

/** One page of an attempt's turns, from the one after `after`. */
export function runTurnsQuery(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  after: number | undefined,
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    executionAttemptResource(execution, attempt, `turns/${String(after ?? 0)}`),
    (ports) => apiRunTurns(ports, partition, execution, attempt, { after }),
  );
}

export function runConfigurationQuery(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    executionAttemptResource(execution, attempt, "configuration"),
    (ports) => apiRunConfiguration(ports, partition, execution, attempt),
  );
}

export function runErrorQuery(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    executionAttemptResource(execution, attempt, "error"),
    (ports) => apiRunError(ports, partition, execution, attempt),
  );
}

/** One output of one execution. */
export function outputContentQuery(
  partition: PartitionIdentity,
  execution: string,
  ordinal: number,
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    `${execution}/artifacts/${String(ordinal)}`,
    (ports) => apiOutputContent(ports, partition, execution, ordinal),
  );
}

/** The page of executions a ticket's route answers with, which a frame's row
 * of that ticket folds into. */
export function ticketExecutionsQuery(
  partition: PartitionIdentity,
  ticket: number,
) {
  return consoleListQuery(
    projectListFolded<ExecutionsResponse>(
      partition,
      "Execution",
      `ticket:${String(ticket)}`,
      (previous, change) => ticketExecutionsFolded(ticket, previous, change),
    ),
    (ports) => apiExecutions(ports, partition, { ticket }),
  );
}
