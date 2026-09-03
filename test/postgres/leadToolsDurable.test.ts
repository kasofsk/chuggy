/**
 * What migration 061 adds, driven against a real PostgreSQL by the role each
 * door is granted to.
 *
 * EVERY CASE HERE IS ABOUT A CONTROL AND NOT ABOUT A SHAPE. A column bound, a
 * grant, a revoke and a filter are each a claim about what the server refuses,
 * and the only way to hold one is to attempt the thing it refuses as the
 * identity that would attempt it. So the drafts page is read through the API's
 * own role, the objectives door is driven through the selector's, and every
 * other role is asked for the same door and refused.
 *
 * THE OBJECTIVES ARE A COLUMN A LATER WRITE MAY MOVE, which is the one thing
 * `agent_session_is_written_once` does not freeze. A case that only ever wrote
 * the column at open would pass with the trigger widened to freeze it, so the
 * second write is what this suite asserts.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresAuthoring } from "../../src/adapters/postgres/authoring.ts";
import { postgresLeadSystemPrompt } from "../../src/adapters/postgres/leadMailbox.ts";
import { postgresSessionPlane } from "../../src/adapters/postgres/sessionPlane.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  projectDraftsReadFunction,
  repositoryBindingReadFunction,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { agentSessionPromptCharsMax } from "../../src/contract/http.ts";
import type { AuthoringStore } from "../../src/interpreter/authoring.ts";
import {
  asConfigurationRevisionId,
  type ConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import type { LeadSystemPromptPort } from "../../src/interpreter/agentSession.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import { asPrincipal, oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { Authority } from "../../src/interpreter/operationInbox.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  postgresHarnessBrief,
  postgresHarnessConfiguration,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigProvision,
  sessionRigBearer,
  sessionRigOpen,
  sessionRigSession,
  sessionRigTurn,
  type SessionRig,
} from "./sessionHarness.ts";

let rig: SessionRig;
let harness: PostgresHarness;
let apiPool: pg.Pool;
let selectorPool: pg.Pool;
let drafts: AuthoringStore;
let prompts: LeadSystemPromptPort;

before(async () => {
  rig = await sessionRigOpen();
  harness = rig.harness;
  apiPool = postgresHarnessRolePool(apiRole);
  selectorPool = postgresHarnessRolePool(selectorServiceRole);
  drafts = postgresAuthoring(apiPool);
  prompts = postgresLeadSystemPrompt(selectorPool);
});

after(async () => {
  await apiPool.end();
  await selectorPool.end();
  await rig.close();
});

function leadToolsProject(label: string): Promise<Partition> {
  return postgresHarnessProject(harness.store, `lead-tools-${label}`);
}

const draftAuthority: Authority = {
  kind: asAuthorityKind("OidcUser"),
  subject: asAuthoritySubject("lead-tools"),
};

/** One configuration a draft may be authored against, on the owner's own pool. */
async function leadToolsConfiguration(
  partition: Partition,
): Promise<ConfigurationRevisionId> {
  const revision = asConfigurationRevisionId(`config-drafts-${randomUUID()}`);
  const created = await harness.authoring.createConfiguration({
    partition,
    authority: draftAuthority,
    revision,
    canonical: postgresHarnessConfiguration,
  });
  if (created.created !== "Created")
    throw new Error(`lead tools: configuration answered ${created.created}`);
  return revision;
}

/** One open draft, through the doors a member's own command goes through. */
async function leadToolsDraft(
  partition: Partition,
  revision: ConfigurationRevisionId,
): Promise<{ readonly ticket: TicketId; readonly version: number }> {
  const initialized = await harness.authoring.initializeDraft(
    partition,
    revision,
    100,
  );
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("lead tools: the draft was not initialized");
  const created = await harness.authoring.createDraft({
    partition,
    authority: draftAuthority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
    brief: postgresHarnessBrief,
  });
  if (created.created !== "Created")
    throw new Error(`lead tools: the draft answered ${created.created}`);
  return {
    ticket: created.draft.ticket,
    version: created.draft.authoringVersion,
  };
}

