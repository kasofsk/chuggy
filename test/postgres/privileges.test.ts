import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  acceptanceFunction,
  accountIdentityFunction,
  apiRole,
  boundaryOwnerRole,
  cancellationFunction,
  configurationImporterRole,
  continuationFunction,
  finalizerRole,
  notificationPublishFunction,
  projectAuthorizationFunction,
  projectChangeAppendFunction,
  projectChangeRetainedFunction,
  projectChangeSweepFunction,
  repositoryBindingReadFunction,
  repositoryActivationFunction,
  schedulerRole,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
  workerRunBindingFunction,
  workerRunConfigurationFunction,
  workerRunTotalFunction,
  workerRunTranscriptFunction,
  workerRunTurnsFunction,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

const sourceInsertColumns =
  "base,commit,expected_base,manifest,project,ref,repository,tenant";
const schedulerSourceInsertPrivilege = {
  table_name: "execution_result_source",
  privilege_type: "INSERT",
  columns: sourceInsertColumns,
};
const admittedWorkerColumns = "image,name,published_at,version";
/** The five relations one run's evidence lives in, named once for every case. */
const runEvidenceRelations = [
  "execution_run",
  "execution_run_transcript_batch",
  "execution_run_turn",
  "execution_run_total",
  "execution_run_model_usage",
];
const schedulerReportInsertPrivilege = {
  table_name: "execution_result_report",
  privilege_type: "INSERT",
  columns: "manifest,project,report,tenant",
};

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

test("every runtime role may read only the migration ledger contract", async () => {
  for (const role of [
    apiRole,
    ticketServiceRole,
    selectorServiceRole,
    selectorReviewRole,
    schedulerRole,
    finalizerRole,
  ]) {
    assert.equal(
      await harness.attemptAs(
        role,
        "SELECT version,name FROM schema_migration ORDER BY version",
      ),
      undefined,
    );
  }
});

test("runtime roles cannot activate or write repository history", async () => {
  for (const role of [
    apiRole,
    ticketServiceRole,
    selectorServiceRole,
    schedulerRole,
    finalizerRole,
    workerPlaneRole,
    configurationImporterRole,
  ]) {
    assert.match(
      (await harness.attemptAs(
        role,
        `SELECT ${repositoryActivationFunction}('tenant','project','old','new','epoch','operation','kind','subject')`,
      )) ?? "",
      postgresHarnessDenial(repositoryActivationFunction),
    );
    assert.match(
      (await harness.attemptAs(
        role,
        "INSERT INTO project_repository_activation DEFAULT VALUES",
      )) ?? "",
      postgresHarnessDenial("project_repository_activation"),
    );
  }
});

test("the API reads but cannot replace the installation authority", async () => {
  assert.equal(
    await harness.attemptAs(
      apiRole,
      "SELECT installation_id FROM installation_authority",
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      apiRole,
      "UPDATE installation_authority SET installation_id=installation_id",
    )) ?? "",
    postgresHarnessDenial("installation_authority"),
  );
});

