/**
 * The last configuration import attempted of each binding, against a real
 * server: kept by the importer under its own role and by the route under the
 * API's, and answered on the listing the API reads.
 *
 * WHAT A REPOSITORY HOLDS IS THE FIXTURE AND NOTHING AFTER IT IS. Each binding
 * is answered a head and a snapshot of its own; the binding read, the import,
 * the attempt kept and the listing are the server's.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  configurationCanonicalCharsMax,
  repositoryConfigurationImportRefusalsKeptMax,
} from "../../src/contract/http.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresProjectRepositoryRetirement,
  postgresRepositoryBindingListing,
} from "../../src/adapters/postgres/repositoryBinding.ts";
import {
  postgresProjectRepositoryBinding,
  postgresRepositoryConfigurationImportAttempts,
  postgresRepositoryConfigurationImportAttemptsRead,
} from "../../src/adapters/postgres/repositoryConfiguration.ts";
import { postgresAuthoring } from "../../src/adapters/postgres/authoring.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import {
  apiRole,
  configurationImporterRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import {
  composeNativeWeb,
  composeRepositoryOnboarding,
} from "../../src/compose.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type GitObjectId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  importBoundRepositories,
  type RepositoryConfigurationImportAttempt,
  type RepositoryConfigurationSnapshotRead,
  type RepositoryDefaultBranchRead,
} from "../../src/interpreter/repositoryConfiguration.ts";
import type { ProjectRepositoryListed } from "../../src/interpreter/repositoryOnboarding.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessRolePool,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";
import {
  fixtureBindRepository,
  fixtureBoundRepository,
} from "./repositoryBindingFixture.ts";

/** UTC ISO 8601, the form the listing answers every instant in. */
const configurationImportInstantForm =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u;

let harness: PostgresHarness;
let pool: pg.Pool;
let apiPool: pg.Pool;
let importerPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
  apiPool = postgresHarnessRolePool(apiRole);
  importerPool = postgresHarnessRolePool(configurationImporterRole);
});
after(async () => {
  await importerPool.end();
  await apiPool.end();
  await pool.end();
  await harness.close();
});

const principal = asPrincipal("import-attempt");

/** A member every question of standing is answered for, so a case turns on the repository alone. */
const fixtureMember: ProjectAccess = {
  authorize: (asked) => Promise.resolve(memberAuthority(asked)),
  authorizeTenant: () => Promise.resolve(undefined),
  authorizeSite: projectAccessSiteRefused,
};

/** The one declaration file a repository holds, its content as given. */
function declarationFiles(
  content: string,
): RepositoryConfigurationSnapshotRead {
  return {
    read: "Snapshot",
    files: [
      {
        path: [".chug", "configurations", "work.json"].join("/"),
        kind: "File",
        content,
      },
    ],
  };
}

const declared = declarationFiles(
  JSON.stringify({
    version: 1,
    name: "work",
    configuration: JSON.parse(postgresHarnessConfiguration) as unknown,
  }),
);

/** A head naming its own commit, on the branch every case's repository defaults to. */
function branchAt(commit: GitObjectId): RepositoryDefaultBranchRead {
  return { read: "Branch", branch: asGitRefName("refs/heads/main"), commit };
}

/** What one repository answers, and what is kept of an import from it. */
interface ImportCase {
  readonly label: string;
  readonly head: RepositoryDefaultBranchRead;
  readonly snapshot: RepositoryConfigurationSnapshotRead;
  readonly kept: Omit<RepositoryConfigurationImportAttempt, "attemptedAt">;
}

const commitOf = (digit: string) => asGitObjectId(digit.repeat(40));

