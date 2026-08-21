import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  acceptanceFunction,
  accountIdentityFunction,
  apiRole,
  boundaryOwnerRole,
  cancellationFunction,
  continuationFunction,
  notificationPublishFunction,
  schedulerRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

test("only the writer may name the account a spawn request pins", async () => {
  const naming = `SELECT ${accountIdentityFunction}('tenant','project')`;
  assert.equal(await harness.attemptAs(ticketServiceRole, naming), undefined);
  for (const role of [apiRole, schedulerRole]) {
    assert.match(
      (await harness.attemptAs(role, naming)) ?? "",
      /permission denied/,
    );
  }
});

test("runtime roles cannot construct decision inputs directly", async () => {
  for (const role of [apiRole, ticketServiceRole]) {
    const refusal = await harness.attemptAs(
      role,
      `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation)
       VALUES ('tenant','project',1,'Continuation','input','Continuation',1)`,
    );
    assert.match(refusal ?? "", /permission denied/);
  }
});

test("the API cannot construct any part of an accepted operation directly", async () => {
  const statements = [
    `INSERT INTO operation
       (tenant,project,operation,authority_kind,authority_subject,admission,
        key_version,key_digest,payload_digest,command,command_tag)
     VALUES ('tenant','project','operation','kind','subject','Ordinary',
       'v1','key','payload','command','Dispatch')`,
    `UPDATE project SET ingress_next=ingress_next+1
      WHERE tenant='tenant' AND project='project'`,
    `INSERT INTO project_readiness (tenant,project,ready,generation)
     VALUES ('tenant','project',true,1)`,
    `UPDATE project_readiness SET ready=true, generation=generation+1
      WHERE tenant='tenant' AND project='project'`,
  ];
  for (const statement of statements) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(refusal ?? "", /permission denied/);
  }
  assert.deepEqual(
    await harness.query(
      `SELECT table_name, privilege_type FROM information_schema.role_column_grants
       WHERE grantee=$1 AND table_schema='public'
         AND table_name IN ('operation','project','project_readiness')
         AND privilege_type IN ('INSERT','UPDATE')
       ORDER BY table_name, privilege_type`,
      [apiRole],
    ),
    [],
  );
});

test("the API acceptance boundary rejects malformed command bytes", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "privilege-malformed-command",
  );
  for (const [operation, command] of [
    ["non-json", "garbage"],
    [
      "missing-value",
      '{"version":1,"command":"Decide","event":{"type":"Dispatch"}}',
    ],
    [
      "missing-enum",
      '{"version":1,"command":"Decide","event":{"type":"TaskDone","value":{"ticket":1,"tid":1,"result":{"manifest":1,"digest":1,"schema":1}}}}',
    ],
  ]) {
    const failure = await harness.attemptAs(
      apiRole,
      `SELECT * FROM ${acceptanceFunction}(
        '${partition.tenant}', '${partition.project}', '${operation}', 'User', 'subject',
        'v1', 'key-${operation}', 'payload', ARRAY['key-${operation}'], ARRAY['payload'],
        '${command}', 10, 20)`,
    );
    assert.equal(failure, undefined);
  }
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM operation
       WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ count: "0" }],
  );
});

test("the API cannot append history or create focused work", async () => {
  for (const relation of [
    "journal_entry",
    "execution_request",
    "finalization_request",
  ]) {
    const refusal = await harness.attemptAs(
      apiRole,
      `INSERT INTO ${relation} DEFAULT VALUES`,
    );
    assert.match(refusal ?? "", /permission denied/);
  }
});

test("the API cannot bypass versioned authoring functions", async () => {
  for (const statement of [
    "INSERT INTO configuration_revision DEFAULT VALUES",
    "INSERT INTO draft DEFAULT VALUES",
    "INSERT INTO draft_revision DEFAULT VALUES",
    "UPDATE draft SET state='Released'",
    "UPDATE project SET ticket_next=ticket_next+1",
  ]) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(refusal ?? "", /permission denied/);
  }
});