test("only ingress and the writer may name a project's capacity account", async () => {
  const naming = `SELECT ${accountIdentityFunction}('tenant','project')`;
  assert.equal(await harness.attemptAs(ticketServiceRole, naming), undefined);
  assert.equal(await harness.attemptAs(apiRole, naming), undefined);
  for (const role of [schedulerRole, selectorServiceRole]) {
    assert.match(
      (await harness.attemptAs(role, naming)) ?? "",
      postgresHarnessDenial(accountIdentityFunction),
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
    assert.match(refusal ?? "", postgresHarnessDenial("decision_input"));
  }
});

test("the API cannot construct any part of an accepted operation directly", async () => {
  const statements: readonly (readonly [string, string])[] = [
    [
      `INSERT INTO operation
       (tenant,project,operation,authority_kind,authority_subject,admission,
        key_version,key_digest,payload_digest,command,command_tag)
     VALUES ('tenant','project','operation','kind','subject','Ordinary',
       'v1','key','payload','command','Dispatch')`,
      "operation",
    ],
    [
      `UPDATE project SET ingress_next=ingress_next+1
      WHERE tenant='tenant' AND project='project'`,
      "project",
    ],
    [
      `INSERT INTO project_readiness (tenant,project,ready,generation)
     VALUES ('tenant','project',true,1)`,
      "project_readiness",
    ],
    [
      `UPDATE project_readiness SET ready=true, generation=generation+1
      WHERE tenant='tenant' AND project='project'`,
      "project_readiness",
    ],
  ];
  for (const [statement, object] of statements) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(refusal ?? "", postgresHarnessDenial(object));
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

test("a well-formed completion is refused whatever authority it claims", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "privilege-forged-completion",
  );
  const completions = [
    `{"version":1,"command":"Decide","event":{"type":"TaskDone","value":{"ticket":1,"tid":1,"verdict":"Pass","result":{"manifest":1,"digest":1,"schema":1}}}}`,
    `{"version":1,"command":"Decide","event":{"type":"ExecutionBlocked","value":{"ticket":1,"reason":"ExecutionProfileUnavailable"}}}`,
  ];
  /**
   * The claimed kind is the caller's own text and acceptance compares it to
   * nothing, so the boundary's own kind has to be refused exactly as a
   * principal's is: a rule that only caught `User` would cost a forger one
   * string.
   */
  const kinds = ["User", "ExecutionScheduler", "Finalizer"];
  for (const [index, command] of completions.entries()) {
    for (const kind of kinds) {
      const operation = `forged-${String(index)}-${kind}`;
      const failure = await harness.attemptAs(
        apiRole,
        `SELECT * FROM ${acceptanceFunction}(
          '${partition.tenant}', '${partition.project}', '${operation}', '${kind}', 'subject',
          'v1', 'key-${operation}', 'payload', ARRAY['key-${operation}'], ARRAY['payload'],
          '${command}', 10, 20)`,
      );
      assert.equal(failure, undefined);
    }
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

test("no membership may be granted the authority a boundary submits under", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "privilege-boundary-membership",
  );
  for (const kind of ["ExecutionScheduler", "Finalizer"]) {
    await assert.rejects(
      harness.query(
        `INSERT INTO project_membership
           (principal,tenant,project,authority_kind,authority_subject,
            may_read,may_mutate,may_dispatch,may_propose)
         VALUES ($1,$2,$3,$4,'subject',true,true,false,false)`,
        [`principal-${kind}`, partition.tenant, partition.project, kind],
      ),
      /project_membership_grants_no_boundary_authority/,
    );
  }
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
    assert.match(refusal ?? "", postgresHarnessDenial(relation));
  }
});

test("the API cannot bypass versioned authoring functions", async () => {
  for (const [statement, object] of [
    [
      "INSERT INTO configuration_revision DEFAULT VALUES",
      "configuration_revision",
    ],
    ["INSERT INTO draft DEFAULT VALUES", "draft"],
    ["INSERT INTO draft_revision DEFAULT VALUES", "draft_revision"],
    ["INSERT INTO draft_brief DEFAULT VALUES", "draft_brief"],
    ["INSERT INTO draft_brief_link DEFAULT VALUES", "draft_brief_link"],
    ["UPDATE draft_brief SET intent='forged'", "draft_brief"],
    [
      "INSERT INTO repository_configuration_provenance DEFAULT VALUES",
      "repository_configuration_provenance",
    ],
    [
      "UPDATE repository_configuration_provenance SET name='changed'",
      "repository_configuration_provenance",
    ],
    [
      "DELETE FROM repository_configuration_provenance",
      "repository_configuration_provenance",
    ],
    ["UPDATE draft SET state='Released'", "draft"],
    ["UPDATE project SET ticket_next=ticket_next+1", "project"],
  ] as readonly (readonly [string, string])[]) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(refusal ?? "", postgresHarnessDenial(object));
  }
});