/** Every way an import at a commit comes out, each at a commit of its own. */
const atCommit: readonly ImportCase[] = [
  {
    label: "imported",
    head: branchAt(commitOf("1")),
    snapshot: declared,
    kept: { commit: commitOf("1"), outcome: { result: "Imported" } },
  },
  {
    label: "undeclared",
    head: branchAt(commitOf("2")),
    snapshot: { read: "Absent", absent: "ConfigurationDirectory" },
    kept: {
      commit: commitOf("2"),
      outcome: { result: "SnapshotAbsent", absent: "ConfigurationDirectory" },
    },
  },
  {
    label: "missing",
    head: branchAt(commitOf("3")),
    snapshot: { read: "Absent", absent: "Commit" },
    kept: {
      commit: commitOf("3"),
      outcome: { result: "SnapshotAbsent", absent: "Commit" },
    },
  },
  {
    label: "unreadable",
    head: branchAt(commitOf("4")),
    snapshot: { read: "Refused", refused: "Snapshot" },
    kept: { commit: commitOf("4"), outcome: { result: "SnapshotRefused" } },
  },
  {
    label: "unavailable",
    head: branchAt(commitOf("5")),
    snapshot: { read: "Unavailable", unavailable: "Repository" },
    kept: { commit: commitOf("5"), outcome: { result: "Unavailable" } },
  },
  {
    label: "invalid",
    head: branchAt(commitOf("6")),
    snapshot: declarationFiles("{"),
    kept: {
      commit: commitOf("6"),
      outcome: {
        result: "DeclarationsRefused",
        refusals: [
          {
            path: [".chug", "configurations", "work.json"].join("/"),
            fault: "DocumentUnreadable",
          },
        ],
        refusalCount: 1,
      },
    },
  },
  {
    label: "conflicted",
    head: branchAt(commitOf("7")),
    snapshot: declared,
    kept: { commit: commitOf("7"), outcome: { result: "IdentityConflict" } },
  },
];

/** Every way a head naming no commit comes out. */
const atNoCommit: readonly ImportCase[] = [
  {
    label: "empty",
    head: { read: "Absent" },
    snapshot: declared,
    kept: { outcome: { result: "SnapshotAbsent", absent: "Commit" } },
  },
  {
    label: "unreachable",
    head: { read: "Unavailable" },
    snapshot: declared,
    kept: { outcome: { result: "Unavailable" } },
  },
];

/** The cases bound into one project, each repository answering its own. */
interface BoundCases {
  readonly partition: Partition;
  readonly repositories: readonly RepositoryId[];
  readonly answered: ReadonlyMap<RepositoryId, ImportCase>;
}

/**
 * Binds one repository a case into a project of its own, and holds the
 * conflicted case's name at its commit already, under other content.
 */
async function bindCases(
  label: string,
  cases: readonly ImportCase[],
): Promise<BoundCases> {
  const partition = postgresHarnessPartition(label);
  await harness.store.createProject(partition);
  const answered = new Map<RepositoryId, ImportCase>();
  for (const each of cases)
    answered.set(
      asRepositoryId(
        await fixtureBoundRepository(harness, pool, partition, each.label),
      ),
      each,
    );
  const conflicted = cases.find((each) => each.label === "conflicted");
  if (conflicted?.kept.commit !== undefined)
    await harness.authoring.createConfiguration({
      partition,
      authority: {
        kind: asAuthorityKind("User"),
        subject: asAuthoritySubject("author"),
      },
      revision: asConfigurationRevisionId(
        `repository:${conflicted.kept.commit}:work`,
      ),
      canonical: asCanonicalConfiguration("{}"),
    });
  return { partition, repositories: [...answered.keys()], answered };
}

/** The repository reads every case answers, by the repository asked of. */
function fixtureRepositories(answered: BoundCases["answered"]) {
  const of = (repository: RepositoryId): ImportCase => {
    const found = answered.get(repository);
    if (found === undefined) throw new Error(`${repository} is no case`);
    return found;
  };
  return {
    defaultBranch: (binding: { readonly repository: RepositoryId }) =>
      Promise.resolve(of(binding.repository).head),
    snapshot: (request: {
      readonly repository: { readonly repository: RepositoryId };
    }) => Promise.resolve(of(request.repository.repository).snapshot),
    referenced: () =>
      Promise.resolve({ read: "Referenced" as const, files: [] }),
  };
}

/** What the API reads as kept of each case's repository, by label. */
async function keptOf(
  bound: BoundCases,
): Promise<Readonly<Record<string, unknown>>> {
  const attempted = await postgresRepositoryConfigurationImportAttemptsRead(
    apiPool,
  ).attempted({
    partition: bound.partition,
    repositories: bound.repositories,
  });
  return Object.fromEntries(
    [...bound.answered].map(([repository, each]) => {
      const kept = attempted.get(repository);
      return [
        each.label,
        kept === undefined
          ? "none"
          : {
              ...(kept.commit === undefined ? {} : { commit: kept.commit }),
              outcome: kept.outcome,
            },
      ];
    }),
  );
}

