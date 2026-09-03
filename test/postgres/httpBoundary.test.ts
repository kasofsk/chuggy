import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { nativeHttpMediaType } from "../../src/contract/http.ts";
import {
  leadInquiriesResponseSchema,
  leadInquiryAcceptedSchema,
  leadInquiryResponseSchema,
} from "../../src/contract/responses.ts";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectAccess } from "../../src/adapters/postgres/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessHeld,
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

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
function composedIngress() {
  const pool = postgresPool(apiUrl());
  const app = createNativeHttpApp(
    composeNativeWeb(
      pool,
      postgresHarnessKeying(),
      postgresProjectAccess(pool),
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
  await harness.query(
    `INSERT INTO project_membership
       (principal,tenant,project,authority_kind,authority_subject,
        may_read,may_mutate,may_dispatch,may_propose)
     VALUES ($1,$2,$3,'OidcUser','internal-user',true,true,true,true)`,
    [principal, partition.tenant, partition.project],
  );
  const { pool, app } = composedIngress();
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
    `SELECT enqueue_session_turn($1,$2,$3,$4,'Observation','observe')`,
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
  await harness.query(
    `INSERT INTO project_membership
       (principal,tenant,project,authority_kind,authority_subject,
        may_read,may_mutate,may_dispatch,may_propose)
     VALUES ($1,$2,$3,'OidcUser','internal-user',true,false,false,false)`,
    [principal, partition.tenant, partition.project],
  );
  await ingressLead(harness, partition);
  const { pool, app } = composedIngress();
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
          asker: "internal-user",
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
