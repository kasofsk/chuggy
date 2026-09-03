/**
 * What the session migrations' grants let each role do, asked of the server
 * rather than read off the DDL. Every function here is granted to exactly one
 * role, so each case asserts the grant and every refusal beside it.
 *
 * THE NEGATIVE SPACE IS THE CONTROL. A grant nobody exercised and a revoke
 * nobody attempted are both unverified, and the shape that would go unnoticed
 * is a table privilege on a relation every move against which is supposed to be
 * a function — so each relation is attempted by every verb, as every role.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  repositoryBindingReadFunction,
  schedulerRole,
  selectorServiceRole,
  sessionAttemptBindingFunction,
  sessionAttemptCleanupCompletedFunction,
  sessionAttemptCleanupFunction,
  sessionAttemptEndFunction,
  sessionAttemptFenceFunction,
  sessionAttemptHeartbeatFunction,
  sessionAttemptLoseFunction,
  sessionAttemptOpenFunction,
  sessionAttemptPlaceFunction,
  sessionAttemptReadFunction,
  sessionAttemptReapIdleFunction,
  sessionAttemptReapLapsedFunction,
  sessionAttemptWithdrawFunction,
  projectThreadsReadFunction,
  sessionBearerAuthenticateFunction,
  sessionCapabilitiesSetFunction,
  sessionCloseFunction,
  sessionOpenFunction,
  sessionReferenceBindFunction,
  sessionStoreBatchRecordFunction,
  sessionStoreBatchesReadFunction,
  sessionStoreReadFunction,
  sessionStoreStreamListFunction,
  sessionStreamListFunction,
  sessionSystemPromptSetFunction,
  sessionTurnAnswerFunction,
  sessionTurnClaimFunction,
  sessionTurnEnqueueFunction,
  sessionTurnFailFunction,
  sessionTurnReleaseFunction,
  sessionsAwaitingPlacementFunction,
  threadMessageEnqueueFunction,
  threadOpenFunction,
  threadStandingReadFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

/**
 * Every session boundary beside the one role it is granted to. The owner-only
 * ones carry no role: they are provisioning, and no runtime credential may open
 * a session or feed one a turn.
 */
const boundaries: readonly (readonly [string, string | undefined])[] = [
  [sessionOpenFunction, undefined],
  [sessionCloseFunction, undefined],
  [sessionTurnEnqueueFunction, undefined],
  [sessionTurnReleaseFunction, undefined],
  [sessionsAwaitingPlacementFunction, schedulerRole],
  [sessionAttemptOpenFunction, schedulerRole],
  [sessionAttemptPlaceFunction, schedulerRole],
  [sessionAttemptEndFunction, schedulerRole],
  [sessionAttemptReapLapsedFunction, schedulerRole],
  [sessionAttemptReapIdleFunction, schedulerRole],
  [sessionAttemptFenceFunction, schedulerRole],
  [sessionAttemptCleanupFunction, schedulerRole],
  [sessionAttemptCleanupCompletedFunction, schedulerRole],
  [sessionAttemptBindingFunction, workerPlaneRole],
  [sessionAttemptReadFunction, workerPlaneRole],
  [sessionAttemptHeartbeatFunction, workerPlaneRole],
  [sessionAttemptLoseFunction, workerPlaneRole],
  [sessionAttemptWithdrawFunction, workerPlaneRole],
  [sessionReferenceBindFunction, workerPlaneRole],
  [sessionTurnClaimFunction, workerPlaneRole],
  [sessionTurnAnswerFunction, workerPlaneRole],
  [sessionTurnFailFunction, workerPlaneRole],
  [sessionStoreBatchRecordFunction, workerPlaneRole],
  [sessionStoreReadFunction, workerPlaneRole],
  [sessionStreamListFunction, workerPlaneRole],
  [sessionBearerAuthenticateFunction, apiRole],
  [sessionSystemPromptSetFunction, selectorServiceRole],
  [threadOpenFunction, apiRole],
  [threadMessageEnqueueFunction, apiRole],
  [projectThreadsReadFunction, apiRole],
  [threadStandingReadFunction, apiRole],
  [sessionStoreBatchesReadFunction, apiRole],
  [sessionStoreStreamListFunction, apiRole],
  [threadWakeFunction, selectorServiceRole],
  [threadWakeCandidatesFunction, selectorServiceRole],
  [threadWakeCursorAdvanceFunction, selectorServiceRole],
  [sessionCapabilitiesSetFunction, undefined],
];

/** Every runtime credential this installation deploys, none of which owns a relation here. */
const runtimeRoles = [
  apiRole,
  schedulerRole,
  workerPlaneRole,
  ticketServiceRole,
  finalizerRole,
  selectorServiceRole,
  configurationImporterRole,
] as const;