/** What every case expects kept, by label. */
function expectedOf(cases: readonly ImportCase[]): Record<string, unknown> {
  return Object.fromEntries(cases.map((each) => [each.label, each.kept]));
}

/** One importer run over the project's bindings alone, under the importer's own role. */
async function importerRun(
  bound: BoundCases,
  bindings = postgresProjectRepositoryBinding(importerPool),
): Promise<void> {
  const listing = postgresRepositoryBindingListing(importerPool);
  const repositories = fixtureRepositories(bound.answered);
  await importBoundRepositories({
    authority: {
      kind: asAuthorityKind("Service"),
      subject: asAuthoritySubject("configuration-mirror-importer"),
    },
    ports: {
      listing: {
        bindings: async (max) =>
          (await listing.bindings(max)).filter(
            (listed) => listed.partition.project === bound.partition.project,
          ),
      },
      bindings,
      heads: repositories,
      snapshots: repositories,
      store: postgresAuthoring(importerPool),
      attempts: postgresRepositoryConfigurationImportAttempts(importerPool),
      actionSnapshots: {
        actionSnapshot: () => Promise.resolve({ read: "Snapshot", files: [] }),
      },
      actionStore: {
        importRepositoryActions: () =>
          Promise.resolve({ imported: "Imported" }),
      },
    },
  });
}

test("the importer keeps each way a binding's import came out, at the head it read or at none", async () => {
  const cases = [...atCommit, ...atNoCommit];
  const bound = await bindCases("import-attempt-importer", cases);
  assert.deepEqual(
    await keptOf(bound),
    Object.fromEntries(cases.map((each) => [each.label, "none"])),
  );
  await importerRun(bound);
  assert.deepEqual(await keptOf(bound), expectedOf(cases));
});

/**
 * An unchanged head writes no revision, so the attempt is the only record that
 * it was read again: a second run keeps the same outcome at a later time.
 */
test("an importer run at an unchanged head keeps the attempt again, later", async () => {
  const imported = atCommit.filter((each) => each.label === "imported");
  const bound = await bindCases("import-attempt-unchanged", imported);
  const attemptedAt = async () => {
    const [repository] = bound.repositories;
    if (repository === undefined) throw new Error("no repository was bound");
    const kept = (
      await postgresRepositoryConfigurationImportAttemptsRead(
        apiPool,
      ).attempted({ partition: bound.partition, repositories: [repository] })
    ).get(repository);
    return kept?.attemptedAt;
  };
  await importerRun(bound);
  const first = await attemptedAt();
  await importerRun(bound);
  const second = await attemptedAt();
  assert.deepEqual(await keptOf(bound), expectedOf(imported));
  assert.ok(first !== undefined && second !== undefined);
  assert.match(second, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u);
  assert.ok(Date.parse(second) > Date.parse(first), `${first} ${second}`);
});

/**
 * A binding no reader of the binding can make stale, since its epoch never
 * moves: the binding read is answered under another epoch, so the import's
 * door finds the binding it was told of gone.
 */
test("the importer keeps an import refused as a stale binding", async () => {
  const stale: ImportCase = {
    label: "stale",
    head: branchAt(commitOf("8")),
    snapshot: declared,
    kept: { commit: commitOf("8"), outcome: { result: "StaleBinding" } },
  };
  const bound = await bindCases("import-attempt-stale", [stale]);
  const read = postgresProjectRepositoryBinding(importerPool);
  await importerRun(bound, {
    binding: async (partition, repository) => {
      const binding = await read.binding(partition, repository);
      return (
        binding && {
          ...binding,
          recoveryEpoch: asRecoveryEpoch("epoch-moved"),
        }
      );
    },
  });
  assert.deepEqual(await keptOf(bound), expectedOf([stale]));
});

