import assert from "node:assert/strict";
import { test } from "node:test";

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
  const pool = postgresPool(apiUrl());
  const web = composeNativeWeb(
    pool,
    postgresHarnessKeying(),
    postgresProjectAccess(pool),
    postgresExecutionBacklogGuard(pool),
  );
  const app = createNativeHttpApp(
    web,
    { authenticateBearer: () => Promise.resolve({ principal }) },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
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
