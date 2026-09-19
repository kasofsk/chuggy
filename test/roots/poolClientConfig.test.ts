import assert from "node:assert/strict";
import test from "node:test";

import {
  poolClientConfig,
  poolClientVariablePrefix,
  type PoolClientEnvironment,
} from "../../src/roots/poolClientConfig.ts";

const site = {
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

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): PoolClientEnvironment {
  return {
    [`${poolClientVariablePrefix}PLANE_URL`]: "https://pool-plane.invalid",
    [`${poolClientVariablePrefix}TOKEN_URL`]:
      "https://issuer.invalid/oauth2/token",
    [`${poolClientVariablePrefix}ID`]: "chuggy-pool-one",
    [`${poolClientVariablePrefix}SECRET`]: "secret",
    [`${poolClientVariablePrefix}AUDIENCE`]: "https://api.invalid",
    [`${poolClientVariablePrefix}SITE`]: JSON.stringify(site),
    ...overrides,
  };
}

test("a client is composed from its variables, the absent bounds defaulting", () => {
  const config = poolClientConfig(environment());
  assert.equal(config.tokens.audience, "https://api.invalid");
  assert.equal(config.plane.baseUrl, "https://pool-plane.invalid");
  assert.equal(config.site.namespace, "pool");
  assert.deepEqual(config.site.capabilities, {});
  assert.deepEqual(config.site.credentialMounts, {});
  assert.equal(config.client.concurrencyMax, 4);
});

test("a stated bound is the one used", () => {
  const config = poolClientConfig(
    environment({ [`${poolClientVariablePrefix}CONCURRENCY_MAX`]: "9" }),
  );
  assert.equal(config.client.concurrencyMax, 9);
});

test("a missing required variable is refused by name", () => {
  assert.throws(
    () =>
      poolClientConfig(
        environment({ [`${poolClientVariablePrefix}SECRET`]: undefined }),
      ),
    /CHUG_POOL_CLIENT_SECRET is required/u,
  );
});

test("a bound that is not a positive whole number is refused", () => {
  for (const value of ["0", "-1", "two", "1.5"])
    assert.throws(
      () =>
        poolClientConfig(
          environment({
            [`${poolClientVariablePrefix}CONCURRENCY_MAX`]: value,
          }),
        ),
      RangeError,
    );
});

test("a site that is not JSON, and one with a member it does not hold, are both refused", () => {
  assert.throws(
    () =>
      poolClientConfig(
        environment({ [`${poolClientVariablePrefix}SITE`]: "not json" }),
      ),
    /is not JSON/u,
  );
  assert.throws(
    () =>
      poolClientConfig(
        environment({
          [`${poolClientVariablePrefix}SITE`]: JSON.stringify({
            ...site,
            unknown: 1,
          }),
        }),
      ),
    /CHUG_POOL_CLIENT_SITE:/u,
  );
});