/** The route as the API composes it, under the API's own role, over the cases' repositories. */
function routeOver(bound: BoundCases) {
  return composeNativeWeb(
    apiPool,
    postgresHarnessKeying(),
    fixtureMember,
    postgresExecutionBacklogGuard(apiPool),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fixtureRepositories(bound.answered),
  );
}

test("the route keeps each way an import it was asked for came out, at its default branch's head", async () => {
  const bound = await bindCases("import-attempt-route", atCommit);
  const web = routeOver(bound);
  for (const [repository, each] of bound.answered) {
    if (each.head.read !== "Branch") throw new Error("the case names no head");
    await web.importRepositoryConfigurations(principal, bound.partition, {
      repository,
    });
  }
  assert.deepEqual(await keptOf(bound), expectedOf(atCommit));
});

test("the route asked for no commit imports at the head it read, and keeps an attempt at none where the head named none", async () => {
  const cases = [...atCommit, ...atNoCommit];
  const bound = await bindCases("import-attempt-route-head", cases);
  const web = routeOver(bound);
  const answered: Record<string, string> = {};
  for (const [repository, each] of bound.answered)
    answered[each.label] = (
      await web.importRepositoryConfigurations(principal, bound.partition, {
        repository,
      })
    ).result;
  assert.deepEqual(await keptOf(bound), expectedOf(cases));
  assert.deepEqual(
    answered,
    Object.fromEntries(
      cases.map((each) => [each.label, each.kept.outcome.result]),
    ),
  );
});

/** One project's listing as the API composes it, by repository. */
async function listedOf(
  partition: Partition,
): Promise<ReadonlyMap<string, ProjectRepositoryListed>> {
  const listed = await composeRepositoryOnboarding({
    apiPool,
    access: fixtureMember,
    credentials: { credential: () => Promise.reject(new Error("unasked")) },
    forgeApps: [],
  }).projectRepositories(principal, partition);
  assert.equal(listed.result, "Repositories");
  if (listed.result !== "Repositories") return new Map();
  return new Map(listed.repositories.map((row) => [row.repository, row]));
}

/** The listing as the API composes it, a binding never attempted carrying no attempt at all. */
test("the listing answers each binding's last attempt, and nothing of one never attempted", async () => {
  const [imported] = atCommit;
  if (imported === undefined) throw new Error("no imported case");
  const never: ImportCase = { ...imported, label: "never" };
  const bound = await bindCases("import-attempt-listing", [imported, never]);
  const [attempted, untouched] = bound.repositories;
  if (attempted === undefined || untouched === undefined)
    throw new Error("the cases were not bound");
  await routeOver(bound).importRepositoryConfigurations(
    principal,
    bound.partition,
    { repository: attempted },
  );
  const byRepository = await listedOf(bound.partition);
  const lastImport = byRepository.get(attempted)?.lastImport;
  const instants = [
    byRepository.get(attempted)?.boundAt,
    lastImport?.attemptedAt,
  ];
  for (const instant of instants)
    assert.match(instant ?? "", configurationImportInstantForm);
  assert.deepEqual(lastImport && { ...lastImport, attemptedAt: "at" }, {
    attemptedAt: "at",
    commit: commitOf("1"),
    outcome: { result: "Imported" },
  });
  assert.ok(byRepository.has(untouched));
  assert.equal(
    Object.hasOwn(byRepository.get(untouched) ?? {}, "lastImport"),
    false,
  );
});

/**
 * A retired repository is released to any project, and an attempt is its
 * binding's: a project that binds it after another retired it has attempted
 * nothing of it, whether it is a sibling in the tenant or a project of the same
 * name in another.
 */
