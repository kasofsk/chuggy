/**
 * What a run says of the account it spent, against a real server: the agent
 * an attempt's invocation names, the account its claim names, the latest
 * reading of each window and the limit a provider stopped a run at.
 *
 * EACH CASE DRIVES THE WORKER PLANE'S OWN ADAPTER as the plane's role, so the
 * reading arrives in the transaction its totals or its end does, and reads the
 * rows the owner can see.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { agentAccountCredentialsKeptMaxAt163 } from "../../src/adapters/postgres/schema/migrations/163-agent-account-credential.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerRunEnded,
  postgresWorkerRunTotal,
} from "../../src/adapters/postgres/workerPlane.ts";
import { workerRunCredentialDefaults } from "../../src/contract/workerPlane.ts";
import type {
  RunEndedEvidence,
  RunLimit,
  RunTotals,
  RunUsage,
} from "../../src/interpreter/runEvidence.ts";
import { postgresHarnessUrl } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerInvocation,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerRigOpen,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const workerUrl = new URL(postgresHarnessUrl());
workerUrl.searchParams.set("options", `-c role=${workerPlaneRole}`);
const workerPool = postgresPool(workerUrl.toString());

after(async () => {
  await workerPool.end();
  await rig.close();
});

const totals = postgresWorkerRunTotal(workerPool);
const endings = postgresWorkerRunEnded(workerPool);

const runTotals: RunTotals = {
  turns: 1,
  durationMs: 10,
  durationApiMs: 5,
  tokensInput: 1,
  tokensOutput: 2,
  tokensCacheCreation: 0,
  tokensCacheRead: 0,
  costUsdMicros: 7,
  costBasis: "List",
  models: [],
  permissionDenials: 0,
};

/** Unix seconds this many from now, which a reading or a limit names. */
const secondsFromNow = (offset: number) =>
  Math.floor(Date.now() / 1_000) + offset;

/** The worker configurations an invocation may carry, and the agent each spends. */
const workers = {
  Claude: {
    worker: {
      mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
      setup: [],
      files: [],
    },
    agent: "Claude",
  },
  Codex: {
    worker: {
      mode: {
        type: "SingleAgent",
        agent: "Codex",
        arguments: [],
        model: "model",
      },
      setup: [],
      files: [],
    },
    agent: "Codex",
  },
  Legacy: {
    worker: { arguments: ["--verbose"], setup: [], files: [] },
    agent: "Claude",
  },
  Commands: {
    worker: {
      mode: { type: "Commands", commands: ["just check"] },
      setup: [],
      files: [],
    },
    agent: null,
  },
  Missing: { worker: undefined, agent: null },
} as const;

type Worker = keyof typeof workers | "NotWritten";

/** Who claimed an attempt: a member's personal runner, a pool a member registered, a pool nobody did, or the cluster. */
type Claim =
  | {
      readonly by: "Personal";
      readonly owner: string;
      readonly benchesCredential?: boolean;
    }
  | { readonly by: "Pool"; readonly registeredBy: string | null }
  | { readonly by: "Cluster" };

/** One placed, live attempt on its own project, invoked with `worker` and claimed as `claim` says. */
async function spendingAttempt(label: string, worker: Worker, claim: Claim) {
  const project = await schedulerProject(rig, label);
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
  );
  const { attempt } = await schedulerPlacedAttempt(rig, project, label);
  const { tenant, project: partition } = attempt.partition;
  if (worker !== "NotWritten") {
    const configured = workers[worker].worker;
    await rig.harness.query(
      `UPDATE execution_attempt SET invocation=$2::jsonb WHERE attempt=$1`,
      [
        attempt.attempt,
        JSON.stringify(
          configured === undefined
            ? schedulerInvocation
            : { ...schedulerInvocation, worker: configured },
        ),
      ],
    );
  }
  const principal = `runner-${randomUUID()}`;
  switch (claim.by) {
    case "Personal":
      await rig.harness.query(
        `UPDATE execution_attempt SET pool=$2,pool_principal=$3,personal=true,assignment=$3,
            runner_benches_credential=$4
          WHERE attempt=$1`,
        [
          attempt.attempt,
          claim.owner,
          principal,
          claim.benchesCredential === true,
        ],
      );
      break;
    case "Pool":
      await rig.harness.query(
        `INSERT INTO worker_pool(tenant,project,pool,principal,client_id,class,registered_by)
         VALUES($1,$2,'pool',$3,$3,'Dedicated',$4)`,
        [tenant, partition, principal, claim.registeredBy],
      );
      await rig.harness.query(
        `UPDATE execution_attempt SET pool='pool',pool_principal=$2,assignment=$2 WHERE attempt=$1`,
        [attempt.attempt, principal],
      );
      break;
    case "Cluster":
      break;
  }
  return attempt;
}