test("the API reads one repository binding only through its boundary", async () => {
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT * FROM ${repositoryBindingReadFunction}('tenant','project')`,
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(apiRole, "SELECT * FROM project_repository")) ??
      "",
    postgresHarnessDenial("project_repository"),
  );
});

test("the ticket service reads one repository binding only through its boundary", async () => {
  assert.equal(
    await harness.attemptAs(
      ticketServiceRole,
      `SELECT * FROM ${repositoryBindingReadFunction}('tenant','project')`,
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      ticketServiceRole,
      "SELECT * FROM project_repository",
    )) ?? "",
    postgresHarnessDenial("project_repository"),
  );
});

test("runtime roles cannot write notification rows directly", async () => {
  for (const role of [apiRole, ticketServiceRole]) {
    for (const [statement, object] of [
      [
        "INSERT INTO project_notification DEFAULT VALUES",
        "project_notification",
      ],
      ["DELETE FROM project_notification", "project_notification"],
      ["UPDATE project SET notification_next=notification_next+1", "project"],
    ] as readonly (readonly [string, string])[]) {
      const refusal = await harness.attemptAs(role, statement);
      assert.match(refusal ?? "", postgresHarnessDenial(object));
    }
  }
  const refusal = await harness.attemptAs(
    apiRole,
    `SELECT ${notificationPublishFunction}('t','p','Draft','1',NULL,1)`,
  );
  assert.match(
    refusal ?? "",
    postgresHarnessDenial(notificationPublishFunction),
  );
});

test("the change log is written through its own boundary and read by the API alone", async () => {
  for (const role of [
    apiRole,
    ticketServiceRole,
    schedulerRole,
    finalizerRole,
  ]) {
    for (const statement of [
      `INSERT INTO project_change (tenant,project,kind,resource)
       VALUES ('tenant','project','Ticket','1')`,
      "UPDATE project_change SET resource=resource",
      "DELETE FROM project_change",
    ]) {
      assert.match(
        (await harness.attemptAs(role, statement)) ?? "",
        postgresHarnessDenial("project_change"),
      );
    }
    assert.match(
      (await harness.attemptAs(
        role,
        "INSERT INTO project_notification DEFAULT VALUES",
      )) ?? "",
      postgresHarnessDenial("project_notification"),
    );
  }
  for (const permitted of [
    "SELECT sequence,tenant,project,kind,resource,created_at FROM project_change",
    `SELECT ${projectChangeSweepFunction}(1)`,
    `SELECT ${projectChangeRetainedFunction}(1)`,
  ]) {
    assert.equal(await harness.attemptAs(apiRole, permitted), undefined);
  }
  assert.match(
    (await harness.attemptAs(
      apiRole,
      `SELECT ${projectChangeAppendFunction}('tenant','project','Ticket','1')`,
    )) ?? "",
    postgresHarnessDenial(projectChangeAppendFunction),
  );
  for (const role of [ticketServiceRole, schedulerRole, finalizerRole]) {
    assert.match(
      (await harness.attemptAs(
        role,
        `SELECT ${projectChangeSweepFunction}(1)`,
      )) ?? "",
      postgresHarnessDenial(projectChangeSweepFunction),
    );
  }
  assert.equal(
    await harness.attemptAs(
      ticketServiceRole,
      `SELECT ${projectChangeAppendFunction}('tenant','project','NativeAction','1')`,
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      finalizerRole,
      `SELECT ${projectChangeAppendFunction}('tenant','project','Ticket','1')`,
    )) ?? "",
    postgresHarnessDenial(projectChangeAppendFunction),
  );
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
    assert.match(refusal ?? "", postgresHarnessDenial("operation"));
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

test("the API can resolve access but cannot enumerate or change memberships", async () => {
  for (const statement of [
    "SELECT * FROM project_membership",
    "INSERT INTO project_membership DEFAULT VALUES",
    "UPDATE project_membership SET may_read=true",
    "DELETE FROM project_membership",
  ]) {
    const refusal = await harness.attemptAs(apiRole, statement);
    assert.match(refusal ?? "", postgresHarnessDenial("project_membership"));
  }
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT * FROM ${projectAuthorizationFunction}('principal','tenant','project','Read')`,
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

/**
 * A `SECURITY DEFINER` body runs with the privileges of the function's owner,
 * so who owns one is the whole of what it is allowed to be. The migration hands
 * every one of them to the boundary owner, and this asks the server rather than
 * the chain whether any was left behind: the identity that applied the chain is
 * whatever a deployment ran it as, and `deploy/rig/postgres/postgres-roles.sql`
 * argues from none of them being owned by it.
 */
test("every security-definer function is owned by the boundary owner and none by whoever migrated", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT DISTINCT r.rolname AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname='public' AND p.prosecdef
        ORDER BY r.rolname`,
    ),
    [{ owner: boundaryOwnerRole }],
  );
});

/**
 * The other side of the same handover, which decides whether a later GRANT
 * needs the membership `deploy/rig/postgres/postgres-roles.sql` gives: the
 * migrating identity is left every relation and no function but a trigger
 * body. A CHECK helper or a `SECURITY DEFINER` body left behind turns this red
 * where the ownership case above would still pass.
 */
test("whoever migrated keeps every relation and no body but a trigger function", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT count(DISTINCT c.relowner)::text AS owners,
              bool_or(r.rolname = $1) AS boundary
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname='public'`,
      [boundaryOwnerRole],
    ),
    [{ owners: "1", boundary: false }],
  );
  assert.deepEqual(
    await harness.query(
      `SELECT DISTINCT pg_get_function_result(p.oid) AS returns, p.prosecdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname='public' AND r.rolname <> $1
        ORDER BY 1`,
      [boundaryOwnerRole],
    ),
    [{ returns: "trigger", prosecdef: false }],
  );
});

