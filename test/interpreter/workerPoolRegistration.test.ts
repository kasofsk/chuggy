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
  readonly registeredClient?: string | undefined;
  /** One removal at the named authority fails, and the next succeeds. */
  readonly outage?: {
    readonly at: "clients" | "grants";
    readonly failure: Error;
  };
}): RegisterPoolPorts & { readonly made: unknown[] } {
  const made: unknown[] = [];
  let held = input?.registeredClient;
  let outages = input?.outage === undefined ? 0 : 1;
  const removed = (at: "clients" | "grants", call: unknown[]) => {
    if (input?.outage?.at === at && outages > 0) {
      outages -= 1;
      return Promise.reject(input.outage.failure);
    }
    made.push(call);
    return Promise.resolve(undefined);
  };
  return {
    made,
    registry: {
      register: (registration: WorkerPoolRegistration) =>
        Promise.resolve(
          (made.push(["register", registration]), input?.registered ?? true),
        ),
      clientOf: (_partition, pool) =>
        Promise.resolve((made.push(["clientOf", pool]), held)),
      deregister: (_partition, pool, clientId) => {
        made.push(["deregister", pool, clientId]);
        if (held !== clientId) return Promise.resolve(false);
        held = undefined;
        return Promise.resolve(true);
      },
      identify: () => Promise.resolve(undefined),
    },
    clients: {
      create: (clientId) =>
        Promise.resolve(
          (made.push(["create", clientId]),
          { clientId, clientSecret: "a-secret" }),
        ),
      remove: (clientId) => removed("clients", ["remove", clientId]),
    },
    grants: {
      write: (grant: ProjectGrant) =>
        Promise.resolve((made.push(["write", grant.relation]), undefined)),
      remove: (grant: ProjectGrant) =>
        removed("grants", ["revoke", grant.relation]),
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
        class: "Dedicated",
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
    ["remove", "chuggy-pool-fixed"],
    ["revoke", "pools"],
  ]);
});

test("an authority that cannot write the relation still has the client removed", async () => {
  const made = ports();
  const outage = new Error("the authority is unreachable");
  made.grants.write = () => Promise.reject(outage);
  made.grants.remove = () => Promise.reject(outage);
  await assert.rejects(registerPoolRun({ environment, ports: made }), outage);
  assert.deepEqual(made.made, [
    ["create", "chuggy-pool-fixed"],
    ["remove", "chuggy-pool-fixed"],
  ]);
});

const deregistering = {
  ...environment,
  CHUG_WORKER_POOL_OPERATION: "deregister",
};

test("deregistration takes off the client and the relation the row names, and the row last", async () => {
  const made = ports({ registeredClient: "chuggy-pool-was-here" });
  assert.equal(
    await registerPoolRun({ environment: deregistering, ports: made }),
    "Deregistered: tenant/project pool pool-one",
  );
  assert.deepEqual(made.made, [
    ["clientOf", "pool-one"],
    ["remove", "chuggy-pool-was-here"],
    ["revoke", "pools"],
    ["deregister", "pool-one", "chuggy-pool-was-here"],
  ]);
});

test("deregistering a pool no row names touches no issuer at all", async () => {
  const made = ports({ registeredClient: undefined });
  assert.equal(
    await registerPoolRun({ environment: deregistering, ports: made }),
    "NotRegistered: tenant/project pool pool-one",
  );
  assert.deepEqual(made.made, [["clientOf", "pool-one"]]);
});

for (const [authority, failing] of [
  ["issuer", "clients"],
  ["authority", "grants"],
] as const)
  test(`a deregistration the ${authority} could not complete leaves the row for the re-run`, async () => {
    const outage = new Error(`the ${authority} is unreachable`);
    const made = ports({
      registeredClient: "chuggy-pool-was-here",
      outage: { at: failing, failure: outage },
    });
    await assert.rejects(
      registerPoolRun({ environment: deregistering, ports: made }),
      outage,
    );
    assert.equal(
      made.made.some((call) => (call as unknown[])[0] === "deregister"),
      false,
      "the row outlives a removal that did not happen",
    );
    assert.equal(
      await registerPoolRun({ environment: deregistering, ports: made }),
      "Deregistered: tenant/project pool pool-one",
    );
  });

test("a pool registered again while it was being taken off keeps its newer client", async () => {
  const made = ports({ registeredClient: "chuggy-pool-was-here" });
  made.registry.clientOf = () => Promise.resolve("chuggy-pool-older");
  await assert.rejects(
    registerPoolRun({ environment: deregistering, ports: made }),
    /registered again/u,
  );
  assert.deepEqual(made.made.at(-1), [
    "deregister",
    "pool-one",
    "chuggy-pool-older",
  ]);
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
