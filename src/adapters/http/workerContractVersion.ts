/**
 * The worker contract's version as the job, session and pool planes speak it:
 * every answer names the release this process was built with, and a contract
 * route refuses a request whose release its plane does not serve before
 * anything reads its bearer. Each plane serves its own range. A cluster's
 * probes send no release and are no contract route, so they are never refused.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  contractVersionRefusalStatus,
  workerContractFeatures,
  workerContractFeaturesHeader,
  workerContractFeaturesOf,
  workerContractFeaturesText,
  workerContractHeader,
  workerContractRelease,
  type WorkerContractFeature,
  type WorkerContractPeer,
} from "../../contract/workerContract.ts";
import {
  contractVersionAccepted,
  contractVersionRefusal,
  type WorkerContractRange,
} from "../../interpreter/workerPlane.ts";

/** Every feature in the roster, each of which this plane implements. */
const workerContractNamedFeatures = workerContractFeaturesText(
  Object.keys(workerContractFeatures) as WorkerContractFeature[],
);

/** Names this plane's release and its features on every answer `app` gives, the framework's own refusals and failures included. */
export function workerContractNamed(app: FastifyInstance): void {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header(workerContractHeader, workerContractRelease);
    reply.header(workerContractFeaturesHeader, workerContractNamedFeatures);
  });
}

/** The text of a header a request sends, a header sent more than once joined by `, `. */
function workerContractOfferedText(
  request: FastifyRequest,
  header: string,
): string | undefined {
  const offered = request.headers[header];
  return Array.isArray(offered) ? offered.join(", ") : offered;
}

/** The release a request names, a header sent more than once joined into text no release matches. */
export function workerContractOffered(
  request: FastifyRequest,
): string | undefined {
  return workerContractOfferedText(request, workerContractHeader);
}

/** What a request offered: the release it names and the features it lists. */
export function workerContractPeer(
  request: FastifyRequest,
): WorkerContractPeer {
  return {
    release: workerContractOffered(request),
    features: workerContractFeaturesOf(
      workerContractOfferedText(request, workerContractFeaturesHeader),
    ),
  };
}

/** A contract route's first hook on a plane serving `range`, answering the refusal where the request's release is outside it. */
export function workerContractChecked(
  range: WorkerContractRange,
): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<FastifyReply | undefined> {
  const refusal = contractVersionRefusal(range);
  return async (request, reply) =>
    contractVersionAccepted(range, workerContractOffered(request))
      ? undefined
      : reply.code(contractVersionRefusalStatus).send(refusal);
}