test("a page of drafts answers the open ones ascending, and pages past them", async () => {
  const partition = await leadToolsProject("page");
  const revision = await leadToolsConfiguration(partition);
  const first = await leadToolsDraft(partition, revision);
  const second = await leadToolsDraft(partition, revision);
  const third = await leadToolsDraft(partition, revision);

  const page = await drafts.drafts(partition, { limit: 2 });
  assert.deepEqual(
    page.drafts.map((draft) => draft.ticket),
    [first.ticket, second.ticket],
  );
  assert.equal(page.more, true);
  assert.equal(page.nextCursor, second.ticket);
  assert.deepEqual(page.partition, partition);
  assert.equal(page.drafts[0]?.brief?.intent, postgresHarnessBrief.intent);

  const rest = await drafts.drafts(partition, {
    limit: 2,
    cursor: second.ticket,
  });
  assert.deepEqual(
    rest.drafts.map((draft) => draft.ticket),
    [third.ticket],
  );
  assert.equal(rest.more, false);
  assert.equal(rest.nextCursor, undefined);
});

/**
 * The release path is the whole ticket machinery, and the state column is what
 * the page filters on, so this case moves the column the filter reads.
 */
test("a released or deleted draft is not one of a project's open drafts", async () => {
  const partition = await leadToolsProject("state");
  const revision = await leadToolsConfiguration(partition);
  const open = await leadToolsDraft(partition, revision);
  const deleted = await leadToolsDraft(partition, revision);
  const released = await leadToolsDraft(partition, revision);

  const gone = await harness.authoring.deleteDraft({
    partition,
    authority: draftAuthority,
    ticket: deleted.ticket,
    expectedVersion: deleted.version,
  });
  assert.equal(gone.deleted, "Deleted");
  await harness.query(
    `UPDATE draft SET state='Released'
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, released.ticket],
  );

  const page = await drafts.drafts(partition, { limit: 100 });
  assert.deepEqual(
    page.drafts.map((draft) => draft.ticket),
    [open.ticket],
  );
  assert.deepEqual(
    page.drafts.map((draft) => draft.state),
    ["Draft"],
  );
});

test("one project's drafts are not another's", async () => {
  const mine = await leadToolsProject("mine");
  const theirs = await leadToolsProject("theirs");
  const revision = await leadToolsConfiguration(mine);
  const held = await leadToolsDraft(mine, revision);

  assert.deepEqual(
    (await drafts.drafts(theirs, { limit: 100 })).drafts.map(
      (draft) => draft.ticket,
    ),
    [],
  );
  assert.deepEqual(
    (await drafts.drafts(mine, { limit: 100 })).drafts.map(
      (draft) => draft.ticket,
    ),
    [held.ticket],
  );
});

test("the lead's objectives are set, left alone, and refused a project with no lead", async () => {
  const partition = await leadToolsProject("prompt");
  const empty = await leadToolsProject("noprompt");
  assert.equal(await prompts.setSystemPrompt(empty, "anything"), "NoLead");

  await sessionRigSession(rig, partition, "prompted", {
    kind: "Lead",
    capabilities: ["RepositoryRead", "ProjectRead", "DraftAuthor"],
    systemPrompt: "what this project wants",
  });
  assert.equal(
    await prompts.setSystemPrompt(partition, "what this project wants"),
    "Unchanged",
  );
  assert.equal(
    await prompts.setSystemPrompt(partition, "what it wants now"),
    "Set",
  );
  assert.equal(
    await prompts.setSystemPrompt(partition, "what it wants now"),
    "Unchanged",
  );
  assert.deepEqual(
    await harness.query(
      `SELECT system_prompt FROM agent_session
        WHERE tenant=$1 AND project=$2 AND kind='Lead'`,
      [partition.tenant, partition.project],
    ),
    [{ system_prompt: "what it wants now" }],
  );
});

/**
 * The second project's only session is a member's thread: a door that resolved
 * any session would find it and rewrite it, which is what `kind='Lead'` is for.
 */
test("a member's thread keeps its own objectives when the lead's move", async () => {
  const partition = await leadToolsProject("thread");
  await sessionRigSession(rig, partition, "lead", {
    kind: "Lead",
    systemPrompt: "the lead's own",
  });
  await sessionRigSession(rig, partition, "member", {
    kind: "Thread",
    principal: `member-${randomUUID()}`,
    systemPrompt: "the member's own",
  });

  assert.equal(await prompts.setSystemPrompt(partition, "moved"), "Set");
  assert.deepEqual(
    await harness.query(
      `SELECT kind,system_prompt FROM agent_session
        WHERE tenant=$1 AND project=$2 ORDER BY kind`,
      [partition.tenant, partition.project],
    ),
    [
      { kind: "Lead", system_prompt: "moved" },
      { kind: "Thread", system_prompt: "the member's own" },
    ],
  );

  const leadless = await leadToolsProject("leadless");
  await sessionRigSession(rig, leadless, "alone", {
    kind: "Thread",
    principal: `member-${randomUUID()}`,
    systemPrompt: "the only session there is",
  });
  assert.equal(await prompts.setSystemPrompt(leadless, "moved"), "NoLead");
  assert.deepEqual(
    await harness.query(
      `SELECT kind,system_prompt FROM agent_session
        WHERE tenant=$1 AND project=$2`,
      [leadless.tenant, leadless.project],
    ),
    [{ kind: "Thread", system_prompt: "the only session there is" }],
  );
});

test("objectives longer than one row holds are refused", async () => {
  const partition = await leadToolsProject("bound");
  await sessionRigSession(rig, partition, "bounded", { kind: "Lead" });
  await assert.rejects(
    () =>
      prompts.setSystemPrompt(
        partition,
        "o".repeat(agentSessionPromptCharsMax + 1),
      ),
    /agent_session_prompt_is_bounded/u,
  );
  assert.equal(
    await prompts.setSystemPrompt(
      partition,
      "o".repeat(agentSessionPromptCharsMax),
    ),
    "Set",
  );
});

test("reopening a session compares the objectives it would be opened with", async () => {
  const partition = await leadToolsProject("reopen");
  const session = await sessionRigSession(rig, partition, "reopened", {
    kind: "Lead",
    principal: "reopened",
    systemPrompt: "the objectives it was opened with",
  });
  const reopen = (systemPrompt: string | undefined) =>
    rig.sessions.open({
      partition,
      session,
      kind: "Lead",
      principal: asPrincipal("reopened"),
      capabilities: ["RepositoryRead"],
      credentialSlot: "claude-code",
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
    });

  assert.equal(
    await reopen("the objectives it was opened with"),
    "AlreadyOpen",
  );
  assert.equal(await reopen("something else entirely"), "Conflict");
  assert.equal(await reopen(undefined), "Conflict");
});

test("the pod is answered the objectives its session was opened with", async () => {
  const partition = await leadToolsProject("facts");
  const session = await sessionRigSession(rig, partition, "facts", {
    kind: "Lead",
    capabilities: ["RepositoryRead", "ProjectRead"],
    systemPrompt: "what the pod is told it is",
  });
  await sessionRigTurn(rig, partition, session, "facts");
  const attempt = await sessionRigAttempt(rig, partition, session, "facts");
  const authenticated = await rig.plane.authenticate(attempt.secret);
  assert.equal(authenticated?.systemPrompt, "what the pod is told it is");

  assert.equal(await prompts.setSystemPrompt(partition, "and now this"), "Set");
  assert.equal(
    (await rig.plane.authenticate(attempt.secret))?.systemPrompt,
    "and now this",
  );

  const bare = await leadToolsProject("bare");
  const spare = await sessionRigSession(rig, bare, "bare", { kind: "Lead" });
  await sessionRigTurn(rig, bare, spare, "bare");
  const other = await sessionRigAttempt(rig, bare, spare, "bare");
  assert.equal(
    (await rig.plane.authenticate(other.secret))?.systemPrompt,
    undefined,
  );
});

/**
 * The two reads 061 opens or widens, beside every role that holds one. The
 * binding read was already the API's (021), the ticket service's (031), the
 * configuration importer's (029) and the finalizer's (040); this migration adds
 * the scheduler and nothing else, so the case names them all rather than
 * asserting a door has one holder it never had.
 */
const leadToolDoors: readonly {
  readonly door: string;
  readonly holders: readonly string[];
}[] = [
  {
    door: `${projectDraftsReadFunction}(text,text,bigint,bigint)`,
    holders: [apiRole],
  },
  {
    door: `${repositoryBindingReadFunction}(text,text)`,
    holders: [
      apiRole,
      ticketServiceRole,
      configurationImporterRole,
      finalizerRole,
      schedulerRole,
    ],
  },
];

/** Every runtime credential this installation deploys. */
const runtimeRoles = [
  apiRole,
  schedulerRole,
  workerPlaneRole,
  ticketServiceRole,
  finalizerRole,
  selectorServiceRole,
  configurationImporterRole,
] as const;

test("a drafts page and a repository binding are each held by exactly the roles that need one", async () => {
  const executes = async (role: string, signature: string) =>
    (
      await harness.query(
        "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
        [role, signature],
      )
    )[0]?.["granted"];
  for (const { door, holders } of leadToolDoors) {
    for (const role of [...runtimeRoles, "public"])
      assert.equal(
        await executes(role, door),
        holders.includes(role),
        `${door} to ${role}`,
      );
  }
  assert.deepEqual(
    await harness.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
              array_to_string(p.proconfig,',') AS settings
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [projectDraftsReadFunction],
    ),
    [
      {
        owner: boundaryOwnerRole,
        definer: true,
        settings: "search_path=pg_catalog, public, pg_temp",
      },
    ],
  );
});

test("the scheduler's own credential can read a project's repository binding", async () => {
  const partition = await leadToolsProject("binding");
  const scheduling = postgresHarnessRolePool(schedulerRole);
  try {
    assert.deepEqual(
      (
        await scheduling.query(
          `SELECT repository FROM ${repositoryBindingReadFunction}($1,$2)`,
          [partition.tenant, partition.project],
        )
      ).rows,
      [],
      "a project with no binding places a session with no checkout",
    );
  } finally {
    await scheduling.end();
  }
});

test("the worker plane's own credential cannot read a project's repository binding", async () => {
  const plane = postgresHarnessRolePool(workerPlaneRole);
  try {
    await assert.rejects(
      () =>
        plane.query(
          `SELECT repository FROM ${repositoryBindingReadFunction}($1,$2)`,
          ["tenant", "project"],
        ),
      /permission denied for function read_project_repository_binding/u,
    );
  } finally {
    await plane.end();
  }
});

test("no role but the selector's may move a lead's objectives", async () => {
  for (const role of [apiRole, schedulerRole, workerPlaneRole]) {
    const pool = postgresHarnessRolePool(role);
    try {
      await assert.rejects(
        () =>
          postgresLeadSystemPrompt(pool).setSystemPrompt(
            { tenant: "tenant", project: "project" } as Partition,
            "moved",
          ),
        /permission denied for function set_session_system_prompt/u,
        role,
      );
    } finally {
      await pool.end();
    }
  }
});

test("the API's own credential is what pages a project's drafts", async () => {
  const partition = await leadToolsProject("apirole");
  const revision = await leadToolsConfiguration(partition);
  const held = await leadToolsDraft(partition, revision);
  assert.deepEqual(
    (await drafts.drafts(partition, { limit: 100 })).drafts.map(
      (draft) => draft.ticket,
    ),
    [held.ticket],
  );
  const plane = postgresHarnessRolePool(workerPlaneRole);
  try {
    await assert.rejects(
      () => postgresAuthoring(plane).drafts(partition, { limit: 100 }),
      /permission denied for function read_project_drafts/u,
    );
  } finally {
    await plane.end();
  }
});

/**
 * The secret is one no attempt holds: the refusal under test is the grant's, and
 * the server answers it before it reads a row.
 */
test("the retyped session facts stay the plane's alone", async () => {
  const pool = postgresHarnessRolePool(apiRole);
  try {
    await assert.rejects(
      () => postgresSessionPlane(pool).authenticate(sessionRigBearer().secret),
      /permission denied for function read_session_attempt/u,
    );
  } finally {
    await pool.end();
  }
});

/** The provisioning command with this suite's own defaults for the fields it never varies. */
function leadToolsProvision(
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly code: number; readonly output: string }> {
  return sessionRigProvision({
    CHUG_PROVISION_SESSION_ACTION: "open",
    CHUG_PROVISION_SESSION_KIND: "Lead",
    CHUG_PROVISION_SESSION_CAPABILITIES: "RepositoryRead,ProjectRead",
    CHUG_PROVISION_SESSION_CREDENTIAL_SLOT: "claude-code",
    ...environment,
  });
}

test("a session provisioned from an issuer and a subject is the membership's own principal", async () => {
  const partition = await leadToolsProject("provisioned");
  const issuer = "https://auth.invalid/realm";
  const subject = `chuggy-selector-${randomUUID()}`;
  const session = `session-provisioned-${randomUUID()}`;
  const opened = await leadToolsProvision({
    CHUG_PROVISION_SESSION_TENANT: partition.tenant,
    CHUG_PROVISION_SESSION_PROJECT: partition.project,
    CHUG_PROVISION_SESSION_SESSION: session,
    CHUG_PROVISION_SESSION_ISSUER: issuer,
    CHUG_PROVISION_SESSION_SUBJECT: subject,
    CHUG_PROVISION_SESSION_SYSTEM_PROMPT: "what this project wants",
  });
  assert.equal(opened.code, 0, opened.output);

  const principal = oidcPrincipal(issuer, subject);
  assert.deepEqual(
    await harness.query(
      `SELECT principal,system_prompt FROM agent_session WHERE session=$1`,
      [session],
    ),
    [{ principal, system_prompt: "what this project wants" }],
    "the session authenticates as the principal a membership is granted to",
  );

  await harness.membership.grant({
    partition,
    principal,
    access: new Set(["Read", "Mutate", "ProposeDispatch"] as const),
    authority: {
      kind: asAuthorityKind("OidcUser"),
      subject: asAuthoritySubject(subject),
    },
  });
  assert.notEqual(
    await harness.access.authorize(principal, partition, "ProposeDispatch"),
    undefined,
    "a one-character difference here is a session refused NotFound with nothing saying why",
  );
});

test("a session may be named by one principal form and never by two", async () => {
  const partition = await leadToolsProject("bothforms");
  const both = await leadToolsProvision({
    CHUG_PROVISION_SESSION_TENANT: partition.tenant,
    CHUG_PROVISION_SESSION_PROJECT: partition.project,
    CHUG_PROVISION_SESSION_SESSION: `session-both-${randomUUID()}`,
    CHUG_PROVISION_SESSION_PRINCIPAL: "21:https://auth.invalidsubject",
    CHUG_PROVISION_SESSION_ISSUER: "https://auth.invalid",
    CHUG_PROVISION_SESSION_SUBJECT: "subject",
  });
  assert.equal(both.code, 1);
  assert.match(both.output, /not both/u);

  const neither = await leadToolsProvision({
    CHUG_PROVISION_SESSION_TENANT: partition.tenant,
    CHUG_PROVISION_SESSION_PROJECT: partition.project,
    CHUG_PROVISION_SESSION_SESSION: `session-neither-${randomUUID()}`,
  });
  assert.equal(neither.code, 1);
  assert.match(neither.output, /CHUG_PROVISION_SESSION_PRINCIPAL is required/u);
});
