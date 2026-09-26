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
  workerContractHeader,
  workerContractRelease,
} from "../../contract/workerContract.ts";
import {
  contractVersionAccepted,
  contractVersionRefusal,
  type WorkerContractRange,
} from "../../interpreter/workerPlane.ts";

/** Names this plane's release on every answer `app` gives, the framework's own refusals and failures included. */
export function workerContractNamed(app: FastifyInstance): void {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header(workerContractHeader, workerContractRelease);
  });
}

/** A contract route's first hook on a plane serving `range`, answering the refusal where the request's release is outside it. */
export function workerContractChecked(
  range: WorkerContractRange,
): (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<FastifyReply | undefined> {
  const refusal = contractVersionRefusal(range);
  return async (request, reply) => {
    const offered = request.headers[workerContractHeader];
    return contractVersionAccepted(
      range,
      Array.isArray(offered) ? offered.join(", ") : offered,
    )
      ? undefined
      : reply.code(contractVersionRefusalStatus).send(refusal);
  };
}
