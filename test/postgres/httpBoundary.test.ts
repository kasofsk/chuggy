import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type pg from "pg";

import type { ConfigurationOverrides } from "../../src/contract/configurationOverrides.ts";
import { nativeHttpMediaType } from "../../src/contract/http.ts";
import {
  draftInitializationResponseSchema,
  draftResponseSchema,
  leadInquiriesResponseSchema,
  leadInquiryAcceptedSchema,
  leadInquiryResponseSchema,
  ticketResponseSchema,
  type DraftResponse,
} from "../../src/contract/responses.ts";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { postgresPinnedConfigurations } from "../../src/adapters/postgres/pinnedConfigurations.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import { asConfigurationRevisionId } from "../../src/interpreter/authoring.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import type { ConfigurationPin } from "../../src/interpreter/projectDecision.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import {
  blessedPracticeCatalog,
  composeTaskInvocation,
} from "../../src/interpreter/taskBriefing.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessBinding,
  postgresHarnessConfiguration,
  postgresHarnessHeld,
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";
import { schedulerRolePool } from "./schedulerHarness.ts";

function apiUrl(): string {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${apiRole}`);
  return url.toString();
}

/**
 * The real composition behind a real server: the API's own pool, the boundary
 * `composeNativeWeb` builds over it, and the app the routes are registered on.
 * A suite here is about what that composition reaches, so nothing about it is
 * a double.
 */
function composedIngress(access: ProjectAccess) {
  const pool = postgresPool(apiUrl());
  const app = createNativeHttpApp(
    composeNativeWeb(
      pool,
      postgresHarnessKeying(),
      access,
      postgresExecutionBacklogGuard(pool),
    ),
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal },
        }),
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
  return { pool, app };
}

const principal = asPrincipal("oidc-principal");

function submissionBody(operation: string, mutation: string): string {
  return JSON.stringify({
    operation,
    mutation: { mutation, ticket: 1 },
  });
}

async function acceptAndRetry(
  address: string,
  harness: PostgresHarness,
  partition: Partition,
): Promise<string> {
  const root = `${address}/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
  const headers = {
    authorization: "Bearer token",
    "content-type": "application/vnd.chuggy.v1+json",
    "idempotency-key": "same-key",
  };
  const accepted = await fetch(`${root}/operations`, {
    method: "POST",
    headers,
    body: submissionBody("original-operation", "ResumeTicket"),
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {
    operation: "original-operation",
    state: "Pending",
  });
  assert.deepEqual(
    await harness.query(
      `SELECT i.state,p.head::text AS head
         FROM operation o JOIN project p USING (tenant,project)
         JOIN decision_input i ON i.tenant=o.tenant AND i.project=o.project
          AND i.input_kind='Operation' AND i.input_id=o.operation
        WHERE o.tenant=$1 AND o.project=$2 AND o.operation=$3`,
      [partition.tenant, partition.project, "original-operation"],
    ),
    [{ state: "Pending", head: "0" }],
  );
  const retry = await fetch(`${root}/operations`, {
    method: "POST",
    headers,
    body: submissionBody("retry-operation", "ResumeTicket"),
  });
  assert.deepEqual(await retry.json(), {
    operation: "original-operation",
    state: "Pending",
  });
  const conflict = await fetch(`${root}/operations`, {
    method: "POST",
    headers,
    body: submissionBody("conflict-operation", "RevokeTicket"),
  });
  assert.equal(conflict.status, 409);
  assert.doesNotMatch(await conflict.text(), /original-operation/u);
  return root;
}

test("real HTTP ingress accepts once and observes the separate writer", async () => {
  const harness = await postgresHarnessOpen();
  const partition = await postgresHarnessProject(
    harness.store,
    "http-boundary",
  );
  harness.access.grant({
    partition,
    principal,
    access: new Set(["Read", "Mutate", "DispatchTicket", "ProposeDispatch"]),
  });
  const { pool, app } = composedIngress(harness.access);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    assert.deepEqual(
      (await pool.query<{ role: string }>("SELECT current_user AS role")).rows,
      [{ role: apiRole }],
    );
    const root = await acceptAndRetry(address, harness, partition);
    const lease = await postgresHarnessHeld(harness.store, partition, "http");
    const input = await harness.discovery.next(partition, 300);
    assert.ok(input !== undefined);
    await projectWriterDecide(
      postgresHarnessWriter(harness),
      await projectWriterLoad(postgresHarnessWriter(harness), lease),
      input,
    );
    const observed = await fetch(`${root}/operations/original-operation`, {
      headers: { authorization: "Bearer token" },
    });
    assert.equal(observed.status, 200);
    assert.equal(
      ((await observed.json()) as { state: string }).state,
      "Refused",
    );
  } finally {
    await app.close();
    await pool.end();
    await harness.close();
  }
});

