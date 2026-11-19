/**
 * `serve`: the person's own runners given the project, with the write the
 * console's Personal runners page makes, at the priority it adds one at.
 *
 * It is asked only where the checklist's next thing is a personal runner of
 * the person's taking the project's work, and it lets no other write out.
 * Whether the step is done is the checklist's to say, read after.
 */

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiPersonalRunnerServes } from "./apiRoutes.ts";
import { failureWords } from "./failureWords.ts";
import type { SetupServeDue } from "./setupNext.ts";
import type { SetupServeAnswered, SetupServeWritten } from "./setupReport.ts";

function setupServeWrittenOf(result: ApiResult<unknown>): SetupServeWritten {
  return result.outcome === "Ok"
    ? { written: true }
    : { written: false, failure: failureWords(result).word };
}

/** Asks the site for the write that is due, through ports that let only it out. */
export async function setupServeAsked(
  ports: ApiPorts,
  due: SetupServeDue,
): Promise<SetupServeAnswered> {
  return {
    given: setupServeWrittenOf(
      await apiPersonalRunnerServes(ports, due.partition, true),
    ),
  };
}