type Attempt = Awaited<ReturnType<typeof spendingAttempt>>;

function totalsPosted(attempt: Attempt, usage: RunUsage) {
  return totals.record({
    secret: attempt.capability.secret,
    generation: attempt.generation,
    totals: runTotals,
    usage,
  });
}

function endPosted(
  attempt: Attempt,
  evidence: RunEndedEvidence,
  limit?: RunLimit,
) {
  return endings.end({
    secret: attempt.capability.secret,
    generation: attempt.generation,
    evidence,
    ...(limit === undefined ? {} : { limit }),
  });
}

/** Every reading kept of `principal`'s account, oldest window name first. */
async function readingsOf(principal: string) {
  return rig.harness.query(
    `SELECT agent,usage_window,utilization,
            extract(epoch FROM resets_at)::bigint::text AS resets_at,
            extract(epoch FROM observed_at)::bigint::text AS observed_at,
            attempt
       FROM agent_account_usage WHERE principal=$1
      ORDER BY agent,usage_window`,
    [principal],
  );
}

/** Every limit kept of `principal`'s account. */
async function limitsOf(principal: string) {
  return rig.harness.query(
    `SELECT agent,usage_window,
            extract(epoch FROM resets_at)::bigint::text AS resets_at,
            (observed_at<=now() AND observed_at>now()-interval '1 hour') AS received,
            attempt
       FROM agent_account_limit WHERE principal=$1 ORDER BY agent`,
    [principal],
  );
}

/** How many readings and limits are kept of every account, which an attempt spending none must add nothing to. */
async function accountRows(): Promise<readonly unknown[]> {
  return rig.harness.query(
    `SELECT (SELECT count(*) FROM agent_account_usage)::text AS readings,
            (SELECT count(*) FROM agent_account_limit)::text AS limits`,
  );
}

test("an attempt spends the agent its invocation names, Claude for the arguments that predate modes, and none for commands, no worker or no invocation", async () => {
  for (const [worker, agent] of [
    ...Object.entries(workers).map(
      ([name, held]) => [name as Worker, held.agent] as const,
    ),
    ["NotWritten", null] as const,
  ]) {
    const attempt = await spendingAttempt(
      `agent-${worker.toLowerCase()}`,
      worker,
      {
        by: "Cluster",
      },
    );
    assert.deepEqual(
      await rig.harness.query(
        "SELECT agent FROM execution_attempt WHERE attempt=$1",
        [attempt.attempt],
      ),
      [{ agent }],
      worker,
    );
  }
});

test("a personal runner's reading is kept under its owner and a registered pool's under the member who registered it", async () => {
  const owner = `owner-${randomUUID()}`;
  const member = `member-${randomUUID()}`;
  const resetsAt = secondsFromNow(3_600);
  const observedAt = secondsFromNow(-60);
  const personal = await spendingAttempt("account-personal", "Claude", {
    by: "Personal",
    owner,
  });
  const pooled = await spendingAttempt("account-pool", "Codex", {
    by: "Pool",
    registeredBy: member,
  });
  for (const attempt of [personal, pooled])
    assert.equal(
      await totalsPosted(attempt, {
        five_hour: { utilization: 0.25, resetsAt, observedAt },
      }),
      "Stored",
    );
  assert.deepEqual(await readingsOf(owner), [
    {
      agent: "Claude",
      usage_window: "five_hour",
      utilization: 0.25,
      resets_at: String(resetsAt),
      observed_at: String(observedAt),
      attempt: personal.attempt,
    },
  ]);
  assert.deepEqual(await readingsOf(member), [
    {
      agent: "Codex",
      usage_window: "five_hour",
      utilization: 0.25,
      resets_at: String(resetsAt),
      observed_at: String(observedAt),
      attempt: pooled.attempt,
    },
  ]);
});

