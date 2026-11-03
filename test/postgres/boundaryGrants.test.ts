/**
 * Who owns each door of the installed schema and which roles may reach it: the
 * doors, the columns behind them, and the predicates no role may call.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessPlaneRole,
  agentAccountFunction,
  agentAccountPauseFunction,
  agentAccountPressFunction,
  agentAccountSessionPausedFunction,
  agentAccountSettingsFunction,
  agentAccountSettingWriteFunction,
  agentAccountStandingFunction,
  apiRole,
  boundaryOwnerRole,
  configurationFollowingCandidatesFunction,
  configurationFollowingMoveFunction,
  configurationImporterRole,
  draftCreateFunction,
  draftReviseFunction,
  executionPlacementSetFunction,
  finalizerRole,
  forgeInstallationRecordFunction,
  leadOpenFunction,
  leadRefusalReadFunction,
  leadSessionFunction,
  metricsPlaneRole,
  poolPlaneRole,
  projectChangeAppendFunction,
  projectChangeRetainedFunction,
  projectChangeSweepFunction,
  projectCreateFunction,
  projectCreationGrantsFunction,
  rateLimitedTicketsFunction,
  rateLimitResumeFunction,
  repositoryBindingListFunction,
  repositoryBindingReadFunction,
  repositoryBindingWriteFunction,
  repositoryConfigurationImportRecordFunction,
  repositoryLandingReadFunction,
  repositoryLandingWriteFunction,
  repositoryRetirementWriteFunction,
  schedulerRole,
  selectorServiceRole,
  sessionPlacementSetFunction,
  sessionRouteFunction,
  sessionRunnerStandingFunction,
  statusMoveFunction,
  ticketLandingsReadFunction,
  ticketRateLimitResumableFunction,
  ticketServiceRole,
  ticketUsageResumeFunction,
  workerPlaneRole,
  workerPoolFenceFunction,
  workerPoolReleaseFunction,
  workerRunLimitFunction,
  workerRunUsageFunction,
} from "../../src/adapters/postgres/schema.ts";
import type pg from "pg";
import { assertDoorsStandOwned, migratedDatabase } from "./migrationHarness.ts";

const appendCall = `${projectChangeAppendFunction}(text,text,text,text)`;

const projectChangeExecutors = [
  [schedulerRole, appendCall, true],
  [finalizerRole, appendCall, false],
  [apiRole, appendCall, false],
  [ticketServiceRole, appendCall, true],
  [apiRole, `${projectChangeSweepFunction}(bigint)`, true],
  [apiRole, `${projectChangeRetainedFunction}(bigint)`, true],
  [schedulerRole, `${projectChangeSweepFunction}(bigint)`, false],
  [finalizerRole, `${projectChangeSweepFunction}(bigint)`, false],
] as const;

const projectChangeApiPrivileges = [
  ["SELECT", true],
  ["INSERT", false],
  ["UPDATE", false],
  ["DELETE", false],
] as const;

test("the baseline grants the change log's doors to the roles that reach them", async () => {
  await migratedDatabase("project_change_grants", async (subject) => {
    for (const [role, signature, granted] of projectChangeExecutors) {
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, signature],
          )
        ).rows[0]?.granted,
        granted,
        `${role} may execute ${signature}`,
      );
    }
    for (const [privilege, granted] of projectChangeApiPrivileges) {
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'project_change',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        granted,
        `${apiRole} holds ${privilege} on the change log`,
      );
    }
  });
});

test("the baseline opens the brief's doors to the roles that reach it and no others", async () => {
  await migratedDatabase("ticket_brief_grants", async (subject) => {
    for (const [role, relation, privilege, granted] of [
      [apiRole, "draft_brief", "SELECT", true],
      [apiRole, "draft_brief", "INSERT", false],
      [apiRole, "draft_brief", "UPDATE", false],
      [apiRole, "draft_brief_link", "SELECT", true],
      [apiRole, "draft_brief_link", "INSERT", false],
      [apiRole, "draft_brief_image", "SELECT", true],
      [apiRole, "draft_brief_image", "INSERT", false],
      [ticketServiceRole, "draft_brief", "SELECT", true],
      [ticketServiceRole, "draft_brief", "UPDATE", false],
      [schedulerRole, "draft_brief", "SELECT", false],
      [schedulerRole, "draft_brief_link", "SELECT", false],
      [schedulerRole, "draft_brief_image", "SELECT", false],
      [schedulerRole, "ticket_definition", "SELECT", true],
      [finalizerRole, "draft_brief", "SELECT", false],
      [finalizerRole, "ticket_definition", "SELECT", true],
      [boundaryOwnerRole, "draft_brief", "INSERT", true],
      [boundaryOwnerRole, "draft_brief_link", "DELETE", true],
      [boundaryOwnerRole, "draft_brief_image", "DELETE", true],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) AS granted",
            [role, relation, privilege],
          )
        ).rows[0]?.granted,
        granted,
        `${role} holds ${privilege} on ${relation}`,
      );
  });
});

const journalInstantsColumns = [
  "tenant",
  "project",
  "seq",
  "entry",
  "committed_at",
];

test("the baseline opens five journal columns to the API and leaves the rest shut", async () => {
  await migratedDatabase("journal_instants_grants", async (subject) => {
    const columns = await subject.query<{ column: string; granted: boolean }>(
      `SELECT a.attname AS column,
              has_column_privilege($1,'journal_entry',a.attname,'SELECT') AS granted
         FROM pg_attribute a
        WHERE a.attrelid='journal_entry'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [apiRole],
    );
    assert.ok(
      columns.rows.length > journalInstantsColumns.length,
      "the journal has columns beyond the ones this grant opens",
    );
    assert.deepEqual(
      columns.rows.filter((each) => each.granted).map((each) => each.column),
      journalInstantsColumns,
      `what ${apiRole} may read of journal_entry`,
    );
    for (const privilege of ["INSERT", "UPDATE", "DELETE"] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'journal_entry',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        `${apiRole} holds ${privilege} on journal_entry`,
      );
  });
});

const leadSelectorDoorsPaged = "standing_agentic_refusals(text,text,bigint)";

const leadSelectorDoorsAdded = [
  "standing_agentic_refusals_among(text,text,bigint[])",
];

function migrationDoorExecutes(
  subject: pg.Pool,
): (role: string, signature: string) => Promise<boolean | undefined> {
  return async (role, signature) =>
    (
      await subject.query<{ granted: boolean }>(
        "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
        [role, signature],
      )
    ).rows[0]?.granted;
}

async function migrationLeadDoorsAreStrangers(
  executes: (role: string, signature: string) => Promise<boolean | undefined>,
  doors: readonly string[],
): Promise<void> {
  for (const door of doors)
    for (const stranger of ["public", ticketServiceRole, finalizerRole])
      assert.equal(
        await executes(stranger, door),
        false,
        `${stranger} holds nothing on ${door}`,
      );
}

test("the baseline grants the ticket-set standing door to the selector alone", async () => {
  await migratedDatabase("standing_among_grants", async (subject) => {
    const executes = migrationDoorExecutes(subject);
    for (const door of leadSelectorDoorsAdded) {
      assert.equal(await executes(selectorServiceRole, door), true, door);
      assert.equal(await executes(apiRole, door), false, door);
    }
    await migrationLeadDoorsAreStrangers(executes, leadSelectorDoorsAdded);
  });
});

test("the baseline takes the paged standing back off the selector", async () => {
  await migratedDatabase("standing_paged_revoked", async (subject) => {
    const executes = migrationDoorExecutes(subject);
    assert.equal(
      await executes(selectorServiceRole, leadSelectorDoorsPaged),
      false,
      "no selector read opens it, and a grant nothing opens is one a check cannot tell from a grant something needs",
    );
    assert.equal(
      await executes(
        apiRole,
        "read_standing_agentic_refusals(text,text,bigint)",
      ),
      true,
      "the console still draws a project's standing refusals",
    );
  });
});

test("the landing doors migrate without exposing the relation they read", async () => {
  await migratedDatabase("i90grants", async (subject) => {
    for (const signature of [
      `${repositoryLandingReadFunction}(text,text,text)`,
      `${repositoryLandingWriteFunction}(text,text,text,text,text,boolean,boolean)`,
    ])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [apiRole, signature],
          )
        ).rows[0]?.granted,
        true,
        signature,
      );
    for (const privilege of ["SELECT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'project_repository',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        privilege,
      );
    assert.equal(
      (
        await subject.query<{ granted: boolean }>(
          "SELECT has_column_privilege($1,'project_repository','landing_mode','UPDATE') AS granted",
          [boundaryOwnerRole],
        )
      ).rows[0]?.granted,
      true,
    );
  });
});

test("the draft doors are owned and granted to their callers", async () => {
  await migratedDatabase("i91grants", async (subject) => {
    await assertDoorsStandOwned(subject, [
      `${draftCreateFunction}(text,text,text,text,bigint,text,text,text,text[],text[],text[],text,text,text,text,text,text,text,text,text)`,
      `${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text,text[],text[],text[],text,text,text,text,text,text,text,text)`,
    ]);
  });
});

test("repository doors preserve their ownership and restricted grants", async () => {
  await migratedDatabase("i94grants", async (subject) => {
    await assertDoorsStandOwned(subject, [
      `${repositoryRetirementWriteFunction}(text,text,text)`,
      `${repositoryBindingListFunction}(text,text,bigint)`,
      `${repositoryLandingReadFunction}(text,text,text)`,
      `${repositoryLandingWriteFunction}(text,text,text,text,text,boolean,boolean)`,
      `${repositoryBindingWriteFunction}(text,text,text,text,text,text,text)`,
      `${draftCreateFunction}(text,text,text,text,bigint,text,text,text,text[],text[],text[],text,text,text,text,text,text,text,text,text)`,
      `${draftReviseFunction}(text,text,bigint,bigint,text,text,text,text,text[],text[],text[],text,text,text,text,text,text,text,text)`,
    ]);
    for (const privilege of ["SELECT", "UPDATE", "DELETE"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'project_repository',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        privilege,
      );
    for (const [role, column, held] of [
      [boundaryOwnerRole, "retired_at", true],
      [boundaryOwnerRole, "landing_mode", true],
      [boundaryOwnerRole, "bound_at", false],
      [apiRole, "retired_at", false],
      [apiRole, "landing_mode", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_column_privilege($1,'project_repository',$2,'UPDATE') AS granted",
            [role, column],
          )
        ).rows[0]?.granted,
        held,
        `${role}: ${column}`,
      );
  });
});

/** The validator the fan-out left, named as the grants that govern it name it. */
const fanoutValidator = "public.decision_event_is_valid(jsonb)";