/**
 * A lead there is a transcript to fork: a runtime reference bound, one settled
 * turn and the batch it flushed. The rows are written directly because what
 * this suite is about is the ingress and not the plane that ordinarily writes
 * them.
 */
async function ingressLead(
  harness: PostgresHarness,
  partition: Partition,
): Promise<void> {
  const lead = `lead-http-inquiry-${randomUUID()}`;
  const turn = `lead-turn-http-inquiry-${randomUUID()}`;
  await harness.query(
    `SELECT open_agent_session($1,$2,$3,'Lead',$4,NULL,
              ARRAY['ProjectRead']::text[],'claude-code','you are the lead')`,
    [partition.tenant, partition.project, lead, "principal-lead"],
  );
  await harness.query(
    `SELECT enqueue_session_turn($1,$2,$3,$4,'Observation','observe','InCluster')`,
    [partition.tenant, partition.project, lead, turn],
  );
  await harness.query(
    `UPDATE agent_session SET agent_reference='runtime-http-inquiry'
      WHERE session=$1`,
    [lead],
  );
  await harness.query(
    `INSERT INTO session_store_batch
       (tenant,project,session,stream,batch,digest,bytes,events)
     VALUES ($1,$2,$3,'runtime-http-inquiry',1,$4,1,1)`,
    [partition.tenant, partition.project, lead, "a".repeat(64)],
  );
  await harness.query(
    `UPDATE session_turn SET state='Answered',result='decided',
            batch_first=1,batch_last=1,ended_at=now() WHERE turn=$1`,
    [turn],
  );
}

/** Admits the principal to ask and to list back: `Mutate` and `Read` on the project, and the tenant's hosted grant asking spends. */
function ingressAsker(harness: PostgresHarness, partition: Partition): void {
  harness.access.grant({
    partition,
    principal,
    access: new Set(["Read", "Mutate"]),
  });
  harness.access.grantTenant({
    tenant: partition.tenant,
    principal,
    access: new Set(["ExecuteHosted"]),
  });
}

/**
 * The inquiry routes over the REAL composition, because what
 * `test/adapters/httpLeadInquiries.test.ts` settles is the transport and what
 * this settles is that the routes reach a store at all: a boundary composed
 * without the port answers `500`, and a suite over a double would never see it.
 *
 * The lead is driven to a settled turn with a batch first, because that is the
 * head the door requires there be something to fork from.
 */
test("real HTTP ingress asks the lead a question and lists it back", async () => {
  const harness = await postgresHarnessOpen();
  const partition = await postgresHarnessProject(harness.store, "http-inquiry");
  ingressAsker(harness, partition);
  await ingressLead(harness, partition);
  const { pool, app } = composedIngress(harness.access);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const root = `${address}/api/v1/tenants/${partition.tenant}/projects/${partition.project}/lead/inquiries`;
  try {
    const inquiry = `inq-http-${randomUUID()}`;
    const asked = await fetch(root, {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": nativeHttpMediaType,
      },
      body: JSON.stringify({
        session: inquiry,
        turn: `inq-turn-http-${randomUUID()}`,
        question: "what stopped ticket 14?",
      }),
    });
    const accepted = await asked.text();
    assert.equal(asked.status, 202, accepted);
    assert.equal(
      leadInquiryAcceptedSchema.parse(JSON.parse(accepted)).session,
      inquiry,
    );

    const listed = await fetch(root, {
      headers: { authorization: "Bearer token" },
    });
    assert.equal(listed.status, 200);
    const page = leadInquiriesResponseSchema.parse(await listed.json());
    assert.deepEqual(
      page.inquiries.map(({ session, question, asker, mine }) => ({
        session,
        question,
        asker,
        mine,
      })),
      [
        {
          session: inquiry,
          question: "what stopped ticket 14?",
          asker: principal,
          mine: true,
        },
      ],
    );

    const one = await fetch(`${root}/${inquiry}`, {
      headers: { authorization: "Bearer token" },
    });
    assert.equal(one.status, 200);
    assert.equal(
      leadInquiryResponseSchema.parse(await one.json()).session,
      inquiry,
    );
  } finally {
    await app.close();
    await pool.end();
    await harness.close();
  }
});

