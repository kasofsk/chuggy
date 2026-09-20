/**
 * `WorkerPoolTokens` over this tree's own client-credentials source, which is
 * where a pool's client id and secret become a bearer.
 *
 * THE TWO FAILURES ARE KEPT APART AND NEITHER IS INVENTED HERE. The source
 * already raises `ClientCredentialsRefused` for the statuses the issuer refuses
 * this client with and an ordinary error for everything else, so this module
 * reads which it was and says so; merging them would have a pool with a typo in
 * its secret back off forever, or one behind a restarting issuer delete itself.
 *
 * A GRANT IS ASKED FOR EVERY PASS AND MINTED FAR LESS OFTEN. The source holds
 * its own grant until its refresh margin and shares one mint between the
 * callers waiting on it, so the expiry reported here is the shortest one the
 * client's own cache can hold — the caching that matters already happened, and
 * a second copy of it in the client would be a second account of one grant.
 */

import {
  ClientCredentialsRefused,
  clientCredentialsTokenSource,
  type ClientCredentialsConfig,
} from "./clientCredentials.ts";
import type {
  WorkerPoolTokenAcquired,
  WorkerPoolTokens,
} from "../../interpreter/workerPoolClient.ts";

/** How long one acquired token is reported as usable, which is the source's own answer to hold. */
const poolTokenHeldSecs = 1;

export function poolClientTokens(
  config: ClientCredentialsConfig,
): WorkerPoolTokens {
  const source = clientCredentialsTokenSource(config);
  return {
    acquire: async (): Promise<WorkerPoolTokenAcquired> => {
      try {
        return {
          acquired: "Token",
          token: await source.token(
            AbortSignal.timeout(config.requestTimeoutMs),
          ),
          expiresInSecs: poolTokenHeldSecs,
        };
      } catch (failure) {
        if (failure instanceof ClientCredentialsRefused)
          return { acquired: "Denied", evidence: failure.message };
        return {
          acquired: "Unavailable",
          evidence:
            failure instanceof Error
              ? failure.message
              : "the issuer could not be reached",
        };
      }
    },
  };
}
