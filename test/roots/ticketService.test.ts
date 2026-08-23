import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const command = ["--experimental-strip-types", "src/roots/ticketService.ts"];
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

const validConfiguration = {
  database: {
    url: "postgres://ticket-secret@127.0.0.1:1/chuggy",
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
  pass: { projectsPerPassMax: 1, projectLeaseSeconds: 10 },
  domain: {
    nTickets: 3,
    nTasks: 2,
    reworkPolicy: { type: "BudgetedRework", value: 1 },
    gas: 3,
    finalizationPricing: { type: "Budgeted", value: 1 },
    maxStages: 2,
  },
  owner: "ticket-service-1",
};

test("the command parses its complete plain-data configuration", async () => {
  const program = `
    const { ticketServiceConfiguration } = await import('./src/roots/ticketService.ts');
    process.stdout.write(JSON.stringify(ticketServiceConfiguration(process.env)));
  `;
  const found = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: { CHUG_TICKET_SERVICE_CONFIG: JSON.stringify(validConfiguration) },
    },
  );
  assert.deepEqual(JSON.parse(found.stdout), validConfiguration);
});

test("the command rejects a fractional finalization budget", async () => {
  const invalid = {
    ...validConfiguration,
    domain: {
      ...validConfiguration.domain,
      finalizationPricing: { type: "Budgeted", value: 0.5 },
    },
  };
  const found = await executeFailure({
    CHUG_TICKET_SERVICE_CONFIG: JSON.stringify(invalid),
  });
  assert.equal(found.code, 2);
  assert.equal(
    found.stderr,
    "ticket service configuration: CHUG_TICKET_SERVICE_CONFIG.domain.finalizationPricing is invalid\n",
  );
});

test("missing and malformed configuration have stable credential-free diagnostics", async () => {
  const missing = await executeFailure({});
  assert.equal(missing.code, 2);
  assert.equal(
    missing.stderr,
    "ticket service configuration: CHUG_TICKET_SERVICE_CONFIG is required\n",
  );
  const malformed = await executeFailure({
    CHUG_TICKET_SERVICE_CONFIG: '{"database":{"url":"secret"}}',
  });
  assert.equal(malformed.code, 2);
  assert.doesNotMatch(malformed.stderr, /secret/u);
  assert.match(malformed.stderr, /^ticket service configuration:/u);
});

test("an unavailable database is could-not-run rather than a crash", async () => {
  const found = await executeFailure({
    CHUG_TICKET_SERVICE_CONFIG: JSON.stringify(validConfiguration),
  });
  assert.equal(found.code, 3);
  assert.equal(
    found.stderr,
    "ticket service could not run: schema-compatible\n",
  );
});

test("SIGTERM drives bounded shutdown and preserves its result", async () => {
  const program = `
    const { runTicketService } = await import('./src/roots/ticketService.ts');
    const runtime = {
      start: async () => {
        process.stdout.write('ready\\n');
        return { started: 'Started' };
      },
      health: () => ({ live: true, ready: true }),
      stop: async () => ({ stopped: 'DrainExpired' }),
    };
    const result = await runTicketService(runtime);
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
    if (stdout.startsWith("ready\n")) ready();
  });
  await started;
  child.kill("SIGTERM");
  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.slice("ready\n".length)), {
    outcome: "Stopped",
    stop: { stopped: "DrainExpired" },
  });
});

test("a runtime failure produces a non-zero command result", async () => {
  const program = `
    const { ticketServiceMain } = await import('./src/roots/ticketService.ts');
    let live = true;
    const runtime = {
      start: () => {
        setTimeout(() => { live = false; }, 1);
        return Promise.resolve({ started: 'Started' });
      },
      health: () => live
        ? { live: true, ready: true }
        : { live: false, ready: false, failure: 'lost authority' },
      stop: () => Promise.resolve({ stopped: 'Stopped' }),
    };
    const result = await ticketServiceMain(process.env, () => runtime);
    if (result.diagnostic !== undefined) process.stderr.write(result.diagnostic + '\\n');
    process.exitCode = result.code;
  `;
  const found = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: { CHUG_TICKET_SERVICE_CONFIG: JSON.stringify(validConfiguration) },
    },
  ).catch((failure: unknown) => failure as CommandFailure);
  assert.equal("code" in found ? found.code : 0, 1);
  assert.equal(found.stderr, "ticket service failed: lost authority\n");
});