test("an attempt with no account or no agent stores its totals and keeps no reading and no limit", async () => {
  const before = await accountRows();
  const reading = {
    seven_day: {
      utilization: 0.5,
      resetsAt: secondsFromNow(86_400),
      observedAt: secondsFromNow(-1),
    },
  };
  for (const [label, worker, claim] of [
    ["unaccounted-cluster", "Claude", { by: "Cluster" }],
    ["unaccounted-unregistered", "Claude", { by: "Pool", registeredBy: null }],
    [
      "unaccounted-commands",
      "Commands",
      { by: "Personal", owner: "owner-commands" },
    ],
    [
      "unaccounted-missing",
      "Missing",
      { by: "Personal", owner: "owner-missing" },
    ],
    [
      "unaccounted-unwritten",
      "NotWritten",
      { by: "Personal", owner: "owner-unwritten" },
    ],
  ] as const) {
    const attempt = await spendingAttempt(label, worker, claim);
    assert.equal(await totalsPosted(attempt, reading), "Stored", label);
    const ended = await spendingAttempt(`${label}-ended`, worker, claim);
    assert.equal(
      await endPosted(ended, "RunRateLimited", { window: "seven_day" }),
      true,
      label,
    );
  }
  assert.deepEqual(await accountRows(), before);
});

test("each window's reading is kept on its own, and one replaces it only where it was observed later, in either order", async () => {
  const owner = `owner-${randomUUID()}`;
  const claim = { by: "Personal", owner } as const;
  const resetsAt = secondsFromNow(3_600);
  const [earlier, later] = [secondsFromNow(-120), secondsFromNow(-60)];
  const first = await spendingAttempt("later-first", "Claude", claim);
  const second = await spendingAttempt("earlier-second", "Claude", claim);
  await totalsPosted(first, {
    five_hour: { utilization: 0.9, resetsAt, observedAt: later },
    seven_day: { utilization: 0.4, resetsAt, observedAt: later },
  });
  await totalsPosted(second, {
    five_hour: { utilization: 0.1, resetsAt, observedAt: earlier },
  });
  assert.deepEqual(
    (await readingsOf(owner)).map((row) => {
      const { usage_window, utilization, attempt } = row as {
        usage_window: string;
        utilization: number;
        attempt: string;
      };
      return [usage_window, utilization, attempt];
    }),
    [
      ["five_hour", 0.9, first.attempt],
      ["seven_day", 0.4, first.attempt],
    ],
  );

  const other = `owner-${randomUUID()}`;
  const otherClaim = { by: "Personal", owner: other } as const;
  const older = await spendingAttempt("earlier-first", "Claude", otherClaim);
  const newer = await spendingAttempt("later-second", "Claude", otherClaim);
  await totalsPosted(older, {
    seven_day: { utilization: 0.1, resetsAt, observedAt: earlier },
  });
  await totalsPosted(newer, {
    seven_day: { utilization: 0.95, resetsAt, observedAt: later },
  });
  assert.deepEqual(await readingsOf(other), [
    {
      agent: "Claude",
      usage_window: "seven_day",
      utilization: 0.95,
      resets_at: String(resetsAt),
      observed_at: String(later),
      attempt: newer.attempt,
    },
  ]);
});

test("a reading observed after it arrived is dated when it arrived", async () => {
  const owner = `owner-${randomUUID()}`;
  const attempt = await spendingAttempt("ahead", "Claude", {
    by: "Personal",
    owner,
  });
  const ahead = secondsFromNow(86_400);
  await totalsPosted(attempt, {
    five_hour: { utilization: 0.5, resetsAt: ahead, observedAt: ahead },
  });
  assert.deepEqual(
    await rig.harness.query(
      `SELECT observed_at<=now() AS clamped,
              observed_at>now()-interval '1 hour' AS recent
         FROM agent_account_usage WHERE principal=$1`,
      [owner],
    ),
    [{ clamped: true, recent: true }],
  );
});

