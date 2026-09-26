/**
 * The pool client command: what its environment parses into, and what it says
 * about an environment it cannot start from.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. `src/roots/` is
 * the graph's executable roots and `.dependency-cruiser.cjs` forbids an import
 * of them from anywhere, so each case here runs the module in a child process
 * and reads what it wrote.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

const site = {
  fabric: "Kubernetes",
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "pool",
  tokenFile: "/var/run/secrets/token",
  serviceAccountName: "pool-worker",
  workspacePath: "/workspace",
  capabilityFile: "/run/chuggy/capability",
  workerPlaneUrl: "https://worker-plane.invalid",
  podNamePrefix: "pool",
  image: "registry.invalid/ticket-worker:1",
  poolLabel: { name: "chuggy.internal/pool", value: "pool-one" },
  resources: {
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "512Mi",
    ephemeralStorageLimit: "4Gi",
  },
  timeoutSecsMax: 30,
  outputBytesMax: 4096,
  requestTimeoutSecsMax: 5,
  unavailableRetryAfterSecs: 11,
};

const environment: Readonly<Record<string, string>> = {
  CHUG_POOL_CLIENT_PLANE_URL: "https://pool-plane.invalid",
  CHUG_POOL_CLIENT_TOKEN_URL: "https://issuer.invalid/oauth2/token",
  CHUG_POOL_CLIENT_ID: "chuggy-pool-one",
  CHUG_POOL_CLIENT_SECRET: "secret",
  CHUG_POOL_CLIENT_AUDIENCE: "https://api.invalid",
  CHUG_POOL_CLIENT_SITE: JSON.stringify(site),
};

/** The parsed configuration or the refusal, written by a child process of its own. */
async function parsed(
  named: Readonly<Record<string, string>>,
): Promise<{ parsed?: Record<string, unknown>; refused?: string }> {
  const source = `
    const config = await import('./src/roots/poolClientConfig.ts');
    const environment = ${JSON.stringify(named)};
    try {
      process.stdout.write(JSON.stringify({
        parsed: config.poolClientConfig(environment),
      }));
    } catch (failure) {
      process.stdout.write(JSON.stringify({ refused: failure.message }));
    }
  `;
  const ran = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", source],
    { cwd: process.cwd() },
  );
  return JSON.parse(ran.stdout) as {
    parsed?: Record<string, unknown>;
    refused?: string;
  };
}

/** The same environment without one of its variables, which is how each refusal is reached. */
function without(name: string): Readonly<Record<string, string>> {
  const named: Record<string, string> = { ...environment };
  delete named[name];
  return named;
}

test("a client is composed from its variables, the absent bounds defaulting", async () => {
  const found = (await parsed(environment)).parsed as {
    tokens: { audience: readonly string[] };
    plane: { baseUrl: string };
    site: { namespace: string; capabilities: Record<string, unknown> };
    client: { concurrencyMax: number; passesMax: number };
  };
  assert.deepEqual(found.tokens.audience, ["https://api.invalid"]);
  assert.equal(found.plane.baseUrl, "https://pool-plane.invalid");
  assert.equal(found.site.namespace, "pool");
  assert.deepEqual(found.site.capabilities, {});
  assert.equal(found.client.concurrencyMax, 4);
  assert.equal(found.client.passesMax, 1_000);
});

test("a stated bound is the one used", async () => {
  const found = (
    await parsed({ ...environment, CHUG_POOL_CLIENT_CONCURRENCY_MAX: "9" })
  ).parsed as { client: { concurrencyMax: number } };
  assert.equal(found.client.concurrencyMax, 9);
});

test("every required variable is named in its own refusal", async () => {
  for (const name of Object.keys(environment)) {
    const found = await parsed(without(name));
    assert.equal(found.parsed, undefined, name);
    assert.match(String(found.refused), new RegExp(`${name} is required`, "u"));
  }
});

test("a bound that is not a positive whole number is refused", async () => {
  for (const value of ["0", "-1", "two", "1.5"]) {
    const found = await parsed({
      ...environment,
      CHUG_POOL_CLIENT_CONCURRENCY_MAX: value,
    });
    assert.match(String(found.refused), /must be a positive integer/u);
  }
});

test("a site that is not JSON, and one with a member it does not hold, are both refused", async () => {
  assert.match(
    String(
      (await parsed({ ...environment, CHUG_POOL_CLIENT_SITE: "no" })).refused,
    ),
    /is not JSON/u,
  );
  assert.match(
    String(
      (
        await parsed({
          ...environment,
          CHUG_POOL_CLIENT_SITE: JSON.stringify({ ...site, unknown: 1 }),
        })
      ).refused,
    ),
    /CHUG_POOL_CLIENT_SITE:/u,
  );
});

test("a site names its own fabric, and a document under another name is refused", async () => {
  const found = (
    await parsed({
      ...environment,
      CHUG_POOL_CLIENT_SITE: JSON.stringify(site),
    })
  ).parsed as { site: { fabric: string } };
  assert.equal(found.site.fabric, "Kubernetes");
  for (const crossed of [
    { ...site, fabric: "Nomad" },
    { ...site, fabric: "Mesos" },
  ]) {
    const refused = await parsed({
      ...environment,
      CHUG_POOL_CLIENT_SITE: JSON.stringify(crossed),
    });
    assert.equal(refused.parsed, undefined, crossed.fabric);
    assert.match(String(refused.refused), /CHUG_POOL_CLIENT_SITE:/u);
  }
});

test("a site's database is read as the launcher's is, and one it does not describe is refused", async () => {
  const database = {
    image: "registry.invalid/postgres:18",
    resources: site.resources,
  };
  const found = (
    await parsed({
      ...environment,
      CHUG_POOL_CLIENT_SITE: JSON.stringify({ ...site, database }),
    })
  ).parsed as { site: { database?: unknown } };
  assert.deepEqual(found.site.database, database);
  for (const refused of [
    { ...database, image: "" },
    { image: database.image },
    { ...database, port: 5432 },
  ]) {
    const answer = await parsed({
      ...environment,
      CHUG_POOL_CLIENT_SITE: JSON.stringify({ ...site, database: refused }),
    });
    assert.equal(answer.parsed, undefined, JSON.stringify(refused));
    assert.match(String(answer.refused), /CHUG_POOL_CLIENT_SITE: database/u);
  }
});
