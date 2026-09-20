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
 * callers waiting on it, so nothing is cached here and the client holds no
 * token between passes: a second copy of the grant would be a second account
 * of it. A token the plane rejected is handed back through `invalidate`, which
 * discards the source's grant so the next acquire mints, under the source's
 * own cooldown.
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
    invalidate: (token) => {
      source.invalidate(token);
    },
  };
}