test("a repeated totals post is already stored and leaves the reading it kept, and totals refused keep none", async () => {
  const owner = `owner-${randomUUID()}`;
  const attempt = await spendingAttempt("repeated", "Claude", {
    by: "Personal",
    owner,
  });
  const usage = {
    five_hour: {
      utilization: 0.3,
      resetsAt: secondsFromNow(3_600),
      observedAt: secondsFromNow(-30),
    },
  };
  assert.equal(await totalsPosted(attempt, usage), "Stored");
  const kept = await readingsOf(owner);
  assert.equal(await totalsPosted(attempt, usage), "AlreadyStored");
  assert.deepEqual(await readingsOf(owner), kept);
  assert.equal(
    await totals.record({
      secret: attempt.capability.secret,
      generation: attempt.generation,
      totals: { ...runTotals, turns: 2 },
      usage: {
        five_hour: {
          ...usage.five_hour,
          utilization: 1,
          observedAt: secondsFromNow(-1),
        },
      },
    }),
    "Conflict",
  );
  assert.deepEqual(await readingsOf(owner), kept);
});

test("a run ended rate limited keeps its limit with or without one named, and a run ended otherwise keeps none", async () => {
  const owner = `owner-${randomUUID()}`;
  const claim = { by: "Personal", owner } as const;
  const resetsAt = secondsFromNow(7_200);
  const named = await spendingAttempt("limit-named", "Claude", claim);
  assert.equal(
    await endPosted(named, "RunRateLimited", { window: "five_hour", resetsAt }),
    true,
  );
  assert.deepEqual(await limitsOf(owner), [
    {
      agent: "Claude",
      usage_window: "five_hour",
      resets_at: String(resetsAt),
      received: true,
      attempt: named.attempt,
    },
  ]);
  const unnamed = await spendingAttempt("limit-unnamed", "Claude", claim);
  assert.equal(await endPosted(unnamed, "RunRateLimited"), true);
  assert.deepEqual(await limitsOf(owner), [
    {
      agent: "Claude",
      usage_window: null,
      resets_at: null,
      received: true,
      attempt: unnamed.attempt,
    },
  ]);
  const windowOnly = await spendingAttempt("limit-window", "Codex", claim);
  assert.equal(
    await endPosted(windowOnly, "RunRateLimited", { window: "seven_day" }),
    true,
  );
  const resetOnly = await spendingAttempt("limit-reset", "Codex", claim);
  assert.equal(
    await endPosted(resetOnly, "RunRateLimited", { resetsAt }),
    true,
  );
  assert.deepEqual((await limitsOf(owner)).at(-1), {
    agent: "Codex",
    usage_window: null,
    resets_at: String(resetsAt),
    received: true,
    attempt: resetOnly.attempt,
  });

  const other = `owner-${randomUUID()}`;
  const failed = await spendingAttempt("limit-failed", "Claude", {
    by: "Personal",
    owner: other,
  });
  assert.equal(
    await endPosted(failed, "RunFailed", { window: "five_hour", resetsAt }),
    true,
  );
  assert.deepEqual(await limitsOf(other), []);
});

/** The limit kept against `attempt` alone, which is none where its run named neither a window nor a reset. */
async function attemptLimitOf(attempt: Attempt) {
  return rig.harness.query(
    `SELECT usage_window,extract(epoch FROM resets_at)::bigint::text AS resets_at
       FROM execution_attempt_limit WHERE attempt=$1`,
    [attempt.attempt],
  );
}

