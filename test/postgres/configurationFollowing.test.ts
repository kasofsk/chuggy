/**
 * The importer's sweep against a real database: a Pending ticket following
 * its newest revision is moved through 102's doors where the head changes what
 * it runs, and only then, and every move is decided by the writer as an
 * update under the importer's `Service` authority. The ticket's own read
 * answers the same verdict against its repository's newest import.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresConfigurationFollowing } from "../../src/adapters/postgres/configurationFollowing.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresRepositoryConfigurationImportAttempts } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  configurationImporterRole,
} from "../../src/adapters/postgres/schema.ts";
import type { ConfigurationSelection } from "../../src/contract/configurationSelection.ts";
import type { ReleaseAuthoringProgram } from "../../src/contract/authoring.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import {
  asConfigurationRevisionId,
  type ConfigurationRevisionId,
  type ReleaseAuthoring,
} from "../../src/interpreter/authoring.ts";
import {
  followConfigurations,
  type ConfigurationFollowingPort,
  type ConfigurationFollowingRun,
} from "../../src/interpreter/configurationFollowingSweep.ts";
import {
  asGitObjectId,
  type GitObjectId,
} from "../../src/interpreter/finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationId,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { repositoryConfigurationImportReadiness } from "../../src/interpreter/repositoryConfiguration.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessBinding,
  postgresHarnessBriefIn,
  postgresHarnessHeld,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let importer: pg.Pool;
let api: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  importer = postgresHarnessRolePool(configurationImporterRole);
  api = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await api.end();
  await importer.end();
  await harness.close();
});

const person = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("author"),
};

const importerAuthority = {
  kind: asAuthorityKind("Service"),
  subject: asAuthoritySubject("configuration-mirror-importer"),
};

const agent = (text: string) => ({
  runner: "Agent",
  prompt: { text },
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
    setup: [],
    files: [],
  },
});

type Catalog = Record<string, Record<string, unknown>>;

/** A catalog whose default plan reviews and whose other plan runs the tests, changed by `change`. */
function catalog(change: (value: Catalog) => void = () => undefined): Catalog {
  const value: Catalog = {
    workloads: {
      build: agent("Build it."),
      alternative: agent("Build it another way."),
      review: agent("Review it."),
      tests: { runner: "Commands", commands: ["npm test"] },
    },
    plans: {
      standard: [{ name: "review", evaluators: ["review"] }],
      tested: [{ name: "tests", evaluators: ["tests"] }],
    },
    finalizers: { landed: { approvalRequired: false } },
    defaults: {
      work: "build",
      evaluation: "standard",
      finalization: "landed",
      configuration: "Latest",
    },
  };
  change(value);
  return value;
}

/** The workloads, plans or defaults of a catalog fixture, to change in place. */
function part(value: Catalog, name: string): Record<string, unknown> {
  const found = value[name];
  if (found === undefined) throw new Error(`catalog fixture has no ${name}`);
  return found;
}

const commits = {
  first: asGitObjectId("a".repeat(40)),
  second: asGitObjectId("b".repeat(40)),
  third: asGitObjectId("c".repeat(40)),
};

/** One project bound to one repository, and the writer deciding everything offered it. */
async function followingProject(
  label: string,
  stagesMax = refinementInstance.maxStages,
) {
  const partition = await postgresHarnessProject(
    harness.store,
    `following-${label}`,
  );
  const repository = await postgresHarnessBinding(harness, partition);
  const [epoch] = await harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  );
  const binding = {
    partition,
    repository,
    recoveryEpoch: asRecoveryEpoch(String(epoch?.["epoch"])),
  };
  const writer = {
    ...postgresHarnessWriter(harness),
    config: { ...refinementInstance, maxStages: stagesMax },
  };
  let memory: ProjectMemory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, `following-${label}`),
  );
  /** Decides the next pending input, answering how it was decided. */
  async function decideNext(): Promise<string> {
    const input = await harness.discovery.next(partition);
    assert.ok(input !== undefined, "an input is pending");
    const decision = await projectWriterDecide(writer, memory, input);
    memory = decision.memory;
    return decision.decided.decided;
  }
  return {
    partition,
    repository,
    binding,
    decideNext,
    memory: () => memory,
    async decide(submission: Submission): Promise<string> {
      assert.equal(
        (await harness.inbox.accept(submission)).accepted,
        "Accepted",
      );
      return decideNext();
    },
  };
}