/** The headers a member's request carries, the media type the API reads a body as among them. */
const ingressHeaders = {
  authorization: "Bearer token",
  "content-type": nativeHttpMediaType,
};

/** Files one draft through the real door with `intent` and reads it back over the wire. */
async function ingressDraft(
  root: string,
  revision: string,
  repository: string,
  intent: string,
  overrides?: ConfigurationOverrides,
): Promise<DraftResponse> {
  const initialized = await fetch(`${root}/draft-initializations/${revision}`, {
    headers: ingressHeaders,
  });
  assert.equal(initialized.status, 200);
  const { fence } = draftInitializationResponseSchema.parse(
    await initialized.json(),
  );
  const filed = await fetch(`${root}/drafts`, {
    method: "POST",
    headers: ingressHeaders,
    body: JSON.stringify({
      configurationRevision: revision,
      configurationDigest: fence.configurationDigest,
      expectedProjectSequence: fence.projectSequence,
      authoring: {
        dependencies: [...plainAuthoring.deps],
        program: plainAuthoring.prog,
      },
      brief: { intent, links: [], repository },
      ...(overrides === undefined ? {} : { overrides }),
    }),
  });
  const answered = await filed.text();
  assert.equal(filed.status, 201, answered);
  const draft = draftResponseSchema.parse(JSON.parse(answered));
  const read = await fetch(`${root}/drafts/${String(draft.ticket)}`, {
    headers: ingressHeaders,
  });
  assert.equal(read.status, 200);
  const held = draftResponseSchema.parse(await read.json());
  assert.equal(
    held.brief?.intent,
    intent,
    "the draft's row holds the intent as it was written",
  );
  assert.deepEqual(held.overrides, overrides);
  return draft;
}

/** Releases one draft through the real door, which is what freezes the brief a launch reads. */
async function ingressRelease(root: string, draft: DraftResponse) {
  const released = await fetch(`${root}/operations`, {
    method: "POST",
    headers: { ...ingressHeaders, "idempotency-key": `key-${randomUUID()}` },
    body: JSON.stringify({
      operation: `release-${randomUUID()}`,
      mutation: {
        mutation: "ReleaseDraft",
        ticket: draft.ticket,
        authoringVersion: draft.authoringVersion,
        configurationRevision: draft.configurationRevision,
      },
    }),
  });
  assert.equal(released.status, 202, await released.text());
}

/** The lines the launch of `ticket` is briefed with as the ticket's own words, composed as the scheduler composes them: from the brief and the pinned configuration its own credential reads. */
async function ingressBriefedIntent(
  scheduler: pg.Pool,
  partition: Partition,
  ticket: number,
  pin: ConfigurationPin,
): Promise<readonly string[] | undefined> {
  const brief = await postgresTicketBrief(scheduler).brief(partition, ticket);
  const pinned = await postgresPinnedConfigurations(scheduler).configuration(
    partition,
    { ...pin, ticket },
  );
  if (brief === undefined || pinned.read !== "Configuration")
    assert.fail("the released ticket has no brief or no pinned configuration");
  const composed = composeTaskInvocation(blessedPracticeCatalog, {
    purpose: "Work",
    pin,
    configuration: pinned.configuration,
    runtime: { changedFiles: [], handoff: [] },
    priorWorkReports: { reports: [] },
    priorEvaluationReports: { reports: [] },
    brief,
    grant: {
      tools: [],
      credentials: [],
      network: false,
      filesystem: "WriteWorkspace",
      mayCompleteTask: false,
    },
  });
  if (composed.composed !== "Composed")
    assert.fail(`the launch is blocked: ${composed.fault}`);
  return composed.invocation.briefing.sections.find(
    (section) => section.section === "TicketIntent",
  )?.lines;
}