test("a run ended rate limited keeps the limit it named against its attempt, whoever claimed it, and keeps none where it named none", async () => {
  const resetsAt = secondsFromNow(3_600);
  const claims: readonly Claim[] = [
    { by: "Personal", owner: `owner-${randomUUID()}` },
    { by: "Personal", owner: `owner-${randomUUID()}`, benchesCredential: true },
    { by: "Pool", registeredBy: `member-${randomUUID()}` },
    { by: "Cluster" },
  ];
  for (const [index, claim] of claims.entries()) {
    const named = await spendingAttempt(`kept-${index}`, "Claude", claim);
    assert.equal(
      await endPosted(named, "RunRateLimited", {
        window: "seven_day",
        resetsAt,
      }),
      true,
    );
    assert.deepEqual(
      await attemptLimitOf(named),
      [{ usage_window: "seven_day", resets_at: String(resetsAt) }],
      claim.by,
    );
    const windowOnly = await spendingAttempt(
      `window-${index}`,
      "Claude",
      claim,
    );
    assert.equal(
      await endPosted(windowOnly, "RunRateLimited", { window: "five_hour" }),
      true,
    );
    assert.deepEqual(await attemptLimitOf(windowOnly), [
      { usage_window: "five_hour", resets_at: null },
    ]);
    const unnamed = await spendingAttempt(`unnamed-${index}`, "Claude", claim);
    assert.equal(await endPosted(unnamed, "RunRateLimited"), true);
    assert.deepEqual(await attemptLimitOf(unnamed), []);
  }
  const failed = await spendingAttempt("kept-failed", "Claude", {
    by: "Personal",
    owner: `owner-${randomUUID()}`,
    benchesCredential: true,
  });
  assert.equal(
    await endPosted(failed, "RunFailed", { window: "five_hour", resetsAt }),
    true,
  );
  assert.deepEqual(await attemptLimitOf(failed), []);
});

test("a limit benched by the personal runner that handed its job the credential pauses no account, where a pool's and an earlier runner's pause theirs as before", async () => {
  const resetsAt = secondsFromNow(7_200);
  const limit = { window: "five_hour", resetsAt } as const;
  const benching = `owner-${randomUUID()}`;
  const benched = await spendingAttempt("benched", "Claude", {
    by: "Personal",
    owner: benching,
    benchesCredential: true,
  });
  assert.equal(await endPosted(benched, "RunRateLimited", limit), true);
  assert.deepEqual(await limitsOf(benching), []);
  const earlier = `owner-${randomUUID()}`;
  const unbenched = await spendingAttempt("unbenched", "Claude", {
    by: "Personal",
    owner: earlier,
  });
  assert.equal(await endPosted(unbenched, "RunRateLimited", limit), true);
  assert.deepEqual(
    (await limitsOf(earlier)).map((kept) => kept["attempt"]),
    [unbenched.attempt],
  );
  const registrant = `member-${randomUUID()}`;
  const pooled = await spendingAttempt("pooled", "Claude", {
    by: "Pool",
    registeredBy: registrant,
  });
  assert.equal(await endPosted(pooled, "RunRateLimited", limit), true);
  assert.deepEqual(
    (await limitsOf(registrant)).map((kept) => kept["attempt"]),
    [pooled.attempt],
  );
});

test("only a personal runner's claim is recorded as benching its credential", async () => {
  const pooled = await spendingAttempt("bench-pool", "Claude", {
    by: "Pool",
    registeredBy: `member-${randomUUID()}`,
  });
  await assert.rejects(
    rig.harness.query(
      `UPDATE execution_attempt SET runner_benches_credential=true WHERE attempt=$1`,
      [pooled.attempt],
    ),
    /execution_attempt_benches_credential_is_personal/u,
  );
});

test("an ending the boundary refuses keeps no limit", async () => {
  const owner = `owner-${randomUUID()}`;
  const attempt = await spendingAttempt("limit-fenced", "Claude", {
    by: "Personal",
    owner,
  });
  assert.equal(
    await endings.end({
      secret: attempt.capability.secret,
      generation: attempt.generation + 1,
      evidence: "RunRateLimited",
      limit: { window: "five_hour" },
    }),
    false,
  );
  assert.equal(await endPosted(attempt, "RunRateLimited"), true);
  const kept = await limitsOf(owner);
  assert.equal(
    await endPosted(attempt, "RunRateLimited", { window: "seven_day" }),
    false,
  );
  assert.deepEqual(await limitsOf(owner), kept);
});

test("the worker plane reaches the account relations through their doors alone", async () => {
  for (const relation of ["agent_account_usage", "agent_account_limit"])
    assert.match(
      (await rig.harness.attemptAs(
        workerPlaneRole,
        `SELECT principal FROM ${relation}`,
      )) ?? "",
      /permission denied/u,
      relation,
    );
});