test("runtime roles cannot write notification rows directly", async () => {
  for (const role of [apiRole, ticketServiceRole]) {
    for (const statement of [
      "INSERT INTO project_notification DEFAULT VALUES",
      "DELETE FROM project_notification",
      "UPDATE project SET notification_next=notification_next+1",
    ]) {
      const refusal = await harness.attemptAs(role, statement);
      assert.match(refusal ?? "", /permission denied/);
    }
  }
  const refusal = await harness.attemptAs(
    apiRole,
    `SELECT ${notificationPublishFunction}('t','p','Draft','1',NULL,1)`,
  );
  assert.match(refusal ?? "", /permission denied/);
});

test("the API read credential cannot inspect private operation columns", async () => {
  for (const column of [
    "command",
    "authority_subject",
    "key_digest",
    "payload_digest",
  ]) {
    const refusal = await harness.attemptAs(
      apiRole,
      `SELECT ${column} FROM operation LIMIT 1`,
    );
    assert.match(refusal ?? "", /permission denied/);
  }
  assert.equal(
    await harness.attemptAs(
      apiRole,
      "SELECT operation,accepted_at FROM operation LIMIT 1",
    ),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(
      apiRole,
      "SELECT ticket,phase,seq FROM ticket_projection LIMIT 1",
    ),
    undefined,
  );
});

