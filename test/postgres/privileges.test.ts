import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  apiRole,
  boundaryOwnerRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresHarnessOpen, type PostgresHarness } from "./harness.ts";

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

test("the retired dispatcher role has no database relation privileges", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM information_schema.role_table_grants
      WHERE grantee='chuggy_dispatcher' AND table_schema='public'`,
    ),
    [{ count: "0" }],
  );
});