/** Each credential kept of `principal`'s account, what it keeps and the attempt each came from. */
async function credentialsOf(principal: string) {
  return rig.harness.query(
    `SELECT 'reading' AS kept,agent,credential,usage_window,utilization,attempt
       FROM agent_account_usage WHERE principal=$1
     UNION ALL
     SELECT 'limit',agent,credential,usage_window,NULL,attempt
       FROM agent_account_limit WHERE principal=$1
     ORDER BY kept DESC,agent,credential,usage_window`,
    [principal],
  );
}

function totalsNamed(attempt: Attempt, usage: RunUsage, credential: string) {
  return totals.record({
    secret: attempt.capability.secret,
    generation: attempt.generation,
    totals: runTotals,
    usage,
    credential,
  });
}

test("a reading under one credential replaces no other credential's reading, and a run naming none keeps its own under the agent's default", async () => {
  const owner = `owner-${randomUUID()}`;
  const claim = { by: "Personal", owner } as const;
  const resetsAt = secondsFromNow(3_600);
  const work = await spendingAttempt("credential-work", "Claude", claim);
  const home = await spendingAttempt("credential-home", "Claude", claim);
  const unnamed = await spendingAttempt("credential-none", "Claude", claim);
  const codex = await spendingAttempt("credential-codex", "Codex", claim);
  await totalsNamed(
    work,
    {
      five_hour: {
        utilization: 0.9,
        resetsAt,
        observedAt: secondsFromNow(-90),
      },
    },
    "work",
  );
  await totalsNamed(
    home,
    {
      five_hour: {
        utilization: 0.1,
        resetsAt,
        observedAt: secondsFromNow(-60),
      },
    },
    "home",
  );
  await totalsPosted(unnamed, {
    five_hour: { utilization: 0.5, resetsAt, observedAt: secondsFromNow(-30) },
  });
  await totalsPosted(codex, {
    five_hour: { utilization: 0.4, resetsAt, observedAt: secondsFromNow(-30) },
  });
  const kept = (
    agent: "Claude" | "Codex",
    credential: string,
    utilization: number,
    attempt: Attempt,
  ) => ({
    kept: "reading",
    agent,
    credential,
    usage_window: "five_hour",
    utilization,
    attempt: attempt.attempt,
  });
  assert.deepEqual(await credentialsOf(owner), [
    kept("Claude", workerRunCredentialDefaults.Claude, 0.5, unnamed),
    kept("Claude", "home", 0.1, home),
    kept("Claude", "work", 0.9, work),
    kept("Codex", workerRunCredentialDefaults.Codex, 0.4, codex),
  ]);
});

test("a limit is kept under the credential its run named, beside another credential's, and under the default where it named none", async () => {
  const owner = `owner-${randomUUID()}`;
  const claim = { by: "Personal", owner } as const;
  const work = await spendingAttempt("limit-work", "Claude", claim);
  const unnamed = await spendingAttempt("limit-none", "Claude", claim);
  assert.equal(
    await endPosted(work, "RunRateLimited", {
      window: "five_hour",
      credential: "work",
    }),
    true,
  );
  assert.equal(await endPosted(unnamed, "RunRateLimited"), true);
  assert.deepEqual(await credentialsOf(owner), [
    {
      kept: "limit",
      agent: "Claude",
      credential: workerRunCredentialDefaults.Claude,
      usage_window: null,
      utilization: null,
      attempt: unnamed.attempt,
    },
    {
      kept: "limit",
      agent: "Claude",
      credential: "work",
      usage_window: "five_hour",
      utilization: null,
      attempt: work.attempt,
    },
  ]);
  const benching = `owner-${randomUUID()}`;
  const benched = await spendingAttempt("limit-benched-named", "Claude", {
    by: "Personal",
    owner: benching,
    benchesCredential: true,
  });
  assert.equal(
    await endPosted(benched, "RunRateLimited", {
      window: "five_hour",
      credential: "work",
    }),
    true,
  );
  assert.deepEqual(await credentialsOf(benching), []);
  assert.deepEqual(await attemptLimitOf(benched), [
    { usage_window: "five_hour", resets_at: null },
  ]);
});