test("the security-definer owner is non-login and non-escalating", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
       FROM pg_roles WHERE rolname=$1`,
      [boundaryOwnerRole],
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

test("the scheduler cannot write ticket state or append history", async () => {
  for (const statement of [
    "INSERT INTO journal_entry DEFAULT VALUES",
    "UPDATE journal_entry SET entry='rewritten'",
    "DELETE FROM journal_entry",
    "INSERT INTO ticket_projection DEFAULT VALUES",
    "UPDATE ticket_projection SET phase='Done'",
    "UPDATE project SET head=1",
    "UPDATE project SET lifecycle='Suspended'",
    "INSERT INTO execution_request DEFAULT VALUES",
    "INSERT INTO finalization_request DEFAULT VALUES",
    "INSERT INTO project_continuation DEFAULT VALUES",
    "UPDATE native_action SET state='Resolved'",
  ]) {
    const refusal = await harness.attemptAs(schedulerRole, statement);
    assert.match(refusal ?? "", /permission denied/);
  }
});

test("the scheduler reaches the decision mailbox through one function and no other door", async () => {
  for (const statement of [
    `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation)
     VALUES ('tenant','project',1,'Operation','input','Completion',1)`,
    "UPDATE decision_input SET state='Cancelled'",
    "INSERT INTO operation DEFAULT VALUES",
    "UPDATE operation SET command='{}'",
    "UPDATE project SET ingress_next=1",
    "INSERT INTO project_readiness (tenant,project,ready,generation) VALUES ('t','p',true,1)",
    "UPDATE project_readiness SET ready=true",
    `SELECT ${acceptanceFunction}('t','p','o','User','s','v1','k','p',
       ARRAY['k'],ARRAY['p'],'{}',10,20)`,
    `SELECT ${cancellationFunction}('t','p','o','User','s')`,
    `SELECT ${continuationFunction}('t','p',1,'c')`,
    `SELECT ${notificationPublishFunction}('t','p','Draft','1',NULL,1)`,
  ]) {
    const refusal = await harness.attemptAs(schedulerRole, statement);
    assert.match(refusal ?? "", /permission denied/);
  }
});

test("the scheduler cannot rewrite a settlement, a result or its own entitlement", async () => {
  for (const statement of [
    "UPDATE execution SET outcome='Passed'",
    "UPDATE execution SET result_manifest='manifest'",
    "UPDATE execution SET completion_operation='operation'",
    "UPDATE execution SET account='another'",
    "DELETE FROM execution",
    "UPDATE execution_result SET verdict='Pass'",
    "DELETE FROM execution_result",
    "UPDATE execution_result_artifact SET bytes=0",
    "DELETE FROM execution_result_artifact",
    "DELETE FROM execution_attempt",
    "UPDATE execution_attempt SET attempt_number=1",
    "DELETE FROM scheduler_incident",
    "UPDATE capacity_account SET maximum=9001",
    "INSERT INTO capacity_account (account,cluster,reserved,maximum,policy_revision) VALUES ('a','default',0,9001,1)",
    "UPDATE execution_cluster SET slots_max=9001",
    "INSERT INTO recovery_epoch (epoch) VALUES ('minted')",
  ]) {
    const refusal = await harness.attemptAs(schedulerRole, statement);
    assert.match(refusal ?? "", /permission denied/);
  }
});

test("the scheduler's write surface is exactly the columns execution and capacity need", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT table_name, privilege_type,
              string_agg(column_name, ',' ORDER BY column_name) AS columns
         FROM information_schema.role_column_grants
        WHERE grantee=$1 AND table_schema='public'
          AND privilege_type <> 'SELECT'
        GROUP BY table_name, privilege_type
        ORDER BY table_name, privilege_type`,
      [schedulerRole],
    ),
    [
      {
        table_name: "execution",
        privilege_type: "INSERT",
        columns:
          "account,cluster,configuration_digest,configuration_revision,execution,project,source_request,task,tenant,ticket",
      },
      {
        table_name: "execution",
        privilege_type: "UPDATE",
        columns:
          "attempt_next,placement_backoff_from,retries_spent,status,terminal_at",
      },
      {
        table_name: "execution_attempt",
        privilege_type: "INSERT",
        columns:
          "attempt,attempt_number,ended_at,evidence,execution,generation,lease_expires_at,lease_owner,opened_at,project,recovery_epoch,state,tenant,workload",
      },
      {
        table_name: "execution_attempt",
        privilege_type: "UPDATE",
        columns:
          "ended_at,evidence,generation,lease_expires_at,lease_owner,state,workload",
      },
      {
        table_name: "execution_request",
        privilege_type: "UPDATE",
        columns: "claim_expires_at,claim_generation,claim_owner,state",
      },
      {
        table_name: "execution_result",
        privilege_type: "INSERT",
        columns:
          "attempt,digest,execution,manifest,manifest_ordinal,project,recorded_at,schema_version,tenant,verdict",
      },
      {
        table_name: "execution_result_artifact",
        privilege_type: "INSERT",
        columns: "bytes,digest,manifest,ordinal,path,project,role,tenant",
      },
      {
        table_name: "project",
        privilege_type: "UPDATE",
        columns: "manifest_next",
      },
      {
        table_name: "scheduler_incident",
        privilege_type: "INSERT",
        columns:
          "attempt,evidence,execution,incident,kind,observed_at,project,tenant",
      },
    ],
  );
});

test("the scheduler reads execution and capacity, and of the project only its lifecycle", async () => {
  const read = (await harness.query(
    `SELECT table_name AS relation,
            string_agg(column_name, ',' ORDER BY column_name) AS columns
       FROM information_schema.role_column_grants
      WHERE grantee=$1 AND table_schema='public' AND privilege_type='SELECT'
      GROUP BY table_name ORDER BY table_name`,
    [schedulerRole],
  )) as readonly { relation: string; columns: string }[];
  assert.deepEqual(
    read.map((row) => row.relation),
    [
      "capacity_account",
      "execution",
      "execution_attempt",
      "execution_cluster",
      "execution_request",
      "execution_request_task",
      "execution_result",
      "execution_result_artifact",
      "project",
      "recovery_epoch",
      "scheduler_incident",
    ],
  );
  assert.equal(
    read.find((row) => row.relation === "project")?.columns,
    "lifecycle,lifecycle_generation,manifest_next,project,tenant",
  );
});

test("the scheduler is non-login and non-escalating", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
       FROM pg_roles WHERE rolname=$1`,
      [schedulerRole],
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

test("the retired dispatcher role no longer exists", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM pg_roles
       WHERE rolname='chuggy_dispatcher'`,
    ),
    [{ count: "0" }],
  );
});