type Project = Awaited<ReturnType<typeof followingProject>>;

/** Imports one catalog at `commit` under `name`, answering the revision it is held under. */
async function imported(
  project: Project,
  commit: GitObjectId,
  value: Catalog,
  name = "work",
): Promise<ConfigurationRevisionId> {
  const ready = repositoryConfigurationImportReadiness({
    repository: project.repository,
    commit,
    files: [
      {
        path: `.chug/configurations/${name}.json`,
        kind: "File" as const,
        content: JSON.stringify({
          version: 1,
          name,
          configuration: { version: 2, image: "worker:v2", ...value },
        }),
      },
    ],
  });
  if (ready.readiness === "Refused")
    throw new Error(`catalog fixture was refused: ${JSON.stringify(ready)}`);
  const result = await harness.authoring.importRepositoryConfigurations({
    partition: project.partition,
    binding: project.binding,
    authority: person,
    declarations: ready.declarations,
  });
  assert.equal(result.imported, "Imported");
  return asConfigurationRevisionId(`repository:${commit}:${name}`);
}

/** A ticket released on `revision` by a person, selecting `selection` and running `authoring`. */
async function released(
  project: Project,
  revision: ConfigurationRevisionId,
  selection?: ConfigurationSelection,
  authoring: ReleaseAuthoring = plainAuthoring,
): Promise<TicketId> {
  const initialized = await harness.authoring.initializeDraft(
    project.partition,
    revision,
    100,
  );
  if (initialized === undefined || initialized === "PolicyUnavailable")
    throw new Error("draft fixture was not initialized");
  const created = await harness.authoring.createDraft({
    partition: project.partition,
    authority: person,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring,
    brief: postgresHarnessBriefIn(project.repository),
    ...(selection === undefined ? {} : { selection }),
  });
  if (created.created !== "Created")
    throw new Error(`draft fixture was ${created.created}`);
  const unique = randomUUID();
  assert.equal(
    await project.decide({
      partition: project.partition,
      operation: asOperationId(`release-${unique}`),
      authority: person,
      key: asIdempotencyKey(`release-${unique}`),
      command: {
        version: 1,
        command: "ReleaseDraft",
        ticket: created.draft.ticket,
        authoringVersion: created.draft.authoringVersion,
        configurationRevision: revision,
      },
    }),
    "Committed",
  );
  return created.draft.ticket;
}

/** The importer's own port, under the mailbox bounds the deployed services run on unless a case names others. */
function importerPort(
  mailbox: Parameters<
    typeof postgresConfigurationFollowing
  >[2] = ticketServiceDefaults,
): ConfigurationFollowingPort {
  return postgresConfigurationFollowing(importer, importerAuthority, mailbox);
}

/** One sweep of the project's binding as imported at `commit`. */
function swept(
  project: Project,
  commit: GitObjectId,
  port: ConfigurationFollowingPort = importerPort(),
): Promise<ConfigurationFollowingRun> {
  return followConfigurations({
    bindings: [
      { partition: project.partition, repository: project.repository, commit },
    ],
    port,
    now: () => Date.now(),
    deadlineAtMs: Date.now() + 60_000,
  });
}

/** What one ticket runs on and where its draft stands. */
async function standing(project: Project, ticket: TicketId) {
  const [row] = await harness.query(
    `SELECT t.configuration_revision, t.revision::integer AS revision,
            d.authoring_version::integer AS authoring_version,
            d.released_authoring_version::integer AS released
       FROM ticket_projection t
       JOIN draft d ON d.tenant=t.tenant AND d.project=t.project AND d.ticket=t.ticket
      WHERE t.tenant=$1 AND t.project=$2 AND t.ticket=$3`,
    [project.partition.tenant, project.partition.project, ticket],
  );
  return row;
}

/** Every operation the importer was accepted for in the project, oldest first. */
async function importerOperations(project: Project) {
  return harness.query(
    `SELECT o.authority_kind, o.command_tag, d.state, d.outcome_code
       FROM operation o
       JOIN decision_input d ON d.tenant=o.tenant AND d.project=o.project
        AND d.input_kind='Operation' AND d.input_id=o.operation
      WHERE o.tenant=$1 AND o.project=$2 AND o.authority_kind='Service'
      ORDER BY d.ordinal`,
    [project.partition.tenant, project.partition.project],
  );
}

