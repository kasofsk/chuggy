/**
 * `serve`: the person's own runners given the project, with the write the
 * console's Personal runners page makes, at the priority it adds one at; and
 * where the project names no owner fallback and the person may name one,
 * Preferred named, with the write its Placement page makes. Preferred and not
 * Strict, so the project's pools still take its work while the person's
 * runner is off.
 *
 * It is asked only where the checklist's next thing is a personal runner of
 * the person's taking the project's work, and it lets no other write out.
 * Whether the step is done is the checklist's to say, read after.
 */

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiPersonalRunnerServes, apiWriteOwnerFallback } from "./apiRoutes.ts";
import { failureWords } from "./failureWords.ts";
import type { SetupServeDue } from "./setupNext.ts";
import type { SetupServeAnswered, SetupServeWritten } from "./setupReport.ts";

function setupServeWrittenOf(result: ApiResult<unknown>): SetupServeWritten {
  return result.outcome === "Ok"
    ? { written: true }
    : { written: false, failure: failureWords(result).word };
}

/** Asks the site for each write that is due, through ports that let only those out. */
export async function setupServeAsked(
  ports: ApiPorts,
  due: SetupServeDue,
): Promise<SetupServeAnswered> {
  const given = due.give
    ? setupServeWrittenOf(
        await apiPersonalRunnerServes(ports, due.partition, true),
      )
    : undefined;
  const allowed = due.allow
    ? setupServeWrittenOf(
        await apiWriteOwnerFallback(ports, due.partition, {
          fallback: "Preferred",
        }),
      )
    : undefined;
  return { given, allowed };
}
