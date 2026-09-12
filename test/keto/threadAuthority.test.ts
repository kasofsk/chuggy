/**
 * The thread routes over a real database AND a real authority, which is the
 * one composition a deployment actually runs.
 *
 * WHAT NEITHER HALF CAN ANSWER ALONE. `test/postgres/threadHttpDoors.test.ts`
 * drives the same routes against a project access held in memory, and
 * `./projectAccess.test.ts` drives the authority with no rows behind it.
 * Whether a thread's owner is derived from a tuple the authority actually
 * holds, and what a route answers while the authority is unreachable, are
 * claims about the join and about nothing either suite composes.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { nativeHttpMediaType } from "../../src/contract/http.ts";
import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import {
  threadEntryResponseSchema,
  threadsResponseSchema,
} from "../../src/contract/responses.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { projectPrincipalGrant } from "../../src/interpreter/projectGrant.ts";
import { sessionStoreDouble } from "../postgres/storeDouble.ts";
import {
  threadRigApp,
  threadRigOpen,
  threadRigProject,
  type ThreadRig,
} from "../postgres/threadHarness.ts";
import {
  ketoHarnessAccess,
  ketoHarnessAccessAt,
  ketoHarnessGrants,
  ketoHarnessIssuer,
} from "./harness.ts";

let rig: ThreadRig;

before(async () => {
  rig = await threadRigOpen();
});

after(async () => {
  await rig.close();
});

const grants = ketoHarnessGrants();
const storeReads = sessionStoreDouble();
const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };

/** The app the routes are driven through, under a project access a case names. */
function threadApp(principal: Principal, access: ProjectAccess) {
  return threadRigApp({ rig, principal, access, store: storeReads });
}

function pathOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}/threads`;
}

/** A project, and one principal the authority admits to it as a developer. */
async function admittedMember(
  label: string,
): Promise<{ partition: Partition; principal: Principal; subject: string }> {
  const partition = await threadRigProject(rig, `keto-${label}`);
  const subject = `member-${label}-${randomUUID()}`;
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      project: partition.project,
      relation: "developers",
    }),
  );
  return {
    partition,
    principal: oidcPrincipal(ketoHarnessIssuer, subject),
    subject,
  };
}

test("a thread's owner is the principal a tuple in the authority admits", async () => {
  const { partition, principal } = await admittedMember("owner");
  await using app = threadApp(principal, ketoHarnessAccess());
  const opened = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {},
  });
  assert.equal(opened.statusCode, 201, opened.body);
  const entry = threadEntryResponseSchema.parse(opened.json());
  assert.equal(entry.owner, principal);
  assert.equal(entry.state, "Open");
});

test("a thread whose principal the authority no longer admits stands orphaned", async () => {
  const { partition, principal, subject } = await admittedMember("orphan");
  const reader = await admittedMember("orphan-reader");
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: reader.subject,
      tenant: partition.tenant,
      project: partition.project,
      relation: "developers",
    }),
  );
  await using owning = threadApp(principal, ketoHarnessAccess());
  const opened = await owning.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {},
  });
  assert.equal(opened.statusCode, 201, opened.body);
  const entry = threadEntryResponseSchema.parse(opened.json());

  await grants.remove(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      tenant: partition.tenant,
      project: partition.project,
      relation: "developers",
    }),
  );
  await using reading = threadApp(reader.principal, ketoHarnessAccess());
  const listed = await reading.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const listing = threadsResponseSchema.parse(listed.json());
  assert.deepEqual(
    listing.threads.map((thread) => [
      thread.session,
      thread.owner,
      thread.state,
    ]),
    [[entry.session, undefined, "Orphaned"]],
  );
});

test("an authority that cannot be reached answers 503 and never falls open", async () => {
  const { partition, principal } = await admittedMember("outage");
  await using app = threadApp(
    principal,
    ketoHarnessAccessAt("http://127.0.0.1:1/"),
  );
  const asked = await app.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.equal(asked.statusCode, 503, asked.body);
  assert.equal(
    asked.json<HttpErrorEnvelope>().error.code,
    "AuthorityUnavailable",
  );
  assert.equal(asked.headers["retry-after"], "1");
});
