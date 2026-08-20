import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  acceptanceFunction,
  apiRole,
  boundaryOwnerRole,
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

test("the retired dispatcher role no longer exists", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM pg_roles
       WHERE rolname='chuggy_dispatcher'`,
    ),
    [{ count: "0" }],
  );
});
