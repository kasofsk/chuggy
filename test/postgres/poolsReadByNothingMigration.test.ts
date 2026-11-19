/**
 * 213 leaves no function reading a pool, its registration tokens, the owner
 * fallback or an execution's pin, but for the two that hold and empty them
 * for a project's deletion. Each replaced read answers for a personal runner
 * and a chat host as before, a pool row takes part in no answer, and every
 * row of those tables and every pin stands as it was.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import {
  droppedFunctionsAt213,
  migration213,
  replacedFunctionsAt213,
} from "../../src/adapters/postgres/schema/migrations/213-pools-read-by-nothing.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

const words = [
  "worker_pool",
  "worker_pool_registration_token",
  "project_owner_fallback",
  "owner_fallback",
];

const functionsNaming = `SELECT DISTINCT p.oid::regprocedure::text AS function
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN unnest($1::text[]) t(word)
   WHERE n.nspname='public' AND p.prosrc ~ ('\\m' || t.word || '\\M')
   ORDER BY 1`;

const kept = [
  "delete_unrun_project(text,text)",
  "project_deletion_holds(text,text)",
];

const functionsStanding = `SELECT p.oid::regprocedure::text AS function
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.oid::regprocedure::text = ANY($1::text[])
   ORDER BY 1`;

/** What a replaced function is installed as beside its body. */
const functionsInstalled = `SELECT p.oid::regprocedure::text AS function,
         pg_get_userbyid(p.proowner) AS owner, p.proacl::text[] AS grants,
         p.provolatile, p.prosecdef, p.prorows, p.proconfig, p.prolang
    FROM pg_proc p
   WHERE p.oid = ANY(SELECT unnest($1::text[])::regprocedure)
   ORDER BY 1`;

const rowsStanding = `SELECT
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.pool) FROM worker_pool w) AS pools,
    (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.token_digest)
       FROM worker_pool_registration_token k) AS tokens,
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.project) FROM project_owner_fallback f) AS fallbacks,
    (SELECT jsonb_agg(jsonb_build_array(e.execution, e.owner_fallback) ORDER BY e.execution)
       FROM execution e) AS pins`;

/** The member whose personal runner and chat host the replaced reads answer for. */
const member = "member";

/** Who registered the pool, and runs nothing else that names its credential. */
const registrar = "registrar";

const pins = { unpinned: null, strict: "Strict", preferred: "Preferred" };

const seeded = `
  SET session_replication_role=replica;
  INSERT INTO tenant(tenant,display_name) VALUES('tenant','tenant');
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant','project','Active');
  INSERT INTO worker_pool
    (tenant,project,pool,principal,client_id,class,registered_by,
     last_polled_at,executions_polled_at,credentials_named)
  VALUES('tenant','project','pool','pool-principal','pool-client','Dedicated',
         '${registrar}',now(),now(),'{"Claude":["pool-only"]}');
  INSERT INTO worker_pool_registration_token(token_digest,tenant,project,expires_at)
  VALUES(repeat('a',64),'tenant','project',now()+interval '1 day');
  INSERT INTO project_owner_fallback(tenant,project,fallback,set_by_kind,set_by_subject,set_at)
  VALUES('tenant','project','Strict','Member','${member}',now());
  INSERT INTO personal_runner
    (tenant,owner,capabilities,principal,client_id,last_polled_at,credentials_named)
  VALUES('tenant','${member}','{}','runner-principal','runner-client',now(),
         '{"Claude":["personal"]}'),
        ('tenant','${registrar}','{}','registrar-principal','registrar-client',now(),
         '{"Claude":["registrar-personal"]}');
  INSERT INTO personal_runner_project(tenant,owner,project)
  VALUES('tenant','${member}','project'),('tenant','${registrar}','project');
  INSERT INTO chat_host(tenant,owner,principal,client_id,last_polled_at,credentials_named)
  VALUES('tenant','${member}','host-principal','host-client',now(),'{"Claude":["hosted"]}');
  ${Object.entries(pins)
    .map(([name, pin], index) => limitedTicket(index + 1, name, pin))
    .join("\n")}
  ${limitedTicket(4, "pooled", "Strict", true)}
  INSERT INTO agent_account_limit
    (principal,agent,credential,resets_at,observed_at,tenant,project,execution,attempt)
  VALUES('${member}','Claude','personal',now()+interval '2 hours',now(),
         'tenant','project','execution-unpinned','attempt-unpinned'),
        ('${member}','Claude','hosted',now()+interval '3 hours',now(),
         'tenant','project','execution-unpinned','attempt-unpinned'),
        ('${registrar}','Claude','registrar-personal',now()+interval '1 hour',now(),
         'tenant','project','execution-pooled','attempt-pooled'),
        ('${registrar}','Claude','pool-only',now()+interval '4 hours',now(),
         'tenant','project','execution-pooled','attempt-pooled');
  SET session_replication_role=origin;`;