/**
 * Ownership rather than `SECURITY DEFINER` is what decides whether a GRANT by
 * the migrating identity lands, and this is the case that separates them: the
 * boundary owner holds an ordinary body too, and granting EXECUTE on it is the
 * whole of a migration this chain carries.
 */
test("the function a migration grants execute on is the boundary owner's and is no security definer", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT r.rolname AS owner, p.prosecdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname='public' AND p.proname = $1`,
      [accountIdentityFunction],
    ),
    [{ owner: boundaryOwnerRole, prosecdef: false }],
  );
});

test("the API reads a ticket's open questions and no more of the desk", async () => {
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT a.action,a.kind,a.authorizing_seq,a.state,r.resolution
         FROM native_action a
         JOIN native_action_resolution r USING (tenant, project, action)
        WHERE a.ticket=1`,
    ),
    undefined,
  );
  for (const column of [
    "attempt",
    "resolution",
    "effect_position",
    "action_version",
    "required_capability",
    "reason",
  ]) {
    const refusal = await harness.attemptAs(
      apiRole,
      `SELECT ${column} FROM native_action`,
    );
    assert.match(refusal ?? "", postgresHarnessDenial("native_action"));
  }
  assert.deepEqual(
    await harness.query(
      `SELECT table_name, privilege_type,
              string_agg(column_name, ',' ORDER BY column_name) AS columns
         FROM information_schema.role_column_grants
        WHERE grantee=$1 AND table_schema='public'
          AND table_name IN ('native_action','native_action_resolution')
        GROUP BY table_name, privilege_type
        ORDER BY table_name, privilege_type`,
      [apiRole],
    ),
    [
      {
        table_name: "native_action",
        privilege_type: "SELECT",
        columns: "action,authorizing_seq,kind,project,state,tenant,ticket",
      },
      {
        table_name: "native_action_resolution",
        privilege_type: "SELECT",
        columns: "action,project,resolution,tenant",
      },
    ],
  );
});

test("the scheduler cannot write ticket state or append history", async () => {
  for (const [statement, object] of [
    ["INSERT INTO journal_entry DEFAULT VALUES", "journal_entry"],
    ["UPDATE journal_entry SET entry='rewritten'", "journal_entry"],
    ["DELETE FROM journal_entry", "journal_entry"],
    ["INSERT INTO ticket_projection DEFAULT VALUES", "ticket_projection"],
    ["UPDATE ticket_projection SET phase='Done'", "ticket_projection"],
    ["UPDATE project SET head=1", "project"],
    ["UPDATE project SET lifecycle='Suspended'", "project"],
    ["INSERT INTO execution_request DEFAULT VALUES", "execution_request"],
    ["INSERT INTO finalization_request DEFAULT VALUES", "finalization_request"],
    ["INSERT INTO project_continuation DEFAULT VALUES", "project_continuation"],
    ["UPDATE native_action SET state='Resolved'", "native_action"],
  ] as readonly (readonly [string, string])[]) {
    const refusal = await harness.attemptAs(schedulerRole, statement);
    assert.match(refusal ?? "", postgresHarnessDenial(object));
  }
});

