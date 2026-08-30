import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import { signalledCommandRun } from "./harness.ts";

const execute = promisify(execFile);
const command = ["--experimental-strip-types", "src/roots/selector.ts"];
const validConfiguration = {
  database: {
    url: "postgres://selector-secret@127.0.0.1:1/chuggy",
    limits: {
      connectionsMax: 1,
      connectionWaitMs: 10,
      statementTimeoutMs: 10,
    },
  },
  runtime: {
    idleIntervalMilliseconds: 10,
    shutdownDrainMilliseconds: 100,
  },
  selector: { projectsMax: 1, deliveriesMax: 2, reconciliationsMax: 3 },
  identity: { principal: "selector-service", instance: "selector-1" },
  source: {
    baseUrl: "http://127.0.0.1:1/",
    credential: {
      tokenUrl: "http://127.0.0.1:3/oauth2/token",
      clientId: "selector-client",
      audience: ["https://chuggy.example/api"],
      scope: [],
      refreshMarginMs: 60_000,
      mintCooldownMs: 5_000,
    },
    requestDeadlineMs: 10,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
  },
  policy: {
    baseUrl: "http://127.0.0.1:2/",
    bearerToken: "policy-token",
    requestDeadlineMs: 10,
    responseBytesMax: 10_000,
    controlDeadlineMs: 10,
  },
};
const clientSecret = "selector-client-secret";
const validEnvironment = {
  CHUG_SELECTOR_CONFIG: JSON.stringify(validConfiguration),
  CHUG_SELECTOR_SOURCE_CLIENT_SECRET: clientSecret,
};

interface CommandFailure {
  readonly code: number;
  readonly stderr: string;
}

async function executeFailure(
  environment: NodeJS.ProcessEnv,
): Promise<CommandFailure> {
  try {
    await execute(process.execPath, command, {
      cwd: process.cwd(),
      env: environment,
    });
  } catch (failure) {
    return failure as CommandFailure;
  }
  assert.fail("command unexpectedly succeeded");
}

test("the selector command parses every plain-data dependency", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    process.stdout.write(JSON.stringify(root.selectorConfiguration(process.env)));
  `;
  const found = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: validEnvironment,
    },
  );
  assert.deepEqual(JSON.parse(found.stdout), {
    process: {
      database: validConfiguration.database,
      runtime: validConfiguration.runtime,
      selector: validConfiguration.selector,
    },
    identity: validConfiguration.identity,
    source: {
      ...validConfiguration.source,
      credential: { ...validConfiguration.source.credential, clientSecret },
    },
    policy: validConfiguration.policy,
  });
});

test("the client secret is required and never reaches the diagnostic", async () => {
  const missing = await executeFailure({
    CHUG_SELECTOR_CONFIG: JSON.stringify(validConfiguration),
  });
  assert.equal(missing.code, 2);
  assert.equal(
    missing.stderr,
    "selector configuration: CHUG_SELECTOR_SOURCE_CLIENT_SECRET is required\n",
  );
  const empty = await executeFailure({
    ...validEnvironment,
    CHUG_SELECTOR_SOURCE_CLIENT_SECRET: "",
  });
  assert.equal(empty.code, 2);
  assert.equal(
    empty.stderr,
    "selector configuration: CHUG_SELECTOR_SOURCE_CLIENT_SECRET is required\n",
  );
  const held = await executeFailure({
    ...validEnvironment,
    CHUG_SELECTOR_CONFIG: JSON.stringify({
      ...validConfiguration,
      source: { ...validConfiguration.source, baseUrl: "gopher://refused/" },
    }),
  });
  assert.equal(held.code, 2);
  assert.doesNotMatch(held.stderr, /selector-client-secret/u);
  assert.match(held.stderr, /^selector configuration:/u);
});

test("a token URL carrying credentials is a configuration refusal", async () => {
  const refused = await executeFailure({
    ...validEnvironment,
    CHUG_SELECTOR_CONFIG: JSON.stringify({
      ...validConfiguration,
      source: {
        ...validConfiguration.source,
        credential: {
          ...validConfiguration.source.credential,
          tokenUrl: "http://identity:hunter2@127.0.0.1:3/oauth2/token",
        },
      },
    }),
  });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /^selector configuration:/u);
  assert.doesNotMatch(refused.stderr, /hunter2/u);
});

test("malformed configuration has a stable credential-free diagnostic", async () => {
  const missing = await executeFailure({});
  assert.equal(missing.code, 2);
  assert.equal(
    missing.stderr,
    "selector configuration: CHUG_SELECTOR_CONFIG is required\n",
  );
  const malformed = await executeFailure({
    CHUG_SELECTOR_CONFIG: '{"source":{"bearerToken":"secret"}}',
  });
  assert.equal(malformed.code, 2);
  assert.doesNotMatch(malformed.stderr, /secret/u);
  assert.match(malformed.stderr, /^selector configuration:/u);
});

test("identity generation is unique and names its process instance", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    const identities = root.selectorIdentities('selector-1');
    const partition = { tenant: 'tenant', project: 'project' };
    process.stdout.write(JSON.stringify([identities.next(partition), identities.next(partition)]));
  `;
  const found = await execute(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    program,
  ]);
  const identities = JSON.parse(found.stdout) as readonly {
    readonly operation: string;
    readonly selectorDecisionReference: string;
  }[];
  assert.equal(identities.length, 2);
  assert.notEqual(identities[0]?.operation, identities[1]?.operation);
  for (const identity of identities) {
    assert.match(identity.operation, /^selector-operation-selector-1-/u);
    assert.match(
      identity.selectorDecisionReference,
      /^selector-decision-selector-1-/u,
    );
  }
});