/** The program the ticket's released draft revision runs. */
async function releasedProgram(
  project: Project,
  ticket: TicketId,
): Promise<ReleaseAuthoringProgram | undefined> {
  const read = await harness.authoring.draft(project.partition, ticket);
  return read?.authoring.prog;
}

const reviewChanged = catalog((value) => {
  part(value, "workloads")["review"] = agent("Review it harder.");
});

test("a ticket following by its catalog's default and one by its own selection each move, journalled under the importer's authority", async () => {
  const project = await followingProject("moves");
  const held = await imported(project, commits.first, catalog());
  const pinnedByDefault = await imported(
    project,
    commits.first,
    catalog((value) => {
      delete part(value, "defaults")["configuration"];
    }),
    "chosen",
  );
  const byDefault = await released(project, held);
  const bySelection = await released(project, pinnedByDefault, {
    configuration: "Latest",
  });
  const head = await imported(project, commits.second, reviewChanged);
  const chosenHead = await imported(
    project,
    commits.second,
    catalog((value) => {
      delete part(value, "defaults")["configuration"];
      part(value, "workloads")["review"] = agent("Review it harder.");
    }),
    "chosen",
  );
  const run = await swept(project, commits.second);
  assert.deepEqual(
    run.reported.map((reported) => reported.followed.followed),
    ["Moved", "Moved"],
  );
  assert.equal(await project.decideNext(), "Committed");
  assert.equal(await project.decideNext(), "Committed");
  assert.deepEqual(await importerOperations(project), [
    {
      authority_kind: "Service",
      command_tag: "UpdateTicket",
      state: "Journaled",
      outcome_code: null,
    },
    {
      authority_kind: "Service",
      command_tag: "UpdateTicket",
      state: "Journaled",
      outcome_code: null,
    },
  ]);
  assert.deepEqual(await standing(project, byDefault), {
    configuration_revision: head,
    revision: 2,
    authoring_version: 2,
    released: 2,
  });
  assert.equal(
    (await standing(project, bySelection))?.["configuration_revision"],
    chosenHead,
  );
  assert.deepEqual((await swept(project, commits.second)).reported, []);
});

test("a ticket under no choice, and one pinned under a catalog defaulting to the newest, stay", async () => {
  const project = await followingProject("pinned");
  const unchosen = catalog((value) => {
    delete part(value, "defaults")["configuration"];
  });
  const plain = await released(
    project,
    await imported(project, commits.first, unchosen),
  );
  const pinned = await released(
    project,
    await imported(project, commits.first, catalog(), "latest"),
    { configuration: "Pinned" },
  );
  await imported(project, commits.second, {
    ...unchosen,
    workloads: part(reviewChanged, "workloads"),
  });
  await imported(project, commits.second, reviewChanged, "latest");
  assert.deepEqual((await swept(project, commits.second)).reported, []);
  assert.deepEqual(await importerOperations(project), []);
  for (const ticket of [plain, pinned])
    assert.equal((await standing(project, ticket))?.["authoring_version"], 1);
});

test("a head identical to the held revision, or changing only a workload the ticket does not run, writes nothing", async () => {
  for (const [label, head] of [
    ["identical", catalog()],
    [
      "unrun",
      catalog((value) => {
        part(value, "workloads")["tests"] = {
          runner: "Commands",
          commands: ["npm run test:all"],
        };
      }),
    ],
  ] as const) {
    const project = await followingProject(label);
    const ticket = await released(
      project,
      await imported(project, commits.first, catalog()),
    );
    await imported(project, commits.second, head);
    assert.deepEqual((await swept(project, commits.second)).reported, []);
    assert.deepEqual(await importerOperations(project), []);
    assert.equal((await standing(project, ticket))?.["authoring_version"], 1);
  }
});

test("a head changing only the selected finalizer moves the ticket", async () => {
  const project = await followingProject("finalizer");
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog()),
  );
  const head = await imported(
    project,
    commits.second,
    catalog((value) => {
      part(value, "finalizers")["landed"] = { approvalRequired: true };
    }),
  );
  await swept(project, commits.second);
  assert.equal(await project.decideNext(), "Committed");
  assert.equal(
    (await standing(project, ticket))?.["configuration_revision"],
    head,
  );
});