test("the validator replaced whole stays the boundary owner's and nobody's to execute", async () => {
  await migratedDatabase("fanout_validator", async (subject) => {
    for (const role of [apiRole, ticketServiceRole, "public"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, fanoutValidator],
          )
        ).rows[0]?.granted,
        false,
        role,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [fanoutValidator],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
    );
  });
});

/** The identity as the relation holds it, in the order the columns arrived. */
const identityColumns = [
  "tenant",
  "project",
  "request",
  "task",
  "kind",
  "stage",
  "cycle",
  "generation",
  "evaluator",
];

test("the api reads every column of the identity and writes none of them", async () => {
  await migratedDatabase("identity_grants", async (subject) => {
    const columns = await subject.query<{ column: string; granted: boolean }>(
      `SELECT a.attname AS column,
              has_column_privilege($1,'execution_request_task',a.attname,'SELECT') AS granted
         FROM pg_attribute a
        WHERE a.attrelid='execution_request_task'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [apiRole],
    );
    assert.deepEqual(
      columns.rows.map((each) => each.column),
      identityColumns,
      "the relation holds the identity and nothing beside it",
    );
    assert.deepEqual(
      columns.rows.filter((each) => each.granted).map((each) => each.column),
      identityColumns,
      `what ${apiRole} may read of execution_request_task`,
    );
    for (const privilege of ["INSERT", "UPDATE", "DELETE"] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_table_privilege($1,'execution_request_task',$2) AS granted",
            [apiRole, privilege],
          )
        ).rows[0]?.granted,
        false,
        `${apiRole} holds ${privilege} on execution_request_task`,
      );
  });
});

/** The door replaced whole, named as the grants that govern it name it. */
const identityDoor =
  "public.submit_task_completion(text,text,text,bigint,bigint,integer,text,text,text,text,text,text)";

test("the door replaced whole keeps its owner and the one role that may open it", async () => {
  await migratedDatabase("identity_door", async (subject) => {
    for (const [role, granted] of [
      [schedulerRole, true],
      [apiRole, false],
      [ticketServiceRole, false],
      ["public", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, identityDoor],
          )
        ).rows[0]?.granted,
        granted,
        role,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [identityDoor],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
    );
  });
});

/** What each role may do with the two relations a release fills, and what it may not. */
const releasedPrivileges: readonly (readonly [
  string,
  string,
  string,
  boolean,
])[] = [
  ["ticket_definition", ticketServiceRole, "SELECT", true],
  ["ticket_definition", ticketServiceRole, "INSERT", true],
  ["ticket_definition", ticketServiceRole, "UPDATE", false],
  ["ticket_definition", boundaryOwnerRole, "SELECT", true],
  ["ticket_definition", boundaryOwnerRole, "INSERT", false],
  ["ticket_definition", apiRole, "SELECT", false],
  ["ticket_source", ticketServiceRole, "INSERT", true],
  ["ticket_source", boundaryOwnerRole, "INSERT", true],
  ["ticket_source", boundaryOwnerRole, "UPDATE", false],
  ["ticket_source", schedulerRole, "SELECT", true],
  ["ticket_source", schedulerRole, "INSERT", false],
  ["ticket_source", apiRole, "INSERT", false],
];

/** The columns the api reads off a ticket's source, which is every one it has. */
const releasedSourceColumns = [
  "tenant",
  "project",
  "ticket",
  "source",
  "repository",
  "commit",
  "ref",
];

/** The columns the door that builds an obligation reads a release back out of. */
const releasedEntryColumns = ["tenant", "project", "entry"];

test("the two relations a release fills are open to the roles that write and read them and no others", async () => {
  await migratedDatabase("released_grants", async (subject) => {
    for (const [relation, role, privilege, granted] of releasedPrivileges)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) AS held",
            [role, `public.${relation}`, privilege],
          )
        ).rows[0]?.held,
        granted,
        `${role} on ${relation} ${privilege}`,
      );
    for (const column of releasedSourceColumns)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_column_privilege($1,'public.ticket_source',$2,'SELECT') AS held",
            [apiRole, column],
          )
        ).rows[0]?.held,
        true,
        `${apiRole} reads ticket_source.${column}`,
      );
    for (const column of releasedEntryColumns)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            "SELECT has_column_privilege($1,'public.journal_entry',$2,'SELECT') AS held",
            [boundaryOwnerRole, column],
          )
        ).rows[0]?.held,
        true,
        `${boundaryOwnerRole} reads journal_entry.${column}`,
      );
    assert.equal(
      (
        await subject.query<{ held: boolean }>(
          "SELECT has_table_privilege($1,'public.journal_entry','INSERT') AS held",
          [boundaryOwnerRole],
        )
      ).rows[0]?.held,
      false,
      `${boundaryOwnerRole} writes no journal entry`,
    );
  });
});

/** The predicates the arms weigh a reference and a task definition with. */
const releasedPredicates = [
  "public.command_reference(jsonb)",
  "public.command_task_definition(jsonb)",
];

/** Asserts each predicate is the boundary owner's and no runtime role's to execute. */
async function predicatesClosed(
  subject: pg.Pool,
  predicates: readonly string[],
): Promise<void> {
  for (const predicate of predicates) {
    for (const role of [apiRole, ticketServiceRole, schedulerRole, "public"])
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, predicate],
          )
        ).rows[0]?.granted,
        false,
        `${role} on ${predicate}`,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [predicate],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
      predicate,
    );
  }
}

test("the reference predicates are the boundary owner's and nobody's to execute", async () => {
  await migratedDatabase("released_predicates", async (subject) => {
    await predicatesClosed(subject, releasedPredicates);
  });
});

/** The predicates 014 installs, each the boundary owner's and nobody else's to execute. */
const eventsPredicates = [
  "public.released_ticket_is_valid(jsonb)",
  "public.task_identity_is_valid(jsonb)",
  "public.validated_task_result_is_valid(jsonb)",
  "public.task_report_is_valid(jsonb)",
  "public.decision_command_is_valid(jsonb)",
  "public.journal_entry_is_an_event()",
];

test("the predicates the events arrive with are the boundary owner's and nobody's to execute", async () => {
  await migratedDatabase("events_owners", async (subject) => {
    await predicatesClosed(subject, eventsPredicates);
  });
});

test("the command validator rebuilt whole stays the boundary owner's and nobody's to execute", async () => {
  await migratedDatabase("commands_owners", async (subject) => {
    await predicatesClosed(subject, [
      "public.decision_command_is_valid(jsonb)",
    ]);
  });
});

/** A function as the installed schema declares it: whether it runs as its owner, the roles that may execute it, and roles named because they may not. */
interface DoorDeclared {
  readonly signature: string;
  readonly definer: boolean;
  readonly callers: readonly string[];
  readonly strangers: readonly string[];
}

/** A door: a definer, owned by the boundary owner and executable by `callers` alone among the roles named. */
function boundaryGrantsDoor(
  signature: string,
  callers: readonly string[],
  strangers: readonly string[],
): DoorDeclared {
  return { signature, definer: true, callers, strangers };
}

const boundaryGrantsSettingsWrite =
  "update_selector_project_settings(text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text)";

/** The doors and functions a role reaches the schema through, and the roles each is shut to. */
const boundaryGrantsDoors: readonly DoorDeclared[] = [
  boundaryGrantsDoor(
    `${workerPoolFenceFunction}(text,text,text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${workerPoolReleaseFunction}(text,text,text,text,text)`,
    [poolPlaneRole],
    [schedulerRole, workerPlaneRole, apiRole],
  ),
  {
    signature: `${statusMoveFunction}(text,text)`,
    definer: false,
    callers: [schedulerRole],
    strangers: [poolPlaneRole],
  },
  boundaryGrantsDoor(
    `${projectCreateFunction}(text,text,text,boolean,text,text,text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${projectCreationGrantsFunction}(text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${forgeInstallationRecordFunction}(text,text,text,text,text,text,text,text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${executionPlacementSetFunction}(text,text,text,text,text,text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${sessionRouteFunction}(text,text,text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${sessionRunnerStandingFunction}(text,text,text,bigint)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${sessionPlacementSetFunction}(text,text,text,text,text,text)`,
    [apiRole],
    [schedulerRole, workerPlaneRole, poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${leadSessionFunction}(text,text)`,
    [selectorServiceRole],
    [apiRole, schedulerRole, workerPlaneRole],
  ),
  boundaryGrantsDoor(
    `${leadOpenFunction}(text,text,text,text,text,text,bigint)`,
    [selectorServiceRole],
    [apiRole, workerPlaneRole],
  ),
  boundaryGrantsDoor(
    boundaryGrantsSettingsWrite,
    [apiRole],
    [selectorServiceRole, workerPlaneRole],
  ),
  boundaryGrantsDoor(
    `${leadRefusalReadFunction}(text,text)`,
    [apiRole],
    [selectorServiceRole],
  ),
  boundaryGrantsDoor(
    `${repositoryBindingListFunction}(text,text,bigint)`,
    [apiRole, schedulerRole],
    [finalizerRole],
  ),
  boundaryGrantsDoor(
    `${repositoryLandingReadFunction}(text,text,text)`,
    [apiRole, workerPlaneRole, finalizerRole],
    [],
  ),
  boundaryGrantsDoor(
    `${repositoryBindingReadFunction}(text,text,text)`,
    [apiRole],
    [workerPlaneRole],
  ),
  boundaryGrantsDoor(
    `${repositoryRetirementWriteFunction}(text,text,text)`,
    [apiRole],
    [],
  ),
  boundaryGrantsDoor(
    `${repositoryLandingWriteFunction}(text,text,text,text,text,boolean,boolean)`,
    [apiRole],
    [],
  ),
  boundaryGrantsDoor(
    `${repositoryConfigurationImportRecordFunction}(text,text,text,text,text,text,jsonb,integer)`,
    [apiRole, configurationImporterRole],
    [selectorServiceRole],
  ),
  boundaryGrantsDoor(
    `${configurationFollowingCandidatesFunction}(text,text,text,text,text,bigint,integer)`,
    [configurationImporterRole],
    [apiRole, ticketServiceRole],
  ),
  boundaryGrantsDoor(
    `${configurationFollowingMoveFunction}(text,text,bigint,bigint,text,text,text,text,bigint,bigint)`,
    [configurationImporterRole],
    [apiRole, ticketServiceRole],
  ),
  boundaryGrantsDoor(
    `${ticketLandingsReadFunction}(text,text,bigint,integer)`,
    [apiRole, ticketServiceRole, schedulerRole],
    [finalizerRole],
  ),
  {
    signature: `${agentAccountFunction}(text,text,text,text)`,
    definer: false,
    callers: [],
    strangers: [workerPlaneRole, poolPlaneRole],
  },
  boundaryGrantsDoor(
    `${workerRunUsageFunction}(text,bigint,jsonb)`,
    [workerPlaneRole],
    [poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${workerRunLimitFunction}(text,bigint,text,bigint)`,
    [workerPlaneRole],
    [poolPlaneRole],
  ),
  boundaryGrantsDoor(
    `${agentAccountPauseFunction}(text,text)`,
    [poolPlaneRole, apiRole, metricsPlaneRole],
    [],
  ),
  {
    signature: `${agentAccountSessionPausedFunction}(text,text)`,
    definer: false,
    callers: [],
    strangers: [poolPlaneRole],
  },
  {
    signature: `${agentAccountSettingsFunction}(text,text)`,
    definer: false,
    callers: [],
    strangers: [poolPlaneRole],
  },
  boundaryGrantsDoor(
    `${rateLimitedTicketsFunction}(bigint,bigint,integer)`,
    [schedulerRole],
    [],
  ),
  boundaryGrantsDoor(
    `${rateLimitResumeFunction}(text,text,bigint,bigint,bigint,text,text,bigint,bigint)`,
    [schedulerRole],
    [],
  ),
  {
    signature: `${ticketRateLimitResumableFunction}(text,text,bigint,bigint,bigint)`,
    definer: false,
    callers: [],
    strangers: [schedulerRole],
  },
  boundaryGrantsDoor(
    `${agentAccountStandingFunction}(text)`,
    [apiRole],
    [metricsPlaneRole],
  ),
  boundaryGrantsDoor(
    `${agentAccountSettingWriteFunction}(text,text,smallint,smallint,boolean,boolean)`,
    [apiRole],
    [metricsPlaneRole],
  ),
  boundaryGrantsDoor(
    `${agentAccountPressFunction}(text,text)`,
    [apiRole],
    [metricsPlaneRole],
  ),
  boundaryGrantsDoor(
    `${ticketUsageResumeFunction}(text,text,bigint,bigint,bigint)`,
    [apiRole],
    [metricsPlaneRole],
  ),
  boundaryGrantsDoor(
    "update_draft_fenced(text,text,bigint,bigint,text,text,boolean)",
    [ticketServiceRole],
    [apiRole],
  ),
];

/** How one function is declared, its path where it runs as its owner, and whether each role named may execute it, `public` among them. */
async function boundaryGrantsDoorRead(
  subject: pg.Pool,
  door: DoorDeclared,
): Promise<unknown> {
  const roles = [...door.callers, ...door.strangers, "public"];
  const declared = await subject.query<{
    owner: string;
    definer: boolean;
    settings: string | null;
    executes: boolean[];
  }>(
    `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
            array_to_string(p.proconfig,',') AS settings,
            ARRAY(SELECT has_function_privilege(role,p.oid,'EXECUTE')
                    FROM unnest($2::text[]) WITH ORDINALITY AS r(role,ordinal)
                   ORDER BY ordinal) AS executes
       FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
    [door.signature, roles],
  );
  return declared.rows.map((row) => ({
    owner: row.owner,
    definer: row.definer,
    ...(row.definer ? { settings: row.settings } : {}),
    executes: Object.fromEntries(
      roles.map((role, index) => [role, row.executes[index]]),
    ),
  }));
}

test("every door is the boundary owner's, pinned to its path where it runs as its owner, and executable by its callers and none of the roles it is shut to", async () => {
  await migratedDatabase("door_roster", async (subject) => {
    for (const door of boundaryGrantsDoors)
      assert.deepEqual(
        await boundaryGrantsDoorRead(subject, door),
        [
          {
            owner: boundaryOwnerRole,
            definer: door.definer,
            ...(door.definer
              ? { settings: "search_path=pg_catalog, public, pg_temp" }
              : {}),
            executes: Object.fromEntries([
              ...door.callers.map((role) => [role, true] as const),
              ...door.strangers.map((role) => [role, false] as const),
              ["public", false] as const,
            ]),
          },
        ],
        door.signature,
      );
  });
});

/** A privilege one role holds or is refused on a column, or on a whole relation where the column is `null`. */
type ColumnGrant = readonly [
  relation: string,
  column: string | null,
  privilege: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
  role: string,
  held: boolean,
];

/** What the roles reaching each relation hold of it, and what they are refused. */
const boundaryGrantsColumns: readonly ColumnGrant[] = [
  ["ticket_projection", "configuration_revision", "UPDATE", apiRole, false],
  ["ticket_projection", "configuration_digest", "UPDATE", apiRole, false],
  ["ticket_projection", "configuration_digest", "SELECT", apiRole, false],
  ["ticket_projection", "revision", "UPDATE", apiRole, false],
  ["ticket_definition", "ticket", "UPDATE", ticketServiceRole, false],
  ["ticket_definition", "definition", "SELECT", apiRole, false],
  ["ticket_definition", "digest", "SELECT", apiRole, false],
  ["draft", "released_authoring_version", "UPDATE", apiRole, false],
  ["execution_attempt", "pool_principal", "SELECT", poolPlaneRole, true],
  ["execution_attempt", "pool_principal", "UPDATE", poolPlaneRole, true],
  ["execution_attempt", "pool_principal", "SELECT", apiRole, false],
  ["execution_attempt", "pool_principal", "UPDATE", apiRole, false],
  ["execution_attempt", "pool_principal", "SELECT", workerPlaneRole, false],
  ["execution_attempt", "pool_principal", "UPDATE", workerPlaneRole, false],
  ["execution", "placement_backoff_from", "SELECT", poolPlaneRole, false],
  ["execution_attempt", "pool_refusal", "SELECT", apiRole, true],
  ["execution_attempt", "pool_refusal", "UPDATE", apiRole, false],
  ["execution_attempt", "pool_refusal", "INSERT", apiRole, false],
  ["execution", "placement_backoff_from", "UPDATE", poolPlaneRole, true],
  ["selector_attempt", "project_revision", "SELECT", selectorServiceRole, true],
  ["selector_attempt", "project_revision", "UPDATE", selectorServiceRole, true],
  ["invite_link", "workspace", "UPDATE", accessPlaneRole, true],
  ["invite_link", "tenant", "UPDATE", accessPlaneRole, false],
  ["invite_link", "note", "UPDATE", accessPlaneRole, false],
  ["invite_link", "create_accounts", "UPDATE", accessPlaneRole, false],
  ["selector_lead_refusal", null, "DELETE", selectorServiceRole, true],
  [
    "project_repository",
    "pipelines_writable",
    "UPDATE",
    boundaryOwnerRole,
    true,
  ],
  ["finalization_reconciliation", "declined", "UPDATE", finalizerRole, true],
  ["execution_attempt", "claimed_at", "UPDATE", poolPlaneRole, true],
  ["execution_attempt", "claimed_at", "SELECT", apiRole, true],
  ["execution_attempt", "claimed_at", "SELECT", metricsPlaneRole, true],
  ["execution_attempt", "claimed_at", "UPDATE", apiRole, false],
  ["execution_attempt", "claimed_at", "UPDATE", schedulerRole, false],
  ["execution_attempt", "agent", "SELECT", poolPlaneRole, true],
  ["execution_attempt", "agent", "SELECT", apiRole, true],
  ["agent_account_usage", null, "SELECT", workerPlaneRole, false],
  ["agent_account_limit", null, "SELECT", workerPlaneRole, false],
  ["worker_pool", "registered_by", "SELECT", poolPlaneRole, true],
  ["agent_account_press", "spent_at", "UPDATE", poolPlaneRole, true],
  ["agent_account_press", "pressed_at", "UPDATE", poolPlaneRole, false],
  ["agent_account_setting", null, "SELECT", poolPlaneRole, false],
  ["agent_account_usage", "principal", "SELECT", metricsPlaneRole, true],
  ["agent_account_usage", "utilization", "SELECT", metricsPlaneRole, false],
  ["agent_account_limit", "agent", "SELECT", metricsPlaneRole, true],
  ["agent_account_setting", null, "SELECT", apiRole, false],
  ["agent_account_setting", null, "INSERT", boundaryOwnerRole, true],
  ["agent_account_press", null, "UPDATE", boundaryOwnerRole, true],
];

test("each role holds of a relation the columns it reaches it by, and is refused the ones it does not", async () => {
  await migratedDatabase("column_roster", async (subject) => {
    for (const [
      relation,
      column,
      privilege,
      role,
      held,
    ] of boundaryGrantsColumns)
      assert.equal(
        (
          await subject.query<{ held: boolean }>(
            column === null
              ? "SELECT has_table_privilege($1,'public.'||$2,$3) AS held"
              : "SELECT has_column_privilege($1,'public.'||$2,$3,$4) AS held",
            column === null
              ? [role, relation, privilege]
              : [role, relation, column, privilege],
          )
        ).rows[0]?.held,
        held,
        `${role} ${privilege} on ${relation}.${column ?? "*"}`,
      );
  });
});

/** Every privilege any role but the one that migrated holds on these columns of a relation, as role, privilege and the columns it covers. */
async function boundaryGrantsHolders(
  subject: pg.Pool,
  relation: string,
  columns: readonly string[],
): Promise<readonly string[]> {
  const held = await subject.query<{ held: string }>(
    `SELECT grantee || ' ' || privilege_type || ' '
            || string_agg(column_name, ',' ORDER BY column_name COLLATE "C") AS held
       FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name=$1
        AND column_name = ANY($2::text[]) AND grantee <> current_user
      GROUP BY grantee, privilege_type
      ORDER BY grantee, privilege_type`,
    [relation, columns],
  );
  return held.rows.map((row) => row.held);
}

/** Each relation's columns, and every privilege any role holds on them. */
const boundaryGrantsHeld: readonly (readonly [
  string,
  readonly string[],
  readonly string[],
])[] = [
  [
    "worker_pool",
    ["class"],
    [
      `${apiRole} INSERT class`,
      `${apiRole} SELECT class`,
      `${poolPlaneRole} SELECT class`,
      `${schedulerRole} SELECT class`,
    ],
  ],
  [
    "selector_lead_refusal",
    ["tenant", "project", "refusal", "refused_since"],
    [
      `${boundaryOwnerRole} SELECT project,refusal,refused_since,tenant`,
      `${selectorServiceRole} INSERT project,refusal,refused_since,tenant`,
      `${selectorServiceRole} SELECT project,refusal,refused_since,tenant`,
      `${selectorServiceRole} UPDATE refusal,refused_since`,
    ],
  ],
  [
    "execution_attempt",
    ["runtime"],
    [
      `${boundaryOwnerRole} SELECT runtime`,
      `${poolPlaneRole} SELECT runtime`,
      `${schedulerRole} INSERT runtime`,
      `${schedulerRole} SELECT runtime`,
    ],
  ],
  [
    "execution",
    ["cpu_millis", "memory_mib"],
    [
      `${apiRole} SELECT cpu_millis,memory_mib`,
      `${boundaryOwnerRole} SELECT cpu_millis,memory_mib`,
      `${finalizerRole} SELECT cpu_millis,memory_mib`,
      `${poolPlaneRole} SELECT cpu_millis,memory_mib`,
      `${schedulerRole} INSERT cpu_millis,memory_mib`,
      `${schedulerRole} SELECT cpu_millis,memory_mib`,
    ],
  ],
  [
    "repository_configuration_import",
    [
      "tenant",
      "project",
      "repository",
      "repository_commit",
      "result",
      "absent",
      "refusals",
      "refusal_count",
      "attempted_at",
    ],
    [
      `${apiRole} SELECT absent,attempted_at,project,refusal_count,refusals,repository,repository_commit,result,tenant`,
      `${boundaryOwnerRole} INSERT absent,attempted_at,project,refusal_count,refusals,repository,repository_commit,result,tenant`,
      `${boundaryOwnerRole} SELECT absent,attempted_at,project,refusal_count,refusals,repository,repository_commit,result,tenant`,
      `${boundaryOwnerRole} UPDATE absent,attempted_at,refusal_count,refusals,repository_commit,result`,
    ],
  ],
];

test("the columns whose every holder is named are held by those roles and no other", async () => {
  await migratedDatabase("column_holders", async (subject) => {
    for (const [relation, columns, held] of boundaryGrantsHeld)
      assert.deepEqual(
        await boundaryGrantsHolders(subject, relation, columns),
        held,
        relation,
      );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT a.attname FROM pg_attribute a
            WHERE a.attrelid='public.personal_runner'::regclass AND a.attnum>0
              AND NOT a.attisdropped
              AND has_column_privilege($1,a.attrelid,a.attnum,'UPDATE')`,
          [apiRole],
        )
      ).rows,
      [],
      "the API moves no column of a member's runner in place",
    );
  });
});
