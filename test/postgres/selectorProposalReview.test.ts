/**
 * A lead's proposal held for approval, answered over the real API and carried
 * to the writer by the selector's own delivery path, so what is under test is
 * that a reviewer's answer reaches the ticket rather than only the row.
 *
 * Every pool here runs as the role a deployment binds it to: the API's, the
 * review role the API answers reviews through, and the selector service's.
 * The selector submits over HTTP as its own principal, exactly as its process
 * does, so an approval that the review role could write but the selector could
 * not deliver is a failure here and not a pass.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { nativeHttpClient } from "../../src/adapters/http/client.ts";
import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { postgresDispatchViews } from "../../src/adapters/postgres/dispatchViews.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresExecutionBacklogGuard,
  postgresExecutionContextRead,
} from "../../src/adapters/postgres/schedulerContext.ts";
import {
  apiRole,
  selectorControlRole,
  selectorProposalRetireFunction,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresSelectorProposalReviews,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import {
  composeNativeWeb,
  composeSelectorProposalReviews,
} from "../../src/compose.ts";
import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeHttpMediaType } from "../../src/contract/http.ts";
import { selectorProposalNotHeldCode } from "../../src/contract/rosters.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import {
  proposalCommand,
  type SelectorDecisionProposals,
  type SelectorStateStore,
} from "../../src/interpreter/selector.ts";
import {
  deliverPendingSelectorProposals,
  reconcileSubmittedSelectorProposals,
} from "../../src/interpreter/selectorDeliveryRuntime.ts";
import { selectorNativeSource } from "../../src/interpreter/selectorNativeSource.ts";
import { selectorOperationalContextRead } from "../../src/interpreter/selectorOperationalContext.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  postgresHarnessAccepted,
  postgresHarnessHistory,
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSelectorContext,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

const reviewer = asPrincipal("issuer reviewer");
const selector = asPrincipal("issuer selector");
const bearers = new Map([
  ["reviewer", reviewer],
  ["selector", selector],
]);

/** A pool as `role`, which gives up on a lock after `lockTimeout` where one is named. */
function rolePool(role: string, lockTimeout?: string) {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set(
    "options",
    `-c role=${role}${lockTimeout === undefined ? "" : ` -c lock_timeout=${lockTimeout}`}`,
  );
  return postgresPool(url.toString());
}

/** The API as a deployment composes it, its reviews under the review role. */
function servedApp(
  access: ReturnType<typeof memoryProjectAccess>,
  apiPool: ReturnType<typeof rolePool>,
  reviewPool: ReturnType<typeof rolePool>,
) {
  return createNativeHttpApp(
    composeNativeWeb(
      apiPool,
      postgresHarnessKeying(),
      access,
      postgresExecutionBacklogGuard(apiPool),
    ),
    {
      authenticateBearer: (token) => {
        const principal = bearers.get(token);
        return Promise.resolve(
          principal === undefined
            ? { authenticated: "InvalidToken" as const }
            : { authenticated: "Bearer" as const, bearer: { principal } },
        );
      },
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(apiPool),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    composeSelectorProposalReviews(reviewPool, access),
  );
}

/** The selector's door to the API listening at `address`, as its process builds it. */
function selectorSource(address: string) {
  return selectorNativeSource(
    nativeHttpClient({
      baseUrl: address,
      accessToken: {
        token: () => Promise.resolve("selector"),
        invalidate: () => undefined,
      },
      requestTimeoutMs: 10_000,
      responseBytesMax: 1_048_576,
    }),
    selector,
    {
      currentTimeEpochMs: () => Promise.resolve(Date.now()),
      currentInstant: () => Promise.resolve(new Date().toISOString()),
      decisionDeadline: () => new Promise<never>(() => undefined),
      operationalContext: () => Promise.resolve(postgresHarnessSelectorContext),
    },
  );
}

/** What the lead's next observation carries of its reviews, newest `count` of them. */
async function observedFeedback(
  apiPool: ReturnType<typeof rolePool>,
  reviewPool: ReturnType<typeof rolePool>,
  partition: Partition,
  count: number,
) {
  return (
    await selectorOperationalContextRead(
      postgresExecutionContextRead(apiPool),
      postgresSelectorProposalReviews(reviewPool),
      {
        now: () => ({
          instant: new Date().toISOString(),
          epochMilliseconds: Date.now(),
        }),
      },
      {
        reviewFeedbackMax: count,
        projectBacklogMax: 200,
        installationBacklogMax: 5_000,
      },
    ).context(partition)
  ).reviewFeedback;
}

/** The API listening, the selector's door to it, and the selector's state beside them. */
async function served(reviewing: ReadonlySet<ProjectAccessKind>) {
  const access = memoryProjectAccess();
  const apiPool = rolePool(apiRole);
  const reviewPool = rolePool(selectorReviewRole);
  const selectorPool = rolePool(selectorServiceRole);
  const app = servedApp(access, apiPool, reviewPool);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    apiPool,
    state: postgresSelectorState(selectorPool),
    source: selectorSource(address),
    address,
    feedback: (partition: Partition, count: number) =>
      observedFeedback(apiPool, reviewPool, partition, count),
    grant: (partition: Partition) => {
      access.grant({ partition, principal: reviewer, access: reviewing });
      access.grant({
        partition,
        principal: selector,
        access: new Set(["Read", "ProposeDispatch"]),
      });
    },
    close: async () => {
      await app.close();
      await Promise.all([apiPool.end(), reviewPool.end(), selectorPool.end()]);
    },
  };
}