test("a plan gaining a stage moves the ticket onto a program running it", async () => {
  const project = await followingProject("stage", 2);
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog()),
  );
  await imported(
    project,
    commits.second,
    catalog((value) => {
      part(value, "plans")["standard"] = [
        { name: "review", evaluators: ["review"] },
        { name: "tests", evaluators: ["tests"] },
      ];
    }),
  );
  await swept(project, commits.second);
  assert.equal(await project.decideNext(), "Committed");
  assert.deepEqual(await releasedProgram(project, ticket), [
    { key: 1, evaluators: [{ key: 1 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ]);
});

test("a ticket whose selection names a workload the head dropped stays, and moves once a later head restores it", async () => {
  const project = await followingProject("dropped");
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog()),
    { work: "alternative" },
  );
  await imported(
    project,
    commits.second,
    catalog((value) => {
      delete part(value, "workloads")["alternative"];
      part(value, "workloads")["review"] = agent("Review it harder.");
    }),
  );
  assert.deepEqual(
    (await swept(project, commits.second)).reported.map(
      (reported) => reported.followed,
    ),
    [{ followed: "Held", fault: "SelectionUnknown" }],
  );
  assert.deepEqual(await importerOperations(project), []);
  assert.equal((await standing(project, ticket))?.["authoring_version"], 1);
  const restored = await imported(project, commits.third, reviewChanged);
  await swept(project, commits.third);
  assert.equal(await project.decideNext(), "Committed");
  assert.equal(
    (await standing(project, ticket))?.["configuration_revision"],
    restored,
  );
});

test("a trimmed ticket does not move", async () => {
  const twoStages = (value: Catalog) => {
    part(value, "plans")["standard"] = [
      { name: "review", evaluators: ["review"] },
      { name: "tests", evaluators: ["tests"] },
    ];
  };
  const project = await followingProject("trimmed");
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog(twoStages)),
  );
  await imported(
    project,
    commits.second,
    catalog((value) => {
      twoStages(value);
      part(value, "workloads")["review"] = agent("Review it harder.");
    }),
  );
  assert.deepEqual((await swept(project, commits.second)).reported, []);
  assert.deepEqual(await importerOperations(project), []);
  assert.equal((await standing(project, ticket))?.["authoring_version"], 1);
});

/** A person's revision of a released draft to an intent nobody has released. */
function personRevises(
  project: Project,
  ticket: TicketId,
  expectedVersion: number,
  revision: ConfigurationRevisionId,
) {
  return harness.authoring.reviseDraft({
    partition: project.partition,
    authority: person,
    ticket,
    expectedVersion,
    configurationRevision: revision,
    authoring: plainAuthoring,
    brief: {
      ...asDraftBrief({ intent: "A person's edit.", links: [] }),
      repository: project.repository,
    },
  });
}

test("a draft holding a person's unreleased edit does not move", async () => {
  const project = await followingProject("edited");
  const held = await imported(project, commits.first, catalog());
  const ticket = await released(project, held);
  assert.equal(
    (await personRevises(project, ticket, 1, held)).revised,
    "Revised",
  );
  await imported(project, commits.second, reviewChanged);
  assert.deepEqual((await swept(project, commits.second)).reported, []);
  assert.deepEqual(await importerOperations(project), []);
  assert.equal((await standing(project, ticket))?.["authoring_version"], 2);
});

test("a ticket in Work does not move, and its door answers it is no draft", async () => {
  const project = await followingProject("work");
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog()),
  );
  const version = project.memory().ticketVersions.get(ticket);
  assert.ok(version !== undefined);
  const unique = randomUUID();
  assert.equal(
    await project.decide({
      partition: project.partition,
      operation: asOperationId(`dispatch-${unique}`),
      authority: person,
      key: asIdempotencyKey(`dispatch-${unique}`),
      command: {
        version: 1,
        command: "ManualDispatch",
        ticket,
        expectedTicketVersion: version,
      },
    }),
    "Committed",
  );
  const head = await imported(project, commits.second, reviewChanged);
  assert.deepEqual((await swept(project, commits.second)).reported, []);
  assert.deepEqual(
    await importerPort().move({
      partition: project.partition,
      ticket,
      expectedRevision: 1,
      configuration: head,
      program: plainAuthoring.prog,
    }),
    { moved: "Refused", answer: "NotDraft" },
  );
  assert.deepEqual(await importerOperations(project), []);
});

