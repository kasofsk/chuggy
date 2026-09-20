/**
 * The process a registered worker pool runs: it polls, it places, and it holds
 * no state a restart would lose.
 *
 * IT IS THE ONLY PROCESS IN THIS TREE THAT IS A CLIENT OF CHUGGY'S OWN HTTP
 * SURFACE, and it is composed exactly like the servers are — the loop is
 * `../interpreter/workerPoolClient.ts`, the wire and the issuer are adapters
 * under `../adapters/http/`, the fabric is one under
 * `../adapters/kubernetes/`, and this file only names which. Which one is the
 * site document's own answer, so a pool on a second fabric adds a backend
 * beside it and changes nothing above here.
 *
 * A RUN IS BOUNDED AND ENDING ONE IS NOT LOSING WORK. The loop makes a
 * configured number of passes and exits, because what the pool holds is read
 * back out of the cluster on the next pass rather than remembered here: a
 * supervisor that restarts this process reconciles the same workloads instead
 * of orphaning them. A pool the plane has refused exits non-zero, because no
 * restart of it would be answered differently.
 */
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { poolClientTokens } from "../adapters/http/poolTokens.ts";
import { poolPlaneClient } from "../adapters/http/poolPlaneClient.ts";
import { kubernetesPoolBackend } from "../adapters/kubernetes/poolPlacement.ts";
import {
  checkedWorkerPoolClientSettings,
  workerPoolClientRun,
  type WorkerPoolBackend,
  type WorkerPoolPass,
} from "../interpreter/workerPoolClient.ts";
import { poolClientConfig, type PoolClientSite } from "./poolClientConfig.ts";

/** The one backend this site is, which is the fabric its own document named. */
function poolClientBackend(site: PoolClientSite): WorkerPoolBackend {
  switch (site.fabric) {
    case "Kubernetes":
      return kubernetesPoolBackend(site);
  }
}

export async function poolClientMain(
  environment: NodeJS.ProcessEnv,
): Promise<WorkerPoolPass> {
  const config = poolClientConfig(environment);
  return workerPoolClientRun(
    {
      tokens: poolClientTokens(config.tokens),
      plane: poolPlaneClient(config.plane),
      backend: poolClientBackend(config.site),
      settings: checkedWorkerPoolClientSettings(config.client),
    },
    async (ms) => {
      await delay(ms);
    },
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await poolClientMain(process.env).then(
    (passed) => {
      if (passed.passed !== "Denied") return;
      process.stderr.write(`pool client: ${passed.evidence}\n`);
      process.exitCode = 1;
    },
    (failure: unknown) => {
      process.stderr.write(
        `pool client: ${failure instanceof Error ? failure.message : "the client failed"}\n`,
      );
      process.exitCode = 1;
    },
  );
