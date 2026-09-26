/**
 * The two things `CHUG_WORKER_TASK` may carry, as the suites hold them against
 * each other: the document a pushed pod is launched with, the answer the task
 * route gives for the same attempt, and a pool's envelope.
 *
 * THE DOCUMENT IS THE SERVER'S OWN, NOT ONE WRITTEN HERE. It is read out of the
 * pod golden the launcher's suite pins byte for byte, so a task this pod builds
 * from an envelope is compared with what a launcher really writes. The answer
 * is that document less its plane and told as a work task, which is how the
 * task route builds it from the same record, and it is read under the
 * contract's answer schema, refusing any field the schema does not name.
 */

import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { workerTaskVariable } from "@chuggy/worker-contract/workerEnvironment";
import {
  poolEnvelopeSchema,
  workTaskAnswerSchema,
} from "@chuggy/worker-contract/workerTask";

const podGolden = JSON.parse(
  readFileSync(
    new URL(
      "../../test/adapters/kubernetesWorkerPodDocument.golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

/** The task document the launcher writes into a pushed pod. */
export const pushed = JSON.parse(
  podGolden.withoutDatabase.pod.spec.containers[0].env.find(
    ({ name }) => name === workerTaskVariable,
  ).value,
);

/** What the task route answers for the attempt `pushed` was written for. */
export const fetchedAnswer = workTaskAnswerSchema
  .strict()
  .parse(
    Object.fromEntries([
      ["kind", workTaskAnswerSchema.shape.kind.value],
      ...Object.entries(pushed).filter(([field]) => field !== "workerPlane"),
    ]),
  );

/** What a pool's envelope reads as, naming the plane `pushed` names. */
export const envelope = poolEnvelopeSchema.parse({
  callbackUrl: pushed.workerPlane.url,
  bearer: "0123456789abcdef".repeat(4),
  workspace: "/pool/workspace",
  timeoutSecsMax: 1_800,
  outputBytesMax: 4_096,
});
