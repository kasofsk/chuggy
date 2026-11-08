/**
 * The reads a Context view is drawn from: a run's series and its readings,
 * and a session's readings by turn.
 *
 * NONE IS POLLED AND NO FRAME NAMES ANY. Each is keyed by a mark the read it
 * sits under already carries — the rows and readings a run's `Execution`
 * frame says it has recorded, a session's newest turn as its own read last
 * answered it — so a move the page already hears is a new key, read once, and
 * a mark that has not moved reads nothing.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { sessionContextPageTurnsMax } from "../../../../src/contract/http.ts";
import type { ApiPorts } from "./apiRequest.ts";
import { apiLeadContext, apiRunContext, apiRunTurns } from "./apiRoutes.ts";
import {
  consolePartitionQuery,
  consoleProjectQuery,
  consoleTenantQuery,
} from "./consoleQuery.ts";
import {
  contextRunReadingsPageMax,
  contextRunReadingsPaged,
  contextRunTurnsPageRows,
  contextRunTurnsPaged,
} from "./contextRun.ts";
import { contextSessionPaged } from "./contextSession.ts";
import type { SessionContextMark } from "./contextSession.ts";
import { apiThreadContextAt } from "./threadHome.ts";
import type { ThreadHome } from "./threadHome.ts";

/** Every row of one attempt's series, read again when it has recorded more. */
export function runTurnsQuery(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  recorded: number,
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    `${execution}/attempts/${attempt}/turns@${String(recorded)}`,
    (ports) =>
      contextRunTurnsPaged((after) =>
        apiRunTurns(ports, partition, execution, attempt, {
          after,
          limit: contextRunTurnsPageRows,
        }),
      ),
  );
}

/** Every reading one attempt recorded, read again when it has recorded more. */
export function runContextQuery(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  recorded: number,
) {
  return consoleProjectQuery(
    partition,
    "Execution",
    `${execution}/attempts/${attempt}/context@${String(recorded)}`,
    (ports) =>
      contextRunReadingsPaged((after) =>
        apiRunContext(ports, partition, execution, attempt, {
          after,
          limit: contextRunReadingsPageMax,
        }),
      ),
  );
}

/** The lead's readings, read again when its newest turn moves. */
export function leadContextQuery(
  partition: PartitionIdentity,
  at: SessionContextMark,
) {
  return consolePartitionQuery(partition, `lead-context@${at.mark}`, (ports) =>
    contextSessionPaged(
      (after) =>
        apiLeadContext(ports, partition, {
          after,
          limit: sessionContextPageTurnsMax,
        }),
      at.newest,
    ),
  );
}

/** One thread's readings wherever it is kept, read again when its newest turn
 * moves. */
export function threadContextQuery(
  home: ThreadHome,
  session: string,
  at: SessionContextMark,
) {
  const resource = `thread-context-${session}@${at.mark}`;
  const read = (ports: ApiPorts) =>
    contextSessionPaged(
      (after) =>
        apiThreadContextAt(ports, home, session, {
          after,
          limit: sessionContextPageTurnsMax,
        }),
      at.newest,
    );
  return home.scope === "Project"
    ? consolePartitionQuery(home.partition, resource, read)
    : consoleTenantQuery(home.tenant, resource, read);
}