test("a door called at the arity of the release before the credential lands under the agent's default", async () => {
  const owner = `owner-${randomUUID()}`;
  const claim = { by: "Personal", owner } as const;
  const read = await spendingAttempt("old-arity-usage", "Claude", claim);
  const ended = await spendingAttempt("old-arity-limit", "Codex", claim);
  const digest = (attempt: Attempt) =>
    createHash("sha256")
      .update(attempt.capability.secret, "utf8")
      .digest("hex");
  const usage = {
    seven_day: {
      utilization: 0.2,
      resetsAt: secondsFromNow(3_600),
      observedAt: secondsFromNow(-10),
    },
  };
  await workerPool.query(
    "SELECT record_worker_run_usage($1,$2,$3::jsonb)::text",
    [digest(read), read.generation, JSON.stringify(usage)],
  );
  const client = await workerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT withdraw_worker_attempt($1,$2,'RunRateLimited')",
      [digest(ended), ended.generation],
    );
    await client.query("SELECT record_worker_run_limit($1,$2,$3,$4)::text", [
      digest(ended),
      ended.generation,
      "seven_day",
      null,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  assert.deepEqual(await credentialsOf(owner), [
    {
      kept: "reading",
      agent: "Claude",
      credential: workerRunCredentialDefaults.Claude,
      usage_window: "seven_day",
      utilization: 0.2,
      attempt: read.attempt,
    },
    {
      kept: "limit",
      agent: "Codex",
      credential: workerRunCredentialDefaults.Codex,
      usage_window: "seven_day",
      utilization: null,
      attempt: ended.attempt,
    },
  ]);
});

test("a credential arriving at the bound makes room by dropping the one observed least recently, and one already kept drops nothing", async () => {
  const owner = `owner-${randomUUID()}`;
  const claim = { by: "Personal", owner } as const;
  const planting = await rig.harness.begin();
  try {
    await planting.query("SET LOCAL session_replication_role=replica");
    for (let index = 0; index < agentAccountCredentialsKeptMaxAt163; index += 1)
      await planting.query(
        index % 2 === 0
          ? `INSERT INTO agent_account_usage
               (principal,agent,credential,usage_window,utilization,resets_at,observed_at,
                tenant,project,execution,attempt)
             VALUES($1,'Claude',$2,'five_hour',0.1,now()+interval '1 hour',
                    now()-make_interval(secs=>$3),'tenant','project','execution','attempt')`
          : `INSERT INTO agent_account_limit
               (principal,agent,credential,observed_at,tenant,project,execution,attempt)
             VALUES($1,'Claude',$2,now()-make_interval(secs=>$3),
                    'tenant','project','execution','attempt')`,
        [owner, `kept-${String(index)}`, 1_000 - index],
      );
    await planting.commit();
  } catch (error) {
    await planting.rollback();
    throw error;
  }
  const held = async () =>
    (await credentialsOf(owner)).map((row) => row["credential"]).sort();
  const before = await held();
  assert.equal(before.length, agentAccountCredentialsKeptMaxAt163);
  const resetsAt = secondsFromNow(3_600);
  const again = await spendingAttempt("bound-kept", "Claude", claim);
  await totalsNamed(
    again,
    {
      seven_day: { utilization: 0.3, resetsAt, observedAt: secondsFromNow(-5) },
    },
    "kept-0",
  );
  assert.deepEqual(
    [...new Set(await held())].sort(),
    [...new Set(before)].sort(),
  );
  const renamed = await spendingAttempt("bound-renamed", "Claude", claim);
  await totalsNamed(
    renamed,
    {
      five_hour: { utilization: 0.3, resetsAt, observedAt: secondsFromNow(-1) },
    },
    "renamed",
  );
  const after = new Set(await held());
  assert.equal(after.size, agentAccountCredentialsKeptMaxAt163);
  assert.ok(after.has("renamed"));
  assert.ok(!after.has("kept-1"), "the credential observed least recently");
  assert.ok(after.has("kept-0"), "refreshed, so no longer the stalest");
  const limited = await spendingAttempt("bound-limit", "Claude", claim);
  assert.equal(
    await endPosted(limited, "RunRateLimited", { credential: "another" }),
    true,
  );
  const last = new Set(await held());
  assert.equal(last.size, agentAccountCredentialsKeptMaxAt163);
  assert.ok(last.has("another"));
  assert.ok(!last.has("kept-2"));
});
