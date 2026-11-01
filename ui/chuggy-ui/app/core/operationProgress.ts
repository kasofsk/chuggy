/**
 * A follow run as a console write: every step it takes reported into the
 * write's progress, and a throw ended as an abandonment in its own words, so
 * the step a screen reads is always the one the follow ended at.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";

import type { ApiPorts } from "./apiRequest.ts";
import type { ConsoleWriteProgress } from "./consoleWrite.ts";
import { followOperation } from "./operationFollow.ts";
import type { OperationStep, OperationSubmission } from "./operationFollow.ts";

/** The step the follow ended at, a throw reported as abandoned for `unsaid`
 * where it carries no message of its own. */
export async function followOperationProgressed(
  ports: ApiPorts,
  partition: PartitionIdentity,
  submission: OperationSubmission,
  ticket: number,
  progress: ConsoleWriteProgress<OperationStep>,
  unsaid: string,
): Promise<OperationStep> {
  try {
    const followed = await followOperation(
      ports,
      partition,
      submission,
      ticket,
      (step) => {
        progress.report(step);
      },
    );
    return followed.step;
  } catch (thrown: unknown) {
    const abandoned: OperationStep = {
      step: "Abandoned",
      reason: thrown instanceof Error ? thrown.message : unsaid,
      refused: false,
    };
    progress.report(abandoned);
    return abandoned;
  }
}
