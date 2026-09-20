/**
 * Owner-role command that registers a worker pool against a project, or takes
 * one off it.
 *
 * IT HOLDS THE ADMIN PRIVILEGE AND THE PLANE DOES NOT. Creating a client at the
 * issuer is the one step of registration that no revocation undoes, which is
 * why it is named in an owner's command rather than in the outward-facing
 * process a pool polls: that process verifies tokens against the issuer's
 * published keys and names no admin address at all, and
 * `.dependency-cruiser.cjs` is what holds it to that.
 *
 * WHAT IT ADDS TO THE REGISTRATION IS AN ADDRESS PER AUTHORITY. The order the
 * three writes happen in and what is undone when one fails are
 * `../interpreter/workerPoolRegistration.ts`'s, so this file composes and
 * prints and decides nothing.
 */
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { hydraWorkerPoolClients } from "../adapters/hydra/oauthClients.ts";
import { ketoProjectGrants } from "../adapters/keto/projectGrants.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresWorkerPoolRegistry } from "../adapters/postgres/workerPool.ts";
import { checkedProjectGrantSettings } from "../interpreter/projectGrant.ts";
import { projectAccessTimeoutMsDefault } from "../interpreter/projectAccess.ts";
import {
  registerPoolRequired,
  registerPoolRun,
  type RegisterPoolEnvironment,
} from "../interpreter/workerPoolRegistration.ts";

const variables = {
  databaseUrl: "CHUG_WORKER_POOL_DATABASE_URL",
  audience: "CHUG_WORKER_POOL_OIDC_AUDIENCE",
  hydraAdminUrl: "CHUG_WORKER_POOL_HYDRA_ADMIN_URL",
  ketoWriteUrl: "CHUG_WORKER_POOL_KETO_WRITE_URL",
} as const;

async function main(environment: RegisterPoolEnvironment): Promise<void> {
  const pool = postgresPool(
    registerPoolRequired(environment, variables.databaseUrl),
  );
  try {
    process.stdout.write(
      `${await registerPoolRun({
        environment,
        ports: {
          registry: postgresWorkerPoolRegistry(pool),
          clients: hydraWorkerPoolClients({
            adminUrl: registerPoolRequired(
              environment,
              variables.hydraAdminUrl,
            ),
            audience: registerPoolRequired(environment, variables.audience),
            requestTimeoutMs: projectAccessTimeoutMsDefault,
          }),
          grants: ketoProjectGrants(
            checkedProjectGrantSettings({
              writeUrl: registerPoolRequired(
                environment,
                variables.ketoWriteUrl,
              ),
            }),
          ),
          clientId: () => `chuggy-pool-${randomUUID()}`,
        },
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.env).catch((failure: unknown) => {
    const message =
      failure instanceof Error
        ? failure.message
        : "unknown registration failure";
    process.stderr.write(`register worker pool: ${message}\n`);
    process.exitCode = 1;
  });
