import assert from "node:assert/strict";
import { test } from "node:test";

import { workerPoolCapabilitiesMax } from "../../src/contract/workerPool.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectGrant } from "../../src/interpreter/projectGrant.ts";
import type { WorkerPoolRegistration } from "../../src/interpreter/workerPool.ts";
import {
  registerPoolRun,
  type RegisterPoolPorts,
} from "../../src/interpreter/workerPoolRegistration.ts";

const issuer = "https://issuer.invalid";

const environment = {
  CHUG_WORKER_POOL_TENANT: "tenant",
  CHUG_WORKER_POOL_PROJECT: "project",
  CHUG_WORKER_POOL_POOL: "pool-one",
  CHUG_WORKER_POOL_CAPABILITIES: "linux-containers",
  CHUG_WORKER_POOL_OPERATION: "register",
  CHUG_WORKER_POOL_OIDC_ISSUER: issuer,
};

/** Every call the command made, so what it did at three authorities is what a case reads. */
function ports(input?: {
  readonly registered?: boolean;
  readonly deregistered?: string | undefined;
}): RegisterPoolPorts & { readonly made: unknown[] } {
  const made: unknown[] = [];
  return {
    made,
    registry: {
      register: (registration: WorkerPoolRegistration) =>
        Promise.resolve(
          (made.push(["register", registration]), input?.registered ?? true),
        ),
      deregister: (_partition, pool) =>
        Promise.resolve((made.push(["deregister", pool]), input?.deregistered)),
      identify: () => Promise.resolve(undefined),
    },
    clients: {
      create: (clientId) =>
        Promise.resolve(
          (made.push(["create", clientId]),
          { clientId, clientSecret: "a-secret" }),
        ),
      remove: (clientId) =>
        Promise.resolve((made.push(["remove", clientId]), undefined)),
    },
    grants: {
      write: (grant: ProjectGrant) =>
        Promise.resolve((made.push(["write", grant.relation]), undefined)),
      remove: (grant: ProjectGrant) =>
        Promise.resolve((made.push(["revoke", grant.relation]), undefined)),
    },
    clientId: () => "chuggy-pool-fixed",
  };
}

test("registration mints a client, writes the relation and records the principal it derives", async () => {
  const made = ports();
  const reported = await registerPoolRun({ environment, ports: made });
  assert.match(reported, /^Registered: tenant\/project pool pool-one/u);
  assert.match(reported, /chuggy-pool-fixed/u);
  assert.match(reported, /a-secret/u);
  assert.deepEqual(made.made, [
    ["create", "chuggy-pool-fixed"],
    ["write", "pools"],
    [
      "register",
      {
        partition: { tenant: "tenant", project: "project" },
        pool: "pool-one",
        capabilities: ["linux-containers"],
        clientId: "chuggy-pool-fixed",
        principal: oidcPrincipal(issuer, "chuggy-pool-fixed"),
      },
    ],
  ]);
});

test("a registration the row refused leaves neither a client nor a relation behind", async () => {
  const made = ports({ registered: false });
  await assert.rejects(
    registerPoolRun({ environment, ports: made }),
    /NotRegistered/u,
  );
  assert.deepEqual(made.made.slice(3), [
    ["revoke", "pools"],
    ["remove", "chuggy-pool-fixed"],
  ]);
});

test("deregistration takes off the client the row named", async () => {
  const made = ports({ deregistered: "chuggy-pool-was-here" });
  assert.equal(
    await registerPoolRun({
      environment: {
        ...environment,
        CHUG_WORKER_POOL_OPERATION: "deregister",
      },
      ports: made,
    }),
    "Deregistered: tenant/project pool pool-one",
  );
  assert.deepEqual(made.made, [
    ["deregister", "pool-one"],
    ["revoke", "pools"],
    ["remove", "chuggy-pool-was-here"],
  ]);
});

test("deregistering a pool no row names touches no issuer at all", async () => {
  const made = ports({ deregistered: undefined });
  assert.equal(
    await registerPoolRun({
      environment: {
        ...environment,
        CHUG_WORKER_POOL_OPERATION: "deregister",
      },
      ports: made,
    }),
    "NotRegistered: tenant/project pool pool-one",
  );
  assert.deepEqual(made.made, [["deregister", "pool-one"]]);
});

for (const absent of [
  "CHUG_WORKER_POOL_TENANT",
  "CHUG_WORKER_POOL_PROJECT",
  "CHUG_WORKER_POOL_POOL",
  "CHUG_WORKER_POOL_OPERATION",
  "CHUG_WORKER_POOL_OIDC_ISSUER",
] as const)
  test(`${absent} is required rather than defaulted`, async () => {
    await assert.rejects(
      registerPoolRun({
        environment: { ...environment, [absent]: undefined },
        ports: ports(),
      }),
      new RegExp(`${absent} is required`, "u"),
    );
  });

test("a capability the contract would not accept refuses the whole command", async () => {
  await assert.rejects(
    registerPoolRun({
      environment: {
        ...environment,
        CHUG_WORKER_POOL_CAPABILITIES: "linux containers",
      },
      ports: ports(),
    }),
  );
});

test("more capabilities than the wire admits refuse the whole command", async () => {
  const made = ports();
  await assert.rejects(
    registerPoolRun({
      environment: {
        ...environment,
        CHUG_WORKER_POOL_CAPABILITIES: Array.from(
          { length: workerPoolCapabilitiesMax + 1 },
          (_, index) => `capability-${String(index)}`,
        ).join(","),
      },
      ports: made,
    }),
  );
  assert.deepEqual(made.made, []);
});
