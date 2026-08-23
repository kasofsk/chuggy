import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { test } from "node:test";

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
    bearerToken: "source-token",
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
      env: { CHUG_SELECTOR_CONFIG: JSON.stringify(validConfiguration) },
    },
  );
  assert.deepEqual(JSON.parse(found.stdout), {
    process: {
      database: validConfiguration.database,
      runtime: validConfiguration.runtime,
      selector: validConfiguration.selector,
    },
    identity: validConfiguration.identity,
    source: validConfiguration.source,
    policy: validConfiguration.policy,
  });
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
      env: { CHUG_SELECTOR_CONFIG: JSON.stringify(validConfiguration) },
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
    const runtime = {
      start: async () => {
        passes += 1;
        process.stdout.write(JSON.stringify({ health: runtime.health(), passes }) + '\\n');
        return { started: 'Started' };
      },
      health: () => ({ live: true, ready: true }),
      stop: async () => ({ stopped: 'Stopped' }),
    };
    const result = await root.runSelector(runtime);
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (stdout.includes("\n")) ready();
  });
  await started;
  child.kill("SIGTERM");
  const [code] = (await once(child, "exit")) as [number];
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

test("a failed selector loop exits non-zero with its health failure", async () => {
  const program = `
    const root = await import('./src/roots/selector.ts');
    let live = true;
    const runtime = {
      start: () => {
        setTimeout(() => { live = false; }, 1);
        return Promise.resolve({ started: 'Started' });
      },
      health: () => live
        ? { live: true, ready: true }
        : { live: false, ready: false, failure: 'policy transport lost' },
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
      env: { CHUG_SELECTOR_CONFIG: JSON.stringify(validConfiguration) },
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
    let inspected = false;
    const runtime = {
      start: async () => ({ started: 'Started' }),
      health: () => {
        if (!inspected) {
          inspected = true;
          queueMicrotask(() => listeners.get('SIGTERM')?.());
        }
        return { live: false, ready: false, failure: 'lost source' };
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