/** The relations the session migrations add, none of which any role may reach directly. */
const relations = [
  "agent_session",
  "session_attempt",
  "session_turn",
  "session_store_batch",
] as const;

/** The one identity of a boundary function, read from the catalogue rather than retyped. */
async function boundaryOid(name: string): Promise<string> {
  const found = (await harness.query(
    `SELECT p.oid::text AS oid FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1`,
    [name],
  )) as readonly { oid: string }[];
  assert.equal(
    found.length,
    1,
    `${name} is declared ${String(found.length)} times`,
  );
  const oid = found[0]?.oid;
  if (oid === undefined)
    throw new Error(`session privileges: no function ${name}`);
  return oid;
}

test("every session boundary is a definer with a pinned path, owned by the boundary owner", async () => {
  for (const [name] of boundaries) {
    const declared = (await harness.query(
      `SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner,
              array_to_string(p.proconfig,',') AS settings
         FROM pg_proc p WHERE p.oid=$1::oid`,
      [await boundaryOid(name)],
    )) as readonly {
      definer: boolean;
      owner: string;
      settings: string | null;
    }[];
    assert.deepEqual(
      declared,
      [
        {
          definer: true,
          owner: boundaryOwnerRole,
          settings: "search_path=pg_catalog, public, pg_temp",
        },
      ],
      name,
    );
  }
});

test("each boundary is granted to exactly one role, and to PUBLIC never", async () => {
  for (const [name, granted] of boundaries) {
    const oid = await boundaryOid(name);
    for (const role of runtimeRoles) {
      const held = (await harness.query(
        `SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS held`,
        [role, oid],
      )) as readonly { held: boolean }[];
      assert.deepEqual(
        held,
        [{ held: role === granted }],
        `${name} to ${role}`,
      );
    }
    const world = (await harness.query(
      `SELECT EXISTS(SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid=$1::oid AND a.grantee=0) AS world`,
      [oid],
    )) as readonly { world: boolean }[];
    assert.deepEqual(world, [{ world: false }], `${name} to PUBLIC`);
  }
});

test("no runtime role holds any privilege on the four relations a session lives in", async () => {
  for (const relation of relations) {
    for (const role of runtimeRoles) {
      for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const held = (await harness.query(
          `SELECT has_table_privilege($1,$2,$3) AS held`,
          [role, relation, verb],
        )) as readonly { held: boolean }[];
        assert.deepEqual(
          held,
          [{ held: false }],
          `${role} ${verb} ${relation}`,
        );
      }
    }
  }
});

test("a runtime role that reaches for a session relation is refused by the server", async () => {
  for (const relation of relations) {
    for (const role of [schedulerRole, workerPlaneRole, apiRole]) {
      assert.match(
        (await harness.attemptAs(role, `SELECT * FROM ${relation} LIMIT 1`)) ??
          "",
        postgresHarnessDenial(relation),
        `${role} reading ${relation}`,
      );
    }
  }
});

test("the boundary owner reads and appends these relations and deletes from none", async () => {
  for (const relation of relations) {
    const held = (await harness.query(
      `SELECT has_table_privilege($1,$2,'SELECT') AS reads,
              has_table_privilege($1,$2,'INSERT') AS appends,
              has_table_privilege($1,$2,'DELETE') AS removes`,
      [boundaryOwnerRole, relation],
    )) as readonly { reads: boolean; appends: boolean; removes: boolean }[];
    assert.deepEqual(
      held,
      [{ reads: true, appends: true, removes: false }],
      relation,
    );
  }
});

test("the API may read the session an operation came through and no more of it", async () => {
  const held = (await harness.query(
    `SELECT has_column_privilege($1,'operation','via_session','SELECT') AS reads,
            has_column_privilege($1,'operation','via_session','UPDATE') AS writes`,
    [apiRole],
  )) as readonly { reads: boolean; writes: boolean }[];
  assert.deepEqual(held, [{ reads: true, writes: false }]);
});

/**
 * The grant the session pass needs, which migration 061 adds. A pass that may
 * not make the read raises on it and stops, so a grant lost is not a degraded
 * checkout but a deployment whose session half never moves again.
 */
test("the scheduler may read a project's repository binding, which its session pass needs", async () => {
  const refused = await harness.attemptAs(
    schedulerRole,
    `SELECT * FROM ${repositoryBindingReadFunction}('tenant','project')`,
  );
  assert.equal(
    refused,
    undefined,
    `${schedulerRole} cannot execute ${repositoryBindingReadFunction}: migration 061 is what grants it, and without that grant every session placement pass raises and stops`,
  );
});