/** A ticket escalated on its one work task, whose attempt a rate limit withdrew, run by the member's personal runner or, where `pooled`, by the pool. */
function limitedTicket(
  ticket: number,
  name: string,
  pin: string | null,
  pooled = false,
): string {
  const at = String(ticket);
  const runner = pooled
    ? "false,'pool','pool-principal'"
    : `true,'${member}','runner-principal'`;
  return `
  INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
  VALUES('tenant','project',${at},'Escalated',${at},'WorkFailureEscalated');
  INSERT INTO execution_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     kind,capacity_account,configuration_revision,configuration_digest,
     input_bundle,input_bundle_digest)
  VALUES('tenant','project','request-${name}',${at},0,${at},${at},'SpawnWork',
         'account','revision','digest','bundle',repeat('b',64));
  INSERT INTO execution_request_task(tenant,project,request,task,kind,cycle)
  VALUES('tenant','project','request-${name}',1,'Work',1);
  INSERT INTO execution
    (tenant,project,execution,ticket,task,source_request,account,cluster,
     configuration_revision,configuration_digest,requirement_identity,requirement_value,
     requirement_digest,requirement_source,platform_default_version,status,outcome,completion_operation,terminal_at,result_manifest,owner,owner_fallback)
  VALUES('tenant','project','execution-${name}',${at},1,'request-${name}','account','cluster',
         'revision','digest','execution-${name}','{}'::jsonb,
         'digest','TicketDefault',1,'Terminal','ProcessFailed',
         'operation-${name}',now(),'manifest-${name}','${member}',${pin === null ? "NULL" : `'${pin}'`});
  INSERT INTO execution_attempt
    (tenant,project,execution,attempt,attempt_number,recovery_epoch,capability,
     capability_secret_digest,manifest,state,evidence,claimed_at,ended_at,
     personal,pool,pool_principal,assignment,invocation)
  VALUES('tenant','project','execution-${name}','attempt-${name}',1,'epoch','capability-${name}',
         repeat('c',64),'manifest-${name}','Withdrawn','RunRateLimited',now(),now(),
         ${runner},'assignment-${name}',
         '{"worker":{"mode":{"type":"SingleAgent","agent":"Claude"}}}'::jsonb);`;
}