test("a move answered Backpressure leaves the draft at its prior version", async () => {
  const project = await followingProject("backpressure");
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog()),
  );
  await imported(project, commits.second, reviewChanged);
  const pressed = await swept(
    project,
    commits.second,
    importerPort({ ordinarySoftLimit: 0, mailboxHardLimit: 1_250 }),
  );
  assert.deepEqual(
    pressed.reported.map((reported) => reported.followed),
    [{ followed: "Refused", answer: "Backpressure" }],
  );
  assert.deepEqual(await standing(project, ticket), {
    configuration_revision: `repository:${commits.first}:work`,
    revision: 1,
    authoring_version: 1,
    released: 1,
  });
  assert.deepEqual(await importerOperations(project), []);
});

/** A port updating `raced` by a person's revision and update after each read of candidates and before any move. */
function racingPort(
  project: Project,
  port: ConfigurationFollowingPort,
  raced: TicketId,
  held: ConfigurationRevisionId,
): ConfigurationFollowingPort {
  return {
    ...port,
    candidates: async (query) => {
      const page = await port.candidates(query);
      assert.equal(
        (await personRevises(project, raced, 1, held)).revised,
        "Revised",
      );
      const unique = randomUUID();
      assert.equal(
        await project.decide({
          partition: project.partition,
          operation: asOperationId(`update-${unique}`),
          authority: person,
          key: asIdempotencyKey(`update-${unique}`),
          command: {
            version: 1,
            command: "UpdateTicket",
            ticket: raced,
            expectedRevision: 1,
            authoringVersion: 2,
            configurationRevision: held,
          },
        }),
        "Committed",
      );
      return page;
    },
  };
}

test("a ticket updated between the read and the move is refused stale by the writer, the run goes on, and the refused move is not offered again until the ticket changes", async () => {
  const project = await followingProject("raced");
  const held = await imported(project, commits.first, catalog());
  const raced = await released(project, held);
  const calm = await released(project, held);
  const head = await imported(project, commits.second, reviewChanged);
  const port = importerPort();
  const racing = racingPort(project, port, raced, held);
  const run = await swept(project, commits.second, racing);
  assert.deepEqual(
    run.reported.map((reported) => [
      reported.ticket,
      reported.followed.followed,
    ]),
    [
      [raced, "Moved"],
      [calm, "Moved"],
    ],
  );
  assert.equal(await project.decideNext(), "Refused");
  assert.equal(await project.decideNext(), "Committed");
  assert.deepEqual(
    (await importerOperations(project)).map((row) => row["outcome_code"]),
    ["TicketRevisionStale", null],
  );
  assert.deepEqual(await standing(project, raced), {
    configuration_revision: held,
    revision: 2,
    authoring_version: 3,
    released: 2,
  });
  assert.deepEqual(
    await port.move({
      partition: project.partition,
      ticket: raced,
      expectedRevision: 1,
      configuration: head,
      program: plainAuthoring.prog,
    }),
    { moved: "Refused", answer: "IdempotencyConflict" },
  );
  assert.equal((await standing(project, raced))?.["authoring_version"], 3);
  await swept(project, commits.second);
  assert.equal(await project.decideNext(), "Committed");
  assert.deepEqual(await standing(project, raced), {
    configuration_revision: head,
    revision: 3,
    authoring_version: 4,
    released: 4,
  });
});

/** Keeps an import of the project's binding at `commit` as the newest attempted, through the API's own door. */
function attempted(
  project: Project,
  commit: GitObjectId | undefined,
  result: "Imported" | "Unavailable" = "Imported",
): Promise<void> {
  return postgresRepositoryConfigurationImportAttempts(api).record({
    partition: project.partition,
    repository: project.repository,
    ...(commit === undefined ? {} : { commit }),
    outcome: { result },
  });
}

/** What the ticket's own read, through the API's credential, says of its following. */
async function following(project: Project, ticket: TicketId) {
  const read = await postgresNativeReads(api).ticket(project.partition, ticket);
  assert.ok(read !== undefined, "the ticket reads");
  return read.following;
}