test("a repository bound again after another project retired it carries none of that project's attempts", async () => {
  const first = postgresHarnessPartition("import-attempt-released");
  const sibling = { ...first, project: asProjectId(`project-${randomUUID()}`) };
  const namesake = { ...first, tenant: asTenantId(`tenant-${randomUUID()}`) };
  for (const partition of [first, sibling, namesake])
    await harness.store.createProject(partition);
  const repository = asRepositoryId(
    await fixtureBoundRepository(harness, pool, first, "released"),
  );
  await postgresRepositoryConfigurationImportAttempts(apiPool).record({
    partition: first,
    repository,
    commit: commitOf("1"),
    outcome: { result: "Imported" },
  });
  const retirement = postgresProjectRepositoryRetirement(pool);
  const hasAttempt = async (partition: Partition) => [
    (await listedOf(partition)).has(repository),
    Object.hasOwn(
      (await listedOf(partition)).get(repository) ?? {},
      "lastImport",
    ),
  ];
  assert.deepEqual(await hasAttempt(first), [true, true]);

  for (const [held, next] of [
    [first, sibling],
    [sibling, namesake],
  ] as const) {
    assert.equal(
      (await retirement.retire({ partition: held, repository })).outcome,
      "Retired",
    );
    assert.equal(
      await fixtureBindRepository(harness, pool, next, repository),
      "Bound",
    );
    assert.deepEqual(await hasAttempt(next), [true, false]);
  }
});

/** A snapshot of `count` declaration files, none of them a document. */
function unreadableFiles(count: number): RepositoryConfigurationSnapshotRead {
  return {
    read: "Snapshot",
    files: Array.from({ length: count }, (_, at) => ({
      path: [".chug", "configurations", `work-${String(at)}.json`].join("/"),
      kind: "File" as const,
      content: "{",
    })),
  };
}

/**
 * A listing carries a binding's attempt whole, so what a refused one keeps is
 * bounded: its first refusals, and how many there were.
 */
test("a refused import keeps its first refusals and how many there were, answers them on the listing, and a later import clears them", async () => {
  const refused: ImportCase = {
    label: "refused",
    head: branchAt(commitOf("9")),
    snapshot: unreadableFiles(repositoryConfigurationImportRefusalsKeptMax + 2),
    kept: { outcome: { result: "Imported" } },
  };
  const bound = await bindCases("import-attempt-refusals", [refused]);
  const [repository] = bound.repositories;
  if (repository === undefined) throw new Error("no repository was bound");
  const web = routeOver(bound);
  await web.importRepositoryConfigurations(principal, bound.partition, {
    repository,
  });
  assert.deepEqual(
    (await listedOf(bound.partition)).get(repository)?.lastImport?.outcome,
    {
      result: "DeclarationsRefused",
      refusals: Array.from(
        { length: repositoryConfigurationImportRefusalsKeptMax },
        (_, at) => ({
          path: [".chug", "configurations", `work-${String(at)}.json`].join(
            "/",
          ),
          fault: "DocumentUnreadable",
        }),
      ),
      refusalCount: repositoryConfigurationImportRefusalsKeptMax + 2,
    },
  );

  const mended = new Map([
    [
      repository,
      { ...refused, head: branchAt(commitOf("a")), snapshot: declared },
    ],
  ]);
  await routeOver({
    ...bound,
    answered: mended,
  }).importRepositoryConfigurations(principal, bound.partition, { repository });
  assert.deepEqual(
    (await listedOf(bound.partition)).get(repository)?.lastImport?.outcome,
    {
      result: "Imported",
    },
  );
  assert.deepEqual(
    (
      await pool.query<{ refusals: unknown; refusal_count: number | null }>(
        `SELECT refusals,refusal_count FROM repository_configuration_import
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        [bound.partition.tenant, bound.partition.project, repository],
      )
    ).rows,
    [{ refusals: null, refusal_count: null }],
  );
});

test("a refusal of a configuration too long is kept with its length and the limit", async () => {
  const partition = postgresHarnessPartition("import-attempt-too-long");
  await harness.store.createProject(partition);
  const repository = asRepositoryId(
    await fixtureBoundRepository(harness, pool, partition, "too-long"),
  );
  const outcome = {
    result: "DeclarationsRefused",
    refusals: [
      {
        path: [".chug", "configurations", "work.json"].join("/"),
        fault: "ConfigurationTooLong",
        chars: configurationCanonicalCharsMax + 1,
        charsMax: configurationCanonicalCharsMax,
      },
    ],
    refusalCount: 1,
  } as const;
  await postgresRepositoryConfigurationImportAttempts(importerPool).record({
    partition,
    repository,
    commit: commitOf("b"),
    outcome,
  });
  assert.deepEqual(
    (await listedOf(partition)).get(repository)?.lastImport?.outcome,
    outcome,
  );
});