/** What retiring `principal`'s Claude `credential` answers, rolled back so it deletes nothing. */
async function answeredRetired(
  subject: pg.Pool,
  principal: string,
  credential: string,
): Promise<string | undefined> {
  const client = await subject.connect();
  try {
    await client.query("BEGIN");
    return (
      await client.query<{ retired: string }>(
        "SELECT retire_agent_account_credential($1,'Claude',$2) AS retired",
        [principal, credential],
      )
    ).rows[0]?.retired;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** What every replaced read answers for the member's personal runner and chat host. */
async function answered(subject: pg.Pool): Promise<Record<string, unknown>> {
  const read = async (
    statement: string,
    values: unknown[] = [],
  ): Promise<readonly Record<string, unknown>[]> =>
    (await subject.query<Record<string, unknown>>(statement, values)).rows;
  const tickets = Object.keys(pins).map((name, index) => [name, index + 1]);
  return {
    standing: await read(
      `SELECT member_standing, inquiry_standing
         FROM session_runner_standing('tenant','project',$1,60)`,
      [member],
    ),
    accounts: await read(
      `SELECT x.execution, s.principal, s.agent FROM execution x
        CROSS JOIN LATERAL execution_attempt_agent_account(
          x.tenant,x.project,x.execution,'attempt-'||substr(x.execution,11)) s
        WHERE x.execution<>'execution-pooled'
        ORDER BY x.execution`,
    ),
    resumable: Object.fromEntries(
      await Promise.all(
        tickets.map(async ([name, ticket]) => [
          name,
          await read(
            "SELECT ticket_rate_limit_resumable('tenant','project',$1,3,3) AS resumable",
            [ticket],
          ),
        ]),
      ),
    ),
    resume: Object.fromEntries(
      await Promise.all(
        tickets.map(async ([name, ticket]) => [
          name,
          await read(
            `SELECT round(extract(epoch FROM paused_until - now())/3600) AS hours, off
               FROM ticket_usage_resume('tenant','project',$1,3,3)`,
            [ticket],
          ),
        ]),
      ),
    ),
    holding: await read(
      `SELECT round(extract(epoch FROM paused_until - now())/3600) AS hours,
              reasons, admitted_by_press, credentials
         FROM agent_account_pause_holding($1,'Claude')`,
      [member],
    ),
    retired: {
      personal: await answeredRetired(subject, member, "personal"),
      hosted: await answeredRetired(subject, member, "hosted"),
    },
  };
}

/** What the pool alone took part in: its registrar's holding and retirement of the credential only it named, and its attempt's principal. */
async function poolAnswered(
  subject: pg.Pool,
): Promise<Record<string, unknown>> {
  return {
    retired: await answeredRetired(subject, registrar, "pool-only"),
    holding: (
      await subject.query<Record<string, unknown>>(
        `SELECT credentials FROM agent_account_pause_holding($1,'Claude')`,
        [registrar],
      )
    ).rows,
    principal: (
      await subject.query<Record<string, unknown>>(
        `SELECT principal FROM execution_attempt_agent_account(
           'tenant','project','execution-pooled','attempt-pooled')`,
      )
    ).rows,
  };
}

test("213 leaves no function naming a pool or a pin, each replaced read answering for the member's runners as before, no pool row in any answer and every row as it was", async () => {
  await migrationDatabase("pools_read_by_nothing", async (subject) => {
    await migratedBefore(subject, migration213.version);
    await subject.query(`INSERT INTO recovery_epoch(epoch) VALUES('epoch')`);
    await subject.query(seeded);

    const namingBefore = (await subject.query(functionsNaming, [words])).rows;
    assert.ok(namingBefore.length > kept.length);
    assert.equal(
      (await subject.query(functionsStanding, [[...droppedFunctionsAt213]]))
        .rows.length,
      droppedFunctionsAt213.length,
    );
    const installedBefore = (
      await subject.query(functionsInstalled, [[...replacedFunctionsAt213]])
    ).rows;
    assert.equal(installedBefore.length, replacedFunctionsAt213.length);
    const answeredBefore = await answered(subject);
    const rowsBefore = (await subject.query(rowsStanding)).rows;
    assert.deepEqual(await poolAnswered(subject), {
      retired: "CredentialInUse",
      holding: [{ credentials: ["pool-only", "registrar-personal"] }],
      principal: [{ principal: registrar }],
    });
    assert.deepEqual(
      (
        await subject.query(
          `SELECT project_standing FROM session_runner_standing('tenant','project',$1,60)`,
          [member],
        )
      ).rows,
      [{ project_standing: "Live" }],
    );

    assert.ok((await postgresMigrate(subject)).includes(migration213.version));

    assert.deepEqual(
      (await subject.query(functionsNaming, [words])).rows.map(
        (row: { function: string }) => row.function,
      ),
      kept,
    );
    assert.deepEqual(
      (await subject.query(functionsStanding, [[...droppedFunctionsAt213]]))
        .rows,
      [],
    );
    assert.deepEqual(
      (await subject.query(functionsInstalled, [[...replacedFunctionsAt213]]))
        .rows,
      installedBefore,
    );
    assert.deepEqual(await answered(subject), answeredBefore);
    assert.deepEqual(await poolAnswered(subject), {
      retired: "Retired",
      holding: [{ credentials: ["registrar-personal"] }],
      principal: [{ principal: null }],
    });
    assert.deepEqual(
      (
        await subject.query(
          `SELECT * FROM session_runner_standing('tenant','project',$1,60)`,
          [member],
        )
      ).fields.map((field) => field.name),
      ["member_standing", "inquiry_standing"],
    );
    assert.deepEqual((await subject.query(rowsStanding)).rows, rowsBefore);
  });
});