/**
 * An intent as its author wrote it, one paragraph on one line and one of many
 * short lines, each past what a line and a count of lines used to admit.
 */
const ingressIntents = [
  [`${"word ".repeat(399)}words`],
  Array.from({ length: 40 }, (_, at) => `Line ${String(at)} of the statement.`),
];

/**
 * The whole way an intent goes, over the REAL composition: in at the door, into
 * the draft's row, out over the wire, through a release, and into the briefing
 * a launch composes from what the release froze. A suite over a double settles
 * each step and not that the same text survives all of them.
 */
test("real HTTP ingress admits an intent of one long line, and one of many lines, and a launch is briefed with each as written", async () => {
  const harness = await postgresHarnessOpen();
  const partition = await postgresHarnessProject(harness.store, "http-intent");
  harness.access.grant({
    partition,
    principal,
    access: new Set(["Read", "Mutate"]),
  });
  const repository = await postgresHarnessBinding(harness, partition);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  const configured = await harness.authoring.createConfiguration({
    partition,
    authority: postgresHarnessSubmission(partition, "http-intent").authority,
    revision,
    canonical: postgresHarnessConfiguration,
  });
  assert.equal(configured.created, "Created");
  const { pool, app } = composedIngress(harness.access);
  const scheduler = schedulerRolePool();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const root = `${address}/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
  try {
    const writer = postgresHarnessWriter(harness);
    let memory = await projectWriterLoad(
      writer,
      await postgresHarnessHeld(harness.store, partition, "http-intent"),
    );
    for (const lines of ingressIntents) {
      const draft = await ingressDraft(
        root,
        revision,
        repository,
        lines.join("\n"),
      );
      await ingressRelease(root, draft);
      const input = await harness.discovery.next(partition, 300);
      assert.ok(input !== undefined);
      const decision = await projectWriterDecide(writer, memory, input);
      memory = decision.memory;
      assert.equal(decision.decided.decided, "Committed");
      assert.deepEqual(
        await ingressBriefedIntent(scheduler, partition, draft.ticket, {
          configurationRevision: revision,
          configurationDigest:
            configured.created === "Created" ? configured.revision.digest : "",
        }),
        lines,
      );
    }
  } finally {
    await app.close();
    await scheduler.end();
    await pool.end();
    await harness.close();
  }
});

/**
 * The overrides a draft is filed with, over the REAL composition: in at the
 * door, back out with the draft, through a release, and out again with the
 * ticket's own read, which is what a ticket's page fetches.
 */
test("real HTTP ingress files a draft's overrides and a released ticket's read answers them", async () => {
  const harness = await postgresHarnessOpen();
  const partition = await postgresHarnessProject(
    harness.store,
    "http-overrides",
  );
  harness.access.grant({
    partition,
    principal,
    access: new Set(["Read", "Mutate"]),
  });
  const repository = await postgresHarnessBinding(harness, partition);
  const revision = asConfigurationRevisionId(`config-${randomUUID()}`);
  const configured = await harness.authoring.createConfiguration({
    partition,
    authority: postgresHarnessSubmission(partition, "http-overrides").authority,
    revision,
    canonical: postgresHarnessConfiguration,
  });
  assert.equal(configured.created, "Created");
  const { pool, app } = composedIngress(harness.access);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const root = `${address}/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
  const overrides = { work: { instructions: ["Do it this way."] } };
  try {
    const writer = postgresHarnessWriter(harness);
    const memory = await projectWriterLoad(
      writer,
      await postgresHarnessHeld(harness.store, partition, "http-overrides"),
    );
    const draft = await ingressDraft(
      root,
      revision,
      repository,
      "Do it.",
      overrides,
    );
    await ingressRelease(root, draft);
    const input = await harness.discovery.next(partition, 300);
    assert.ok(input !== undefined);
    assert.equal(
      (await projectWriterDecide(writer, memory, input)).decided.decided,
      "Committed",
    );
    const read = await fetch(`${root}/tickets/${String(draft.ticket)}`, {
      headers: ingressHeaders,
    });
    assert.equal(read.status, 200);
    assert.deepEqual(
      ticketResponseSchema.parse(await read.json()).overrides,
      overrides,
    );
  } finally {
    await app.close();
    await pool.end();
    await harness.close();
  }
});