test("the scheduler reaches the decision mailbox through one function and no other door", async () => {
  for (const [statement, object] of [
    [
      `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation)
     VALUES ('tenant','project',1,'Operation','input','Completion',1)`,
      "decision_input",
    ],
    ["UPDATE decision_input SET state='Cancelled'", "decision_input"],
    ["INSERT INTO operation DEFAULT VALUES", "operation"],
    ["UPDATE operation SET command='{}'", "operation"],
    ["UPDATE project SET ingress_next=1", "project"],
    [
      "INSERT INTO project_readiness (tenant,project,ready,generation) VALUES ('t','p',true,1)",
      "project_readiness",
    ],
    ["UPDATE project_readiness SET ready=true", "project_readiness"],
    [
      `SELECT ${acceptanceFunction}('t','p','o','User','s','v1','k','p',
       ARRAY['k'],ARRAY['p'],'{}',10,20)`,
      acceptanceFunction,
    ],
    [
      `SELECT ${cancellationFunction}('t','p','o','User','s')`,
      cancellationFunction,
    ],
    [`SELECT ${continuationFunction}('t','p',1,'c')`, continuationFunction],
    [
      `SELECT ${notificationPublishFunction}('t','p','Draft','1',NULL,1)`,
      notificationPublishFunction,
    ],
  ] as readonly (readonly [string, string])[]) {
    const refusal = await harness.attemptAs(schedulerRole, statement);
    assert.match(refusal ?? "", postgresHarnessDenial(object));
  }
});

test("the scheduler cannot rewrite a settlement, a result or its own entitlement", async () => {
  for (const [statement, object] of [
    ["UPDATE execution SET outcome='Passed'", "execution"],
    ["UPDATE execution SET result_manifest='manifest'", "execution"],
    ["UPDATE execution SET completion_operation='operation'", "execution"],
    ["UPDATE execution SET account='another'", "execution"],
    ["DELETE FROM execution", "execution"],
    ["UPDATE execution_result SET verdict='Pass'", "execution_result"],
    ["DELETE FROM execution_result", "execution_result"],
    [
      "UPDATE execution_result_artifact SET bytes=0",
      "execution_result_artifact",
    ],
    ["DELETE FROM execution_result_artifact", "execution_result_artifact"],
    ["DELETE FROM execution_attempt", "execution_attempt"],
    ["UPDATE execution_attempt SET attempt_number=1", "execution_attempt"],
    ["DELETE FROM scheduler_incident", "scheduler_incident"],
    ["UPDATE capacity_account SET maximum=9001", "capacity_account"],
    [
      "INSERT INTO capacity_account (account,cluster,reserved,maximum,policy_revision) VALUES ('a','default',0,9001,1)",
      "capacity_account",
    ],
    ["UPDATE execution_cluster SET slots_max=9001", "execution_cluster"],
    ["INSERT INTO recovery_epoch (epoch) VALUES ('minted')", "recovery_epoch"],
  ] as readonly (readonly [string, string])[]) {
    const refusal = await harness.attemptAs(schedulerRole, statement);
    assert.match(refusal ?? "", postgresHarnessDenial(object));
  }
});

