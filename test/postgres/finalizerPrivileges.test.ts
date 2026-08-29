/**
 * What the finalizer migrations' grants and revokes let each role do, asked of
 * the server rather than read off the DDL. A grant nobody exercised and a revoke
 * nobody attempted are both unverified controls, so every privilege the
 * finalizer holds is used here and every one it does not hold is attempted.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  approvalRequestFunction,
  finalizationFunction,
  finalizerRole,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
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

/** The four relations a forged conclusion would have to be written into. */
const mailbox = [
  "operation",
  "decision_input",
  "journal_entry",
  "ticket_projection",
] as const;

/** Every relation a finalizer migration took from the roles that came before it. */
const added = [
  "project_repository",
  "input_bundle",
  "input_bundle_reference",
  "finalization_attempt",
  "commit_permit",
  "finalization_reconciliation",
  "finalization_request_configuration",
  "finalization_change_proposal",
] as const;

/**
 * One statement of each verb against `relation`, so a revoke is attempted and
 * not assumed. The updated column is read back from the server rather than
 * named here, because a statement naming a column the relation does not have
 * fails in parse analysis and proves nothing about the grant.
 */
async function everyVerb(relation: string): Promise<readonly string[]> {
  const columns = (await harness.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position LIMIT 1`,
    [relation],
  )) as readonly { column_name: string }[];
  const column = columns[0]?.column_name;
  if (column === undefined) {
    throw new Error(`finalizer privileges: no relation ${relation}`);
  }
  return [
    `SELECT * FROM ${relation} LIMIT 1`,
    `INSERT INTO ${relation} DEFAULT VALUES`,
    `UPDATE ${relation} SET ${column} = ${column}`,
    `DELETE FROM ${relation}`,
  ];
}

test("the finalizer holds no privilege at all on the relations a conclusion lives in", async () => {
  for (const relation of mailbox) {
    for (const statement of await everyVerb(relation)) {
      assert.match(
        (await harness.attemptAs(finalizerRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
    }
  }
});

test("the finalizer cannot reach a prior slice's own relations", async () => {
  for (const relation of [
    "project_notification",
    "project_continuation",
    "execution_request",
    "execution_attempt",
    "scheduler_incident",
    "capacity_account",
    "dispatch_view",
    "selector_proposal_delivery",
    "draft",
  ]) {
    for (const statement of await everyVerb(relation)) {
      assert.match(
        (await harness.attemptAs(finalizerRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
    }
  }
});

test("the scheduler rows a handoff is spelled across are readable and nothing more", async () => {
  for (const relation of [
    "execution",
    "execution_request_task",
    "execution_result",
    "execution_result_artifact",
  ]) {
    const [read, ...written] = await everyVerb(relation);
    assert.equal(
      await harness.attemptAs(finalizerRole, read ?? ""),
      undefined,
      relation,
    );
    for (const statement of written) {
      assert.match(
        (await harness.attemptAs(finalizerRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
    }
  }
});

/** The one relation in `added` a later migration handed back, and to one role only. */
const schedulerReadable = "input_bundle_reference";

test("a prior role writes no finalizer-owned relation and reads only the granted one", async () => {
  for (const role of [apiRole, selectorServiceRole, schedulerRole]) {
    for (const relation of added) {
      const [read, ...written] = await everyVerb(relation);
      const refusal = await harness.attemptAs(role, read ?? "");
      if (role === schedulerRole && relation === schedulerReadable)
        assert.equal(refusal, undefined, `${role}: ${read ?? ""}`);
      else
        assert.match(
          refusal ?? "",
          postgresHarnessDenial(relation),
          `${role}: ${read ?? ""}`,
        );
      for (const statement of written) {
        assert.match(
          (await harness.attemptAs(role, statement)) ?? "",
          postgresHarnessDenial(relation),
          `${role}: ${statement}`,
        );
      }
    }
  }
});

test("the ticket service reaches only the finalizer relations its boundary needs", async () => {
  for (const relation of [
    "project_repository",
    "commit_permit",
    "finalization_reconciliation",
    "finalization_change_proposal",
  ]) {
    for (const statement of await everyVerb(relation)) {
      assert.match(
        (await harness.attemptAs(ticketServiceRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
    }
  }
  const [read, ...written] = await everyVerb("finalization_attempt");
  assert.equal(
    await harness.attemptAs(ticketServiceRole, read ?? ""),
    undefined,
    "the evidence a rework bundle is materialized from is readable",
  );
  for (const statement of written) {
    assert.match(
      (await harness.attemptAs(ticketServiceRole, statement)) ?? "",
      postgresHarnessDenial("finalization_attempt"),
      statement,
    );
  }
  for (const relation of ["input_bundle", "input_bundle_reference"]) {
    assert.equal(
      await harness.attemptAs(
        ticketServiceRole,
        `SELECT * FROM ${relation} LIMIT 1`,
      ),
      undefined,
    );
    for (const statement of [
      `UPDATE ${relation} SET tenant='forged'`,
      `DELETE FROM ${relation}`,
    ]) {
      assert.match(
        (await harness.attemptAs(ticketServiceRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
    }
  }
});

test("only the ticket service publishes immutable handoff request configuration", async () => {
  const privileges = (await harness.query(
    `SELECT has_table_privilege($1,'finalization_request_configuration','INSERT') AS insert,
            has_table_privilege($1,'finalization_request_configuration','SELECT') AS select,
            has_table_privilege($1,'finalization_request_configuration','UPDATE') AS update,
            has_table_privilege($1,'finalization_request_configuration','DELETE') AS delete`,
    [ticketServiceRole],
  )) as readonly {
    insert: boolean;
    select: boolean;
    update: boolean;
    delete: boolean;
  }[];
  assert.deepEqual(privileges[0], {
    insert: true,
    select: false,
    update: false,
    delete: false,
  });
});

test("the ticket service reads accepted promotion only through its narrow door", async () => {
  assert.equal(
    await harness.attemptAs(
      ticketServiceRole,
      "SELECT * FROM read_accepted_handoff_promotion('t','p',1)",
    ),
    undefined,
  );
  for (const relation of ["commit_permit", "finalization_reconciliation"]) {
    assert.match(
      (await harness.attemptAs(
        ticketServiceRole,
        `SELECT * FROM ${relation} LIMIT 1`,
      )) ?? "",
      postgresHarnessDenial(relation),
    );
  }
});

test("the finalizer reads the brief its target is narrowed by and writes none of it", async () => {
  for (const relation of ["draft_brief", "draft_brief_link"]) {
    const [read, ...written] = await everyVerb(relation);
    assert.equal(
      await harness.attemptAs(finalizerRole, read ?? ""),
      undefined,
      relation,
    );
    for (const statement of written) {
      assert.match(
        (await harness.attemptAs(finalizerRole, statement)) ?? "",
        postgresHarnessDenial(relation),
        statement,
      );
    }
  }
});

test("the finalizer cannot open, withdraw or resolve a native action by hand", async () => {
  for (const statement of [
    "INSERT INTO native_action DEFAULT VALUES",
    "UPDATE native_action SET state='Resolved'",
    "DELETE FROM native_action",
    "INSERT INTO native_action_resolution DEFAULT VALUES",
    "UPDATE native_action_resolution SET resolution='Resume'",
  ]) {
    const refusal = (await harness.attemptAs(finalizerRole, statement)) ?? "";
    assert.match(
      refusal,
      /permission denied for table native_action(_resolution)?\b/u,
      statement,
    );
  }
});

test("the finalizer cannot mint an epoch, a project or a repository binding", async () => {
  for (const [statement, object] of [
    ["INSERT INTO recovery_epoch (epoch) VALUES ('minted')", "recovery_epoch"],
    ["INSERT INTO project_repository DEFAULT VALUES", "project_repository"],
    ["UPDATE project_repository SET repository='seized'", "project_repository"],
    [
      "INSERT INTO configuration_revision DEFAULT VALUES",
      "configuration_revision",
    ],
    ["INSERT INTO execution DEFAULT VALUES", "execution"],
    ["UPDATE execution SET outcome='Passed'", "execution"],
    ["INSERT INTO execution_result DEFAULT VALUES", "execution_result"],
    [
      "INSERT INTO execution_result_artifact DEFAULT VALUES",
      "execution_result_artifact",
    ],
    ["UPDATE project SET lifecycle='Active'", "project"],
    ["INSERT INTO project DEFAULT VALUES", "project"],
  ] as readonly (readonly [string, string])[]) {
    assert.match(
      (await harness.attemptAs(finalizerRole, statement)) ?? "",
      postgresHarnessDenial(object),
      statement,
    );
  }
});

test("the finalizer reads of the project only its lifecycle", async () => {
  assert.equal(
    await harness.attemptAs(
      finalizerRole,
      "SELECT tenant, project, lifecycle, lifecycle_generation FROM project LIMIT 1",
    ),
    undefined,
  );
  for (const column of ["head", "owner", "fencing_epoch", "ingress_next"]) {
    assert.match(
      (await harness.attemptAs(
        finalizerRole,
        `SELECT ${column} FROM project LIMIT 1`,
      )) ?? "",
      postgresHarnessDenial("project"),
      column,
    );
  }
});

/** Every column the finalizer may write, as the server groups its own grants. */
const writeSurface = [
  {
    table_name: "commit_permit",
    privilege_type: "INSERT",
    columns:
      "attempt,concluded_at,granted_at,lifecycle_generation,permit,project,recovery_epoch,state,tenant",
  },
  {
    table_name: "commit_permit",
    privilege_type: "UPDATE",
    columns: "concluded_at,state",
  },
  {
    table_name: "finalization_attempt",
    privilege_type: "INSERT",
    columns:
      "approval_required,attempt,attempt_digest,candidate_commit,configuration_digest,configuration_revision,conflict_manifest,conflict_manifest_digest,failure_kind,input_bundle,input_bundle_digest,outcome,prepared_at,project,repository,request,strategy,target_commit,target_ref,tenant,ticket",
  },
  {
    table_name: "finalization_change_proposal",
    privilege_type: "INSERT",
    columns:
      "attempts,base_commit,base_ref,body,head_commit,head_ref,permit,project,proposal_request,request,tenant,title",
  },
  {
    table_name: "finalization_change_proposal",
    privilege_type: "UPDATE",
    columns:
      "attempts,creation,creation_contradiction,creation_evidence,reconciliation,reconciliation_contradiction,reconciliation_evidence,reconciliations,refusals",
  },
  {
    table_name: "finalization_reconciliation",
    privilege_type: "INSERT",
    columns:
      "candidate_commit,observed_commit,permit,project,reconciled_at,target_ref,tenant,verdict",
  },
  {
    table_name: "finalization_reconciliation",
    privilege_type: "UPDATE",
    columns: "observed_commit,reconciled_at,verdict",
  },
  {
    table_name: "finalization_request",
    privilege_type: "UPDATE",
    columns:
      "claim_expires_at,claim_generation,claim_owner,recovery_epoch,state",
  },
  {
    table_name: "input_bundle",
    privilege_type: "INSERT",
    columns: "bundle,created_at,digest,project,tenant",
  },
  {
    table_name: "input_bundle_reference",
    privilege_type: "INSERT",
    columns:
      "bundle,ordinal,project,reference_digest,reference_id,reference_kind,tenant",
  },
];

test("the finalizer's write surface is exactly the columns its moves need", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT table_name, privilege_type,
              string_agg(column_name, ',' ORDER BY column_name) AS columns
         FROM information_schema.role_column_grants
        WHERE grantee=$1 AND table_schema='public' AND privilege_type <> 'SELECT'
        GROUP BY table_name, privilege_type
        ORDER BY table_name, privilege_type`,
      [finalizerRole],
    ),
    writeSurface,
  );
});