type Served = Awaited<ReturnType<typeof served>>;

function projectUrl(on: Served, partition: Partition, path: string): string {
  return `${on.address}/api/v1/tenants/${partition.tenant}/projects/${partition.project}${path}`;
}

async function proposals(on: Served, partition: Partition) {
  const found = await fetch(projectUrl(on, partition, "/selector-proposals"), {
    headers: { authorization: "Bearer reviewer" },
  });
  return {
    status: found.status,
    body: found.status === 200 ? await found.json() : undefined,
  };
}

async function answer(
  on: Served,
  partition: Partition,
  decision: string,
  body: unknown,
) {
  const answered = await fetch(
    projectUrl(
      on,
      partition,
      `/selector-proposals/${encodeURIComponent(decision)}/review`,
    ),
    {
      method: "POST",
      headers: {
        authorization: "Bearer reviewer",
        "content-type": nativeHttpMediaType,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: answered.status,
    body: await answered.json(),
  };
}

/** A project with `releases` released tickets, readable by the reviewer and the selector. */
async function releasedProject(on: Served, label: string, releases = 1) {
  const partition = await postgresHarnessProject(harness.store, label);
  let memory = await postgresHarnessHistory(harness, partition, label, 1);
  for (let release = 1; release < releases; release += 1) {
    const step = await projectWriterDecide(
      postgresHarnessWriter(harness),
      memory,
      await postgresHarnessAccepted(
        harness,
        partition,
        `${label}-release-${String(release)}`,
        0,
      ),
    );
    assert.equal(step.decided.decided, "Committed");
    memory = step.memory;
  }
  on.grant(partition);
  const page = await postgresDispatchViews(on.apiPool).read(partition, {
    limit: 10,
  });
  assert.ok(page.result === "Page");
  assert.equal(page.candidates.length, releases);
  const candidate = page.candidates[0];
  assert.ok(candidate !== undefined);
  return { partition, memory, page, candidate };
}

type Released = Awaited<ReturnType<typeof releasedProject>>;

/** The project's first ticket dispatched by hand, which moves it past every proposal fenced before. */
async function manualDispatch(project: Released, label: string) {
  const input = await postgresHarnessAccepted(
    harness,
    project.partition,
    `${label}-manual`,
    1,
  );
  return (
    await projectWriterDecide(
      postgresHarnessWriter(harness),
      project.memory,
      input,
    )
  ).decided.decided;
}

/**
 * The lead's decision to dispatch the project's tickets, its first unless
 * others are named, recorded as its `revision`th under the reference given or
 * a fresh one.
 */
async function recordedDecision(
  on: Served,
  project: Released,
  label: string,
  revision: number,
  {
    candidates = [project.candidate],
    decision = `${label}-${randomUUID()}`,
  }: {
    readonly candidates?: Released["page"]["candidates"];
    readonly decision?: string;
  } = {},
) {
  const { partition, page } = project;
  const operationOf = (ticket: number) =>
    asOperationId(`${decision}-t${String(ticket)}`);
  const proposed: SelectorDecisionProposals = {
    interaction: {
      decision,
      partition,
      instructionsVersion: "instructions-1",
      instructions: "choose a dispatchable ticket",
      observedView: [],
      context: {
        handoffNote: {},
        operationalContext: postgresHarnessSelectorContext,
      },
      toolActivity: [],
      result: { dispatch: candidates.map((candidate) => candidate.ticket) },
      implementationRevision: "implementation-1",
      modelRevision: "model-1",
      policyRevision: "policy-1",
      accounting: { tokens: 1, durationMs: 1 },
      startedAt: "2026-10-01T12:00:00.000Z",
      completedAt: "2026-10-01T12:00:01.000Z",
    },
    fence: { settingsRevision: 1, projectSettingsRevision: 0 },
    deliveryMode: "ApprovalRequired",
    dispatches: candidates.map((candidate) => ({
      ticket: candidate.ticket,
      operation: operationOf(candidate.ticket),
      command: proposalCommand({
        ticket: candidate,
        token: page.token,
        selectorDecisionReference: decision,
      }),
    })),
  };
  const recorded = await on.state.record(proposed, {
    partition,
    notificationCursor: revision,
    revision,
    attention: "Monitoring",
    handoffNote: {},
  });
  assert.deepEqual(
    recorded.dispatched,
    candidates.map((candidate) => candidate.ticket),
  );
  return { decision, operation: operationOf(project.candidate.ticket) };
}

/**
 * A decision reference whose attempt is running on the project's whole page,
 * as the runtime allocates and starts one before its lead decides.
 */
async function runningDecision(
  pool: ReturnType<typeof rolePool>,
  project: Released,
) {
  const state = postgresSelectorState(pool);
  const decision = `running-${randomUUID()}`;
  assert.equal(
    await state.allocateAttempt(decision, project.partition, {
      concurrentDecisions: 2,
      selectionsPerMinute: 60,
      millisecondsPerDecision: 60_000,
    }),
    true,
  );
  await state.runningAttempt(
    decision,
    {
      token: project.page.token,
      candidates: project.page.candidates,
      refusals: [],
      notificationCursor: 0,
      changes: [],
      operationalContext: postgresHarnessSelectorContext,
      handoffNote: {},
      nextCandidateScan: { state: "Exhausted", token: project.page.token },
    },
    { settingsRevision: 1, projectSettingsRevision: 0 },
  );
  return decision;
}

/** A project whose lead's one decision is recorded and held. */
async function heldDecision(on: Served, label: string) {
  const project = await releasedProject(on, label);
  const recorded = await recordedDecision(on, project, label, 0);
  return {
    partition: project.partition,
    memory: project.memory,
    ticket: project.candidate.ticket,
    ...recorded,
  };
}

/** Each of a decision's rows as its state and its outcome read as JSON, in ticket order. */
async function deliveryRows(decision: string) {
  return (
    await harness.query(
      `SELECT state,outcome::jsonb AS outcome FROM selector_proposal_delivery
        WHERE selector_decision=$1 ORDER BY ticket`,
      [decision],
    )
  ).map((row) => [row["state"], row["outcome"]]);
}

async function deliveryRow(decision: string) {
  const [row] = await harness.query(
    `SELECT state,outcome FROM selector_proposal_delivery
      WHERE selector_decision=$1`,
    [decision],
  );
  return row;
}

/** Everything the selector runtime does in one pass over deliveries, as the selector. */
async function selectorPass(state: SelectorStateStore, on: Served) {
  return {
    delivered: (await deliverPendingSelectorProposals(state, on.source, 10))
      .delivered,
    reconciled: (
      await reconcileSubmittedSelectorProposals(state, on.source, 10)
    ).reconciled,
  };
}

async function writerTurn(partition: Partition, memory: ProjectMemory) {
  const input = await harness.discovery.next(partition, 300);
  assert.ok(input !== undefined, "the submitted dispatch reached no writer");
  return (
    await projectWriterDecide(postgresHarnessWriter(harness), memory, input)
  ).decided.decided;
}

/** The approved dispatch sent by the selector, committed by the writer, and settled as the ticket's operation. */
async function assertLanded(
  on: Served,
  held: Awaited<ReturnType<typeof heldDecision>>,
) {
  assert.equal(
    (await deliverPendingSelectorProposals(on.state, on.source, 10)).delivered,
    1,
  );
  assert.equal(await writerTurn(held.partition, held.memory), "Committed");
  assert.equal(
    (await reconcileSubmittedSelectorProposals(on.state, on.source, 10))
      .reconciled,
    1,
  );
  const row = await deliveryRow(held.decision);
  assert.equal(row?.["state"], "Terminal");
  assert.equal(
    (JSON.parse(String(row?.["outcome"])) as { state: string }).state,
    "Succeeded",
  );
  const operation = await fetch(
    projectUrl(on, held.partition, `/operations/${held.operation}`),
    { headers: { authorization: "Bearer reviewer" } },
  );
  assert.equal(
    ((await operation.json()) as { state: string }).state,
    "Succeeded",
  );
}

test("an approved proposal is delivered, and its ticket's dispatch lands", async () => {
  const on = await served(new Set(["Read", "DispatchTicket"]));
  try {
    const held = await heldDecision(on, "proposal-approved");
    assert.equal(
      (await deliveryRow(held.decision))?.["state"],
      "AwaitingApproval",
    );
    assert.deepEqual(
      await selectorPass(on.state, on),
      { delivered: 0, reconciled: 0 },
      "a held proposal is not the selector's to send",
    );
    const listed = await proposals(on, held.partition);
    assert.equal(listed.status, 200);
    assert.deepEqual(
      nativeHttpEndpoints.selectorProposals.response.parse(listed.body),
      {
        proposals: [{ decision: held.decision, tickets: [held.ticket] }],
        more: false,
      },
    );
    const approved = await answer(on, held.partition, held.decision, {
      outcome: "Approved",
      feedback: "ship it",
    });
    assert.deepEqual(approved, {
      status: 200,
      body: { decision: held.decision, outcome: "Approved" },
    });
    assert.deepEqual((await proposals(on, held.partition)).body, {
      proposals: [],
      more: false,
    });
    await assertLanded(on, held);
    assert.deepEqual(
      (await on.feedback(held.partition, 10)).map((review) => ({
        decision: review.selectorDecision,
        outcome: review.outcome,
        reviewer: review.reviewer,
        feedback: review.feedback,
      })),
      [
        {
          decision: held.decision,
          outcome: "Approved",
          reviewer: memberAuthority(reviewer),
          feedback: "ship it",
        },
      ],
    );
  } finally {
    await on.close();
  }
});

test("a rejected proposal ends unsent, and the lead reads why", async () => {
  const on = await served(new Set(["Read", "DispatchTicket"]));
  try {
    const held = await heldDecision(on, "proposal-rejected");
    const rejected = await answer(on, held.partition, held.decision, {
      outcome: "Rejected",
      feedback: "not before the migration",
    });
    assert.equal(rejected.status, 200);
    const row = await deliveryRow(held.decision);
    assert.equal(row?.["state"], "Terminal");
    assert.deepEqual(JSON.parse(String(row?.["outcome"])), {
      state: "RejectedByUser",
      feedback: "not before the migration",
    });
    assert.deepEqual(await selectorPass(on.state, on), {
      delivered: 0,
      reconciled: 0,
    });
    const operation = await fetch(
      projectUrl(on, held.partition, `/operations/${held.operation}`),
      { headers: { authorization: "Bearer reviewer" } },
    );
    assert.equal(
      operation.status,
      404,
      "a rejected dispatch is never submitted",
    );
    assert.deepEqual(
      (await on.feedback(held.partition, 10)).map((review) => [
        review.outcome,
        review.feedback,
      ]),
      [["Rejected", "not before the migration"]],
    );
    const again = await answer(on, held.partition, held.decision, {
      outcome: "Approved",
    });
    assert.equal(again.status, 409);
    assert.equal(
      (again.body as { error: { code: string } }).error.code,
      selectorProposalNotHeldCode,
    );
  } finally {
    await on.close();
  }
});

test("a reader who may not dispatch neither sees nor answers a held proposal", async () => {
  const on = await served(new Set(["Read", "ProposeDispatch"]));
  try {
    const held = await heldDecision(on, "proposal-stranger");
    assert.equal((await proposals(on, held.partition)).status, 404);
    const answered = await answer(on, held.partition, held.decision, {
      outcome: "Approved",
    });
    assert.equal(answered.status, 404);
    assert.equal(
      (await deliveryRow(held.decision))?.["state"],
      "AwaitingApproval",
    );
  } finally {
    await on.close();
  }
});

/**
 * The lead's observation carries a bounded window of reviews, and the window
 * is the newest: a project reviewed more times than the bound would otherwise
 * show its lead the same oldest answers forever.
 */
test("the lead's observation carries the newest reviews", async () => {
  const on = await served(new Set(["Read", "DispatchTicket"]));
  try {
    const project = await releasedProject(on, "proposal-window");
    const partition = project.partition;
    const earlier = await recordedDecision(on, project, "window-earlier", 0);
    const later = await recordedDecision(on, project, "window-later", 1);
    for (const [held, feedback] of [
      [earlier, "older"],
      [later, "newer"],
    ] as const) {
      const rejected = await answer(on, partition, held.decision, {
        outcome: "Rejected",
        feedback,
      });
      assert.equal(rejected.status, 200);
    }
    assert.deepEqual(
      (await on.feedback(partition, 1)).map((review) => review.feedback),
      ["newer"],
    );
    assert.deepEqual(
      (await on.feedback(partition, 10)).map((review) => review.feedback),
      ["older", "newer"],
      "the window is read in the order the reviews were given",
    );
  } finally {
    await on.close();
  }
});

/** What the writer ends a held decision with when it moves one of its tickets. */
const moved = { state: "SelectionChanged" };

/**
 * A held decision is withdrawn whole by the writer's decision that moves one
 * of its tickets: the Inbox stops offering it, either answer is stale and
 * reaches the lead as nothing, and the ticket it did not move is the lead's
 * to propose again.
 */
test("a held decision whose ticket moves is withdrawn, and answering it is stale", async () => {
  const on = await served(new Set(["Read", "DispatchTicket"]));
  try {
    const project = await releasedProject(on, "proposal-moved", 2);
    const { partition } = project;
    const tickets = project.page.candidates.map(
      (candidate) => candidate.ticket,
    );
    const [, untouched] = tickets;
    assert.ok(untouched !== undefined);
    const held = await recordedDecision(on, project, "proposal-moved", 0, {
      candidates: project.page.candidates,
    });
    assert.deepEqual(
      [...(await on.state.heldAmong(partition, tickets))].sort(
        (left, right) => left - right,
      ),
      tickets,
    );
    assert.deepEqual(await on.state.heldAmong(partition, [untouched]), [
      untouched,
    ]);
    assert.equal(await manualDispatch(project, "proposal-moved"), "Committed");
    assert.deepEqual((await proposals(on, partition)).body, {
      proposals: [],
      more: false,
    });
    for (const outcome of ["Approved", "Rejected"]) {
      const answered = await answer(on, partition, held.decision, {
        outcome,
        feedback: "too late",
      });
      assert.equal(answered.status, 409, outcome);
      assert.equal(
        (answered.body as { error: { code: string } }).error.code,
        selectorProposalNotHeldCode,
      );
    }
    assert.deepEqual(await deliveryRows(held.decision), [
      ["Terminal", moved],
      ["Terminal", moved],
    ]);
    assert.deepEqual(await on.feedback(partition, 10), []);
    assert.deepEqual(await on.state.heldAmong(partition, tickets), []);
  } finally {
    await on.close();
  }
});

/** A decision naming a ticket that moved while its lead decided is ended as it is recorded. */
test("a decision recorded after its ticket moved is never held", async () => {
  const on = await served(new Set(["Read", "DispatchTicket"]));
  try {
    const project = await releasedProject(on, "proposal-late");
    assert.equal(await manualDispatch(project, "proposal-late"), "Committed");
    const late = await recordedDecision(on, project, "proposal-late", 0);
    assert.deepEqual(await deliveryRows(late.decision), [["Terminal", moved]]);
    assert.deepEqual((await proposals(on, project.partition)).body, {
      proposals: [],
      more: false,
    });
  } finally {
    await on.close();
  }
});

/**
 * The writer holds its project's row for the whole of a decision, and an
 * answer and a held record each wait for it, which is what orders both
 * against every move of the project's tickets.
 */
test("an answer and a held record wait for the writer's decision in flight", async () => {
  const on = await served(new Set(["Read", "DispatchTicket"]));
  const impatientReview = rolePool(selectorReviewRole, "100ms");
  const impatientSelector = rolePool(selectorServiceRole, "100ms");
  try {
    const project = await releasedProject(on, "proposal-ordered");
    const held = await recordedDecision(on, project, "proposal-ordered", 0);
    const next = await runningDecision(impatientSelector, project);
    const writer = await harness.begin();
    try {
      await writer.query(
        `SELECT 1 FROM project WHERE tenant=$1 AND project=$2 FOR UPDATE`,
        [project.partition.tenant, project.partition.project],
      );
      await assert.rejects(
        postgresSelectorProposalReviews(impatientReview).approve(
          project.partition,
          held.decision,
          memberAuthority(reviewer),
        ),
        /lock timeout/,
      );
      await assert.rejects(
        recordedDecision(
          { ...on, state: postgresSelectorState(impatientSelector) },
          project,
          "proposal-ordered-next",
          1,
          { decision: next },
        ),
        /lock timeout/,
      );
    } finally {
      await writer.rollback();
    }
    assert.deepEqual(await deliveryRows(held.decision), [
      ["AwaitingApproval", null],
    ]);
  } finally {
    await Promise.all([impatientReview.end(), impatientSelector.end()]);
    await on.close();
  }
});

/** Ending a held decision is the writer's and the selector's to do, and no other role's. */
test("the retirement is pinned, world-revoked, and the writer's and the selector's alone", async () => {
  const identity = `${selectorProposalRetireFunction}(text,text)`;
  assert.deepEqual(
    await harness.query(
      `SELECT prosecdef AS definer,array_to_string(proconfig,',') AS settings,
              EXISTS(SELECT 1 FROM aclexplode(proacl) entry
                      WHERE entry.grantee=0) AS world
         FROM pg_proc WHERE oid=$1::regprocedure`,
      [identity],
    ),
    [
      {
        definer: true,
        settings: "search_path=pg_catalog, public, pg_temp",
        world: false,
      },
    ],
  );
  const able: string[] = [];
  for (const role of [
    apiRole,
    selectorControlRole,
    selectorReviewRole,
    selectorServiceRole,
    ticketServiceRole,
  ]) {
    const [granted] = await harness.query(
      `SELECT has_function_privilege($1,$2::regprocedure,'EXECUTE') AS held`,
      [role, identity],
    );
    if (granted?.["held"] === true) able.push(role);
  }
  assert.deepEqual(able, [selectorServiceRole, ticketServiceRole]);
});