/** Every non-SELECT grant the scheduler role holds, which is the whole of its write surface. */
const schedulerWritePrivileges = [
  {
    table_name: "admitted_worker",
    privilege_type: "INSERT",
    columns: admittedWorkerColumns,
  },
  {
    table_name: "admitted_worker",
    privilege_type: "UPDATE",
    columns: admittedWorkerColumns,
  },
  {
    table_name: "execution",
    privilege_type: "INSERT",
    columns:
      "account,cluster,configuration_digest,configuration_revision,execution,platform_default_version,project,requirement_digest,requirement_identity,requirement_source,requirement_value,source_request,task,tenant,ticket",
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
      "attempt,attempt_number,capability,capability_secret_digest,cleanup_completed_at,ended_at,evidence,execution,generation,lease_expires_at,lease_owner,manifest,opened_at,project,recovery_epoch,state,tenant,workload",
  },
  {
    table_name: "execution_attempt",
    privilege_type: "UPDATE",
    columns:
      "cleanup_completed_at,ended_at,evidence,generation,lease_expires_at,lease_owner,state,workload",
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
  schedulerReportInsertPrivilege,
  schedulerSourceInsertPrivilege,
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
];

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
    schedulerWritePrivileges,
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
      "admitted_worker",
      "capacity_account",
      "configuration_revision",
      "draft_brief",
      "draft_brief_link",
      "execution",
      "execution_attempt",
      "execution_cluster",
      "execution_request",
      "execution_request_task",
      "execution_result",
      "execution_result_artifact",
      "execution_result_report",
      "execution_result_source",
      "input_bundle_reference",
      "project",
      "recovery_epoch",
      "scheduler_incident",
      "schema_migration",
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

/**
 * What a retired role can still hold is an object or a privilege in the
 * database it was retired from, and `pg_shdepend` records both per database —
 * all but a grant on the database itself, which `pg_database` being a shared
 * catalogue leaves tagged with no database at all, so those rows are read by
 * the database they name instead. Membership in another role stays outside
 * even that: `pg_shdepend` records none of it, so this case does not see it,
 * and like the role name it is the cluster's rather than this database's — a
 * cluster hosting a sibling database may carry the role for that one and no
 * schema here decides it, and a migration that created it again is
 * `test/deploy/postgresRoles.test.ts`'s to refuse.
 */
test("the retired dispatcher role owns nothing here and is granted nothing here", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM pg_shdepend d
         JOIN pg_roles r ON r.oid = d.refobjid
        WHERE r.rolname = 'chuggy_dispatcher'
          AND (d.dbid = (SELECT oid FROM pg_database
                          WHERE datname = current_database())
               OR (d.classid = 'pg_database'::regclass
                   AND d.objid = (SELECT oid FROM pg_database
                                   WHERE datname = current_database())))`,
    ),
    [{ count: "0" }],
  );
});

/**
 * The worker plane reaches run evidence through four functions and holds no
 * table privilege on the five relations behind them, so a bearer that got past
 * one boundary still cannot write a row the others own.
 */
test("run evidence is written through its boundary and read by the API alone", async () => {
  for (const named of [
    `${workerRunConfigurationFunction}('digest',1,'path','digest',1)`,
    `${workerRunTranscriptFunction}('digest',1,1,'path','digest',1,1)`,
    `${workerRunTurnsFunction}('digest',1,'[]'::jsonb)`,
    `${workerRunTotalFunction}('digest',1,1,1,1,1,1,1,1,1,'List',1,NULL,NULL,'[]'::jsonb)`,
  ]) {
    assert.equal(
      await harness.attemptAs(workerPlaneRole, `SELECT ${named}`),
      undefined,
    );
    for (const role of [
      apiRole,
      ticketServiceRole,
      schedulerRole,
      finalizerRole,
    ])
      assert.match(
        (await harness.attemptAs(role, `SELECT ${named}`)) ?? "",
        /permission denied for function/u,
      );
  }
  for (const relation of runEvidenceRelations) {
    assert.equal(
      await harness.attemptAs(apiRole, `SELECT tenant FROM ${relation}`),
      undefined,
    );
    assert.match(
      (await harness.attemptAs(
        workerPlaneRole,
        `SELECT tenant FROM ${relation}`,
      )) ?? "",
      postgresHarnessDenial(relation),
    );
    assert.match(
      (await harness.attemptAs(apiRole, `DELETE FROM ${relation}`)) ?? "",
      postgresHarnessDenial(relation),
    );
  }
  assert.equal(
    await harness.attemptAs(
      apiRole,
      "SELECT report FROM execution_result_report",
    ),
    undefined,
  );
});

test("the binding every evidence function opens with is nobody's to call", async () => {
  for (const role of [
    apiRole,
    ticketServiceRole,
    schedulerRole,
    finalizerRole,
    workerPlaneRole,
  ])
    assert.match(
      (await harness.attemptAs(
        role,
        `SELECT * FROM ${workerRunBindingFunction}('digest',1)`,
      )) ?? "",
      /permission denied for function/u,
    );
});
