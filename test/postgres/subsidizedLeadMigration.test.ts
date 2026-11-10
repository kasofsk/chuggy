/**
 * 144 gives every project's stored session placement the `Own` lead offering,
 * and leaves each project's lead admitted as it was.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { postgresLeadRouteReads } from "../../src/adapters/postgres/sessionPlacement.ts";
import { migration144 } from "../../src/adapters/postgres/schema/migrations/144-subsidized-lead.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  leadAdmission,
  type LeadRouteAdmission,
} from "../../src/interpreter/sessionPlacement.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";

const tenant = asTenantId("tenant-144");
const projects = ["project-cluster", "project-pool"].map(asProjectId);
const lead = asPrincipal("principal-lead-144");

/** Writes rows past their references, which a case about one table's rows has no use for. */
async function subsidizedLeadPlanted(
  subject: pg.Pool,
  statement: string,
): Promise<void> {
  const planting = await subject.connect();
  try {
    await planting.query("BEGIN");
    await planting.query("SET LOCAL session_replication_role=replica");
    await planting.query(statement);
    await planting.query("COMMIT");
  } finally {
    planting.release();
  }
}

/** Each project's lead admission, under a tenant that grants the lead hosted runs. */
async function subsidizedLeadAdmissions(
  subject: pg.Pool,
): Promise<readonly LeadRouteAdmission[]> {
  const access = memoryProjectAccess();
  access.grantTenant({
    tenant,
    principal: lead,
    access: new Set(["ExecuteHosted"]),
  });
  const routes = postgresLeadRouteReads(subject);
  const admitted: LeadRouteAdmission[] = [];
  for (const project of projects)
    admitted.push(
      await leadAdmission(access, routes, lead, { tenant, project }),
    );
  return admitted;
}

test("144 reads every stored placement's lead offering as its own, and admits each lead as before", async () => {
  await migrationDatabase("subsidized_lead", async (subject) => {
    await migratedBefore(subject, migration144.version);
    await subsidizedLeadPlanted(
      subject,
      `INSERT INTO project_session_placement(tenant,project,thread_route,lead_route)
       VALUES('tenant-144','project-cluster','Pool','InCluster'),
             ('tenant-144','project-pool','InCluster','Pool')`,
    );
    const before = await subsidizedLeadAdmissions(subject);

    assert.ok((await postgresMigrate(subject)).includes(migration144.version));
    const offerings = await subject.query<{
      project: string;
      lead_offering: string;
      resolved: string | null;
    }>(
      `SELECT p.project,p.lead_offering,
              session_lead_offering(p.tenant,p.project) AS resolved
         FROM project_session_placement p
        WHERE p.tenant='tenant-144' ORDER BY p.project`,
    );
    assert.deepEqual(offerings.rows, [
      { project: "project-cluster", lead_offering: "Own", resolved: "Own" },
      { project: "project-pool", lead_offering: "Own", resolved: "Own" },
    ]);
    assert.deepEqual(await subsidizedLeadAdmissions(subject), before);
    assert.deepEqual(before, [
      { admission: "Admitted", route: "InCluster" },
      { admission: "RunnerOffline" },
    ]);
  });
});