/** Every ticket of the project's page, through the API's credential, and whether its row carries a following. */
async function pageFollowing(project: Project) {
  const page = await postgresNativeReads(api).project(project.partition, {
    limit: 10,
  });
  assert.ok(page.result === "Found");
  return page.project.tickets.map((ticket) => [
    ticket.ticket,
    "following" in ticket,
  ]);
}

test("the ticket's own read answers Current and Moves, which a person's unreleased revision does not change, and the project's page carries neither", async () => {
  const project = await followingProject("read-moves");
  const held = await imported(project, commits.first, catalog());
  const moves = await released(project, held);
  const current = await released(
    project,
    await imported(project, commits.first, catalog(), "same"),
  );
  await attempted(project, commits.first);
  assert.deepEqual(
    await following(project, moves),
    { verdict: "Current" },
    "a ticket on its repository's newest revision is current",
  );
  await imported(project, commits.second, reviewChanged);
  await imported(project, commits.second, catalog(), "same");
  await attempted(project, commits.second);
  assert.deepEqual(await following(project, moves), { verdict: "Moves" });
  assert.deepEqual(await following(project, current), { verdict: "Current" });
  assert.deepEqual(await pageFollowing(project), [
    [moves, false],
    [current, false],
  ]);
  assert.equal(
    (await personRevises(project, moves, 1, held)).revised,
    "Revised",
  );
  assert.deepEqual(await following(project, moves), { verdict: "Moves" });
  assert.deepEqual(await importerOperations(project), []);
});

test("the ticket's own read answers Held under the release's code, and Trimmed", async () => {
  const twoStages = (value: Catalog) => {
    part(value, "plans")["standard"] = [
      { name: "review", evaluators: ["review"] },
      { name: "tests", evaluators: ["tests"] },
    ];
  };
  const project = await followingProject("read-held");
  const dropped = await released(
    project,
    await imported(project, commits.first, catalog()),
    { work: "alternative" },
  );
  const trimmed = await released(
    project,
    await imported(project, commits.first, catalog(twoStages), "trimmed"),
  );
  await imported(
    project,
    commits.second,
    catalog((value) => {
      delete part(value, "workloads")["alternative"];
    }),
  );
  await imported(
    project,
    commits.second,
    catalog((value) => {
      twoStages(value);
      part(value, "workloads")["review"] = agent("Review it harder.");
    }),
    "trimmed",
  );
  await attempted(project, commits.second);
  assert.deepEqual(await following(project, dropped), {
    verdict: "Held",
    code: "SelectionUnknown",
  });
  assert.deepEqual(await following(project, trimmed), { verdict: "Trimmed" });
});

test("a following ticket whose repository has no stored head carries no following", async () => {
  const project = await followingProject("read-headless");
  const ticket = await released(
    project,
    await imported(project, commits.first, catalog()),
  );
  assert.equal(await following(project, ticket), undefined, "no import kept");
  await attempted(project, undefined, "Unavailable");
  assert.equal(
    await following(project, ticket),
    undefined,
    "the newest import did not import",
  );
  await imported(project, commits.second, catalog(), "other");
  await attempted(project, commits.second);
  assert.equal(
    await following(project, ticket),
    undefined,
    "the newest import declares no revision of the held name",
  );
  await imported(project, commits.third, reviewChanged);
  await attempted(project, commits.third);
  assert.deepEqual(await following(project, ticket), { verdict: "Moves" });
});

test("a pinned ticket and a ticket no longer Pending carry no following", async () => {
  const project = await followingProject("read-none");
  const pinned = await released(
    project,
    await imported(project, commits.first, catalog()),
    { configuration: "Pinned" },
  );
  const working = await released(
    project,
    await imported(project, commits.first, catalog(), "working"),
  );
  const version = project.memory().ticketVersions.get(working);
  assert.ok(version !== undefined);
  const unique = randomUUID();
  assert.equal(
    await project.decide({
      partition: project.partition,
      operation: asOperationId(`dispatch-${unique}`),
      authority: person,
      key: asIdempotencyKey(`dispatch-${unique}`),
      command: {
        version: 1,
        command: "ManualDispatch",
        ticket: working,
        expectedTicketVersion: version,
      },
    }),
    "Committed",
  );
  await imported(project, commits.second, reviewChanged);
  await imported(project, commits.second, reviewChanged, "working");
  await attempted(project, commits.second);
  assert.equal(await following(project, pinned), undefined);
  assert.equal(await following(project, working), undefined);
});