test("the finalizer's read surface is exactly the relations its view is gathered from", async () => {
  const read = (await harness.query(
    `SELECT table_name AS relation FROM information_schema.role_column_grants
      WHERE grantee=$1 AND table_schema='public' AND privilege_type='SELECT'
      GROUP BY table_name ORDER BY table_name`,
    [finalizerRole],
  )) as readonly { relation: string }[];
  assert.deepEqual(
    read.map((row) => row.relation),
    [
      "commit_permit",
      "configuration_revision",
      "draft_brief",
      "draft_brief_link",
      "execution",
      "execution_request_task",
      "execution_result",
      "execution_result_artifact",
      "execution_result_source",
      "finalization_attempt",
      "finalization_change_proposal",
      "finalization_reconciliation",
      "finalization_request",
      "finalization_request_configuration",
      "input_bundle",
      "input_bundle_reference",
      "native_action",
      "native_action_resolution",
      "project",
      "project_repository",
      "recovery_epoch",
      "schema_migration",
    ],
  );
});

test("the finalizer's two doors are its own and no prior role may open them", async () => {
  const doors = [
    `SELECT * FROM ${finalizationFunction}('t','p','r','a','FinalizationFailed','MergeConflict',1,'e','o','s')`,
    `SELECT * FROM ${approvalRequestFunction}('t','p','a','n','e')`,
  ];
  for (const [door, name] of [
    [doors[0] ?? "", finalizationFunction],
    [doors[1] ?? "", approvalRequestFunction],
  ] as readonly (readonly [string, string])[]) {
    for (const role of [apiRole, ticketServiceRole, schedulerRole]) {
      assert.match(
        (await harness.attemptAs(role, door)) ?? "",
        postgresHarnessDenial(name),
        `${role}: ${name}`,
      );
    }
    assert.equal(await harness.attemptAs(finalizerRole, door), undefined, name);
  }
});

test("both doors are security definer, boundary-owned and search-path pinned", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT p.proname, p.prosecdef, r.rolname AS owner,
              array_to_string(p.proconfig, ',') AS settings
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = ANY($1) ORDER BY p.proname`,
      [[finalizationFunction, approvalRequestFunction]],
    ),
    [
      {
        proname: approvalRequestFunction,
        prosecdef: true,
        owner: "chuggy_boundary_owner",
        settings: "search_path=pg_catalog, public, pg_temp",
      },
      {
        proname: finalizationFunction,
        prosecdef: true,
        owner: "chuggy_boundary_owner",
        settings: "search_path=pg_catalog, public, pg_temp",
      },
    ],
  );
});

test("the finalizer is non-login and non-escalating", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         FROM pg_roles WHERE rolname=$1`,
      [finalizerRole],
    ),
    [
      {
        rolcanlogin: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
      },
    ],
  );
});