test("source and policy readiness have stable named prerequisites", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    const native = { projectInventory: async () => { throw new Error('absent'); } };
    const policy = { ready: async () => false };
    const sourceReady = async () => false;
    const preconditions = root.selectorCommandPreconditions(native, policy, 'selector', sourceReady);
    const signal = new AbortController().signal;
    process.stdout.write(JSON.stringify(await Promise.all(preconditions.map(async (value) => ({
      name: value.name,
      met: await value.check(signal).catch(() => false),
    })))));
  `;
  const found = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: validEnvironment,
    },
  );
  assert.deepEqual(JSON.parse(found.stdout), [
    { name: "selector-source", met: false },
    { name: "selector-policy", met: false },
  ]);
});

test("native readiness refuses a healthy inventory over an unready context pool", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    let inventoryReads = 0;
    const native = { projectInventory: async () => { inventoryReads += 1; return { projects: [] }; } };
    const policy = { ready: async () => true };
    const preconditions = root.selectorCommandPreconditions(
      native,
      policy,
      'selector',
      async () => false,
    );
    const met = await preconditions[0].check(new AbortController().signal);
    process.stdout.write(JSON.stringify({ met, inventoryReads }));
  `;
  const found = await execute(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    program,
  ]);
  assert.deepEqual(JSON.parse(found.stdout), { met: false, inventoryReads: 0 });
});

test("a running selector reports health until signal-driven shutdown", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    let passes = 0;
    let end;
    const settled = new Promise((resolve) => { end = resolve; });
    const running = setInterval(() => {}, 1000);
    const runtime = {
      start: async () => {
        passes += 1;
        process.stdout.write(JSON.stringify({ health: runtime.health(), passes }) + '\\n');
        return { started: 'Started' };
      },
      health: () => ({ live: true, ready: true }),
      settled: () => settled,
      stop: async () => {
        clearInterval(running);
        end({ live: true, ready: false });
        return { stopped: 'Stopped' };
      },
    };
    const result = await root.runSelector(runtime);
    process.stdout.write(JSON.stringify(result));
  `;
  const { code, stdout } = await signalledCommandRun(program, (out) =>
    out.includes("\n"),
  );
  assert.equal(code, 0);
  const newline = stdout.indexOf("\n");
  assert.deepEqual(JSON.parse(stdout.slice(0, newline)), {
    health: { live: true, ready: true },
    passes: 1,
  });
  assert.deepEqual(JSON.parse(stdout.slice(newline + 1)), {
    outcome: "Stopped",
    stop: { stopped: "Stopped" },
  });
});

test("a failed selector loop exits non-zero with its settled failure", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    const dead = { live: false, ready: false, failure: 'policy transport lost' };
    const runtime = {
      start: () => Promise.resolve({ started: 'Started' }),
      health: () => dead,
      settled: () => new Promise((resolve) => setTimeout(() => resolve(dead), 1)),
      stop: () => Promise.resolve({ stopped: 'Stopped' }),
    };
    const result = await root.selectorMain(process.env, () => runtime);
    if (result.diagnostic !== undefined) process.stderr.write(result.diagnostic + '\\n');
    process.exitCode = result.code;
  `;
  const found = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: validEnvironment,
    },
  ).catch((failure: unknown) => failure as CommandFailure);
  assert.equal("code" in found ? found.code : 0, 1);
  assert.equal(found.stderr, "selector failed: policy transport lost\n");
});

test("failure and signal overlap share one shutdown", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    let stopCalls = 0;
    const listeners = new Map();
    const signals = {
      once: (name, listener) => listeners.set(name, listener),
      removeListener: (name) => listeners.delete(name),
    };
    const dead = { live: false, ready: false, failure: 'lost source' };
    const runtime = {
      start: async () => ({ started: 'Started' }),
      health: () => dead,
      settled: () => {
        queueMicrotask(() => listeners.get('SIGTERM')?.());
        return Promise.resolve(dead);
      },
      stop: async () => {
        stopCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { stopped: 'Stopped' };
      },
    };
    const result = await root.runSelector(runtime, signals);
    process.stdout.write(JSON.stringify({ result, stopCalls }));
  `;
  const found = await execute(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    program,
  ]);
  assert.deepEqual(JSON.parse(found.stdout), {
    result: { outcome: "Failed", failure: "lost source" },
    stopCalls: 1,
  });
});

test("a cooldown that could never fire is a configuration refusal", async () => {
  const refused = await executeFailure({
    ...validEnvironment,
    CHUG_SELECTOR_CONFIG: JSON.stringify({
      ...validConfiguration,
      source: {
        ...validConfiguration.source,
        credential: {
          ...validConfiguration.source.credential,
          mintCooldownMs: validConfiguration.source.credential.refreshMarginMs,
        },
      },
    }),
  });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /^selector configuration:/u);
});
