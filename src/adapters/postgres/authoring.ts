/** PostgreSQL implementation of versioned native authoring. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asTicketId } from "../../domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  configurationRevisionSummary,
  configurationRevisionSummaryLabelled,
  encodeDraftAuthoring,
  parseDraftAuthoring,
  type AuthoringStore,
  type ConfigurationPage,
  type ConfigurationPageQuery,
  type ConfigurationCreated,
  type ConfigurationRevisionResource,
  type DraftCreated,
  type DraftDeleted,
  type DraftResource,
  type DraftRevised,
  type DraftState,
  type ConfigurationRevisionProvenance,
} from "../../interpreter/authoring.ts";
import { asGitObjectId, asRepositoryId } from "../../interpreter/finalizer.ts";
import { draftBriefOf } from "./ticketBrief.ts";
import { briefFinalizationDefault } from "../../interpreter/ticketBrief.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import {
  type RepositoryConfigurationsImported,
  type RepositoryConfigurationStore,
} from "../../interpreter/repositoryConfiguration.ts";
import {
  asRepositoryConfigurationName,
  asRepositoryConfigurationPath,
  repositoryConfigurationDeclarationsMax,
} from "../../interpreter/repositoryConfigurationIdentity.ts";
import { projectRowCounter } from "./rows.ts";
import {
  configurationVersionOf,
  type ConfigurationVersionRow,
} from "./configurationVersion.ts";
import { configurationRevisionDigest } from "./digest.ts";
import { postgresWorkerCatalog } from "./workerCatalog.ts";
import { domainConfigurationOf } from "../../interpreter/domainConfiguration.ts";

interface DraftRow extends ConfigurationVersionRow {
  readonly ticket: string;
  readonly authoring_version: string;
  readonly state: string;
  readonly configuration_revision: string;
  readonly authoring: string;
  readonly intent: string | null;
  readonly branch: string | null;
  readonly finalization_mode: string | null;
  readonly finalization_target: string | null;
  readonly links: string[] | null;
  readonly checks: string[] | null;
}

interface ConfigurationRow extends ConfigurationVersionRow {
  readonly parent: string | null;
  readonly canonical: string;
  readonly digest: string;
}

interface ConfigurationPageRow extends ConfigurationVersionRow {
  readonly revision: string;
  readonly parent: string | null;
  readonly canonical: string;
  readonly digest: string;
  readonly created_at: string;
  readonly repository: string | null;
  readonly commit: string | null;
  readonly path: string | null;
  readonly name: string | null;
}

function configurationPageProvenance(
  row: ConfigurationPageRow,
): ConfigurationRevisionProvenance {
  if (
    row.repository === null &&
    row.commit === null &&
    row.path === null &&
    row.name === null
  )
    return { source: "Authored" };
  if (
    row.repository === null ||
    row.commit === null ||
    row.path === null ||
    row.name === null
  )
    throw new Error("configuration provenance is partial");
  const path = asRepositoryConfigurationPath(row.path);
  const name = asRepositoryConfigurationName(row.name);
  if (path === undefined || name === undefined)
    throw new Error("configuration provenance is invalid");
  return {
    source: "Repository",
    repository: asRepositoryId(row.repository),
    commit: asGitObjectId(row.commit),
    path,
    name,
  };
}

function configurationPageSummary(row: ConfigurationPageRow) {
  const version = configurationVersionOf(row);
  return configurationRevisionSummary({
    revision: asConfigurationRevisionId(row.revision),
    ...(row.parent === null
      ? {}
      : { parent: asConfigurationRevisionId(row.parent) }),
    canonical: asCanonicalConfiguration(row.canonical),
    digest: row.digest,
    createdAt: asPublicInstant(row.created_at),
    provenance: configurationPageProvenance(row),
    ...(version === undefined ? {} : { version }),
  });
}

async function readConfigurations(
  pool: pg.Pool,
  partition: Partition,
  query: ConfigurationPageQuery,
): Promise<ConfigurationPage> {
  const found = await pool.query<ConfigurationPageRow>(
    sql`SELECT c.revision,c.parent,c.canonical,c.digest,c.created_at::text AS created_at,
               p.repository,p.repository_commit AS commit,p.path,p.name,
               v.name AS version_name,v.number::text AS version_number
          FROM configuration_revision c
          LEFT JOIN repository_configuration_provenance p
            USING (tenant,project,revision)
          LEFT JOIN repository_configuration_version v
            ON v.tenant=c.tenant AND v.project=c.project
           AND v.name=p.name AND v.digest=p.digest
         WHERE c.tenant=${partition.tenant} AND c.project=${partition.project}
           AND (${query.after?.createdAt ?? null}::timestamptz IS NULL
                OR (c.created_at,c.revision) < (${query.after?.createdAt ?? null}::timestamptz,${query.after?.revision ?? null}))
         ORDER BY c.created_at DESC,c.revision DESC
         LIMIT ${query.limit + 1}`,
  );
  const rows = found.rows.slice(0, query.limit);
  const summaries = rows.map(configurationPageSummary);
  const workers = await postgresWorkerCatalog(
    pool,
    summaries.flatMap((summary) =>
      summary.readiness === "Ready" ? [summary.image] : [],
    ),
  );
  const configurations = summaries.map((summary) =>
    configurationRevisionSummaryLabelled(summary, workers),
  );
  const last = rows.at(-1);
  return {
    partition,
    configurations,
    ...(found.rows.length <= query.limit || last === undefined
      ? {}
      : {
          nextAfter: {
            createdAt: asPublicInstant(last.created_at),
            revision: asConfigurationRevisionId(last.revision),
          },
        }),
  };
}

function draftState(value: string): DraftState {
  if (value === "Draft" || value === "Released" || value === "Deleted")
    return value;
  throw new Error(`authoring row: unknown draft state ${value}`);
}

async function readDraft(
  pool: pg.Pool,
  partition: Partition,
  ticket: number,
): Promise<DraftResource | undefined> {
  const found = await pool.query<DraftRow>(
    sql`SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,r.authoring,
              b.intent,b.branch,b.finalization_mode,b.finalization_target,
              v.name AS version_name,v.number::text AS version_number,
              (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                WHERE k.tenant=d.tenant AND k.project=d.project AND k.ticket=d.ticket) AS links,
              (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                WHERE c.tenant=d.tenant AND c.project=d.project AND c.ticket=d.ticket) AS checks
       FROM draft d JOIN draft_revision r USING (tenant,project,ticket,authoring_version)
       LEFT JOIN draft_brief b
         ON b.tenant=d.tenant AND b.project=d.project AND b.ticket=d.ticket
       LEFT JOIN repository_configuration_provenance p
         ON p.tenant=d.tenant AND p.project=d.project
        AND p.revision=d.configuration_revision
       LEFT JOIN repository_configuration_version v
         ON v.tenant=d.tenant AND v.project=d.project
        AND v.name=p.name AND v.digest=p.digest
      WHERE d.tenant=${partition.tenant} AND d.project=${partition.project}
        AND d.ticket=${ticket}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const brief = draftBriefOf(row);
  const configurationVersion = configurationVersionOf(row);
  return {
    partition,
    ticket: asTicketId(projectRowCounter(row.ticket, "draft ticket")),
    authoringVersion: projectRowCounter(
      row.authoring_version,
      "authoring version",
    ),
    state: draftState(row.state),
    configurationRevision: asConfigurationRevisionId(
      row.configuration_revision,
    ),
    ...(configurationVersion === undefined ? {} : { configurationVersion }),
    authoring: parseDraftAuthoring(row.authoring),
    ...(brief === undefined ? {} : { brief }),
  };
}

async function readConfiguration(
  pool: pg.Pool,
  partition: Partition,
  revision: string,
): Promise<ConfigurationRevisionResource | undefined> {
  const found = await pool.query<ConfigurationRow>(
    sql`SELECT c.parent,c.canonical,c.digest,
               v.name AS version_name,v.number::text AS version_number
          FROM configuration_revision c
          LEFT JOIN repository_configuration_provenance p
            USING (tenant,project,revision)
          LEFT JOIN repository_configuration_version v
            ON v.tenant=c.tenant AND v.project=c.project
           AND v.name=p.name AND v.digest=p.digest
      WHERE c.tenant=${partition.tenant} AND c.project=${partition.project}
        AND c.revision=${revision}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const canonical = asCanonicalConfiguration(row.canonical);
  if (configurationRevisionDigest(canonical) !== row.digest)
    throw new Error("configuration revision content contradicts its digest");
  const version = configurationVersionOf(row);
  const resource = {
    partition,
    revision: asConfigurationRevisionId(revision),
    canonical,
    digest: row.digest,
    ...(version === undefined ? {} : { version }),
  };
  return row.parent === null
    ? resource
    : { ...resource, parent: asConfigurationRevisionId(row.parent) };
}

async function initializeDraft(
  pool: pg.Pool,
  partition: Partition,
  revision: string,
  dependencyCandidatesMax: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const project = await client.query<{ head: string }>(
      sql`SELECT head FROM project WHERE tenant=${partition.tenant} AND project=${partition.project}`,
    );
    const policy = await client.query<{ domain_configuration: string }>(
      sql`SELECT domain_configuration FROM deployment_authoring_policy WHERE singleton=true`,
    );
    const configuration = await client.query<ConfigurationRow>(
      sql`SELECT c.parent,c.canonical,c.digest,
                 v.name AS version_name,v.number::text AS version_number
            FROM configuration_revision c
            LEFT JOIN repository_configuration_provenance p
              USING (tenant,project,revision)
            LEFT JOIN repository_configuration_version v
              ON v.tenant=c.tenant AND v.project=c.project
             AND v.name=p.name AND v.digest=p.digest
        WHERE c.tenant=${partition.tenant} AND c.project=${partition.project} AND c.revision=${revision}`,
    );
    const row = configuration.rows[0];
    const standing = project.rows[0];
    if (row === undefined || standing === undefined) {
      await client.query("COMMIT");
      return undefined;
    }
    const configured = policy.rows[0];
    if (configured === undefined) {
      await client.query("COMMIT");
      return "PolicyUnavailable" as const;
    }
    const canonical = asCanonicalConfiguration(row.canonical);
    if (configurationRevisionDigest(canonical) !== row.digest)
      throw new Error("configuration revision content contradicts its digest");
    const dependencies = await client.query<{ ticket: string }>(
      sql`SELECT ticket FROM ticket_projection
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND dependable=true
        ORDER BY ticket LIMIT ${dependencyCandidatesMax + 1}`,
    );
    await client.query("COMMIT");
    return initializedDraftOf({
      partition,
      revision,
      row,
      standing,
      canonical,
      dependencies: dependencies.rows,
      dependencyCandidatesMax,
      configured: configured.domain_configuration,
    });
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
}

function initializedDraftOf(input: {
  readonly partition: Partition;
  readonly revision: string;
  readonly row: ConfigurationRow;
  readonly standing: { readonly head: string };
  readonly canonical: ReturnType<typeof asCanonicalConfiguration>;
  readonly dependencies: readonly { readonly ticket: string }[];
  readonly dependencyCandidatesMax: number;
  readonly configured: string;
}) {
  const version = configurationVersionOf(input.row);
  return {
    configuration: {
      partition: input.partition,
      revision: asConfigurationRevisionId(input.revision),
      ...(input.row.parent === null
        ? {}
        : { parent: asConfigurationRevisionId(input.row.parent) }),
      canonical: input.canonical,
      digest: input.row.digest,
      ...(version === undefined ? {} : { version }),
    },
    projectSequence: projectRowCounter(
      input.standing.head,
      "project initialization fence",
    ),
    dependencyCandidates: input.dependencies
      .slice(0, input.dependencyCandidatesMax)
      .map((candidate) =>
        asTicketId(projectRowCounter(candidate.ticket, "dependency candidate")),
      ),
    dependencyCandidatesTruncated:
      input.dependencies.length > input.dependencyCandidatesMax,
    domain: domainConfigurationOf(JSON.parse(input.configured)),
  };
}

async function requiredDraft(
  pool: pg.Pool,
  partition: Partition,
  ticket: number,
): Promise<DraftResource> {
  const draft = await readDraft(pool, partition, ticket);
  if (draft === undefined)
    throw new Error("authoring transition returned an absent draft");
  return draft;
}

async function requiredConfiguration(
  pool: pg.Pool,
  partition: Partition,
  revision: string,
): Promise<ConfigurationRevisionResource> {
  const configuration = await readConfiguration(pool, partition, revision);
  if (configuration === undefined)
    throw new Error("configuration transition returned an absent revision");
  return configuration;
}

function nonDraftState(value: string): "Released" | "Deleted" {
  const state = draftState(value);
  if (state === "Draft")
    throw new Error("authoring transition returned Draft as a terminal state");
  return state;
}

type CreateConfigurationInput = Parameters<
  AuthoringStore["createConfiguration"]
>[0];
type CreateDraftInput = Parameters<AuthoringStore["createDraft"]>[0];
type ReviseDraftInput = Parameters<AuthoringStore["reviseDraft"]>[0];
type DeleteDraftInput = Parameters<AuthoringStore["deleteDraft"]>[0];
type ImportRepositoryConfigurationsInput = Parameters<
  RepositoryConfigurationStore["importRepositoryConfigurations"]
>[0];

function repositoryImportConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P0001"
  );
}

async function importRepositoryConfigurations(
  pool: pg.Pool,
  input: ImportRepositoryConfigurationsInput,
): Promise<RepositoryConfigurationsImported> {
  if (input.declarations.length > repositoryConfigurationDeclarationsMax)
    throw new RangeError("repository configuration import exceeds its bound");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const declaration of input.declarations) {
      const digest = configurationRevisionDigest(declaration.canonical);
      const imported = await client.query<{ result: string | null }>(
        sql`SELECT import_repository_configuration(${input.partition.tenant},${input.partition.project},${input.binding.repository},${input.binding.recoveryEpoch},${declaration.revision},${declaration.canonical},${digest},${declaration.commit},${declaration.path},${declaration.name},${input.authority.kind},${input.authority.subject})::text AS result`,
      );
      const result = imported.rows[0]?.result;
      if (result === "StaleBinding") {
        await client.query("ROLLBACK");
        return { imported: "StaleBinding" };
      }
      if (result !== "Imported" && result !== "AlreadyImported")
        throw new Error(
          `repository configuration transition returned ${String(result)}`,
        );
    }
    await client.query("COMMIT");
    return { imported: "Imported" };
  } catch (error) {
    await client.query("ROLLBACK");
    if (repositoryImportConflict(error))
      return { imported: "IdentityConflict" };
    throw error;
  } finally {
    client.release();
  }
}

async function createConfiguration(
  pool: pg.Pool,
  input: CreateConfigurationInput,
): Promise<ConfigurationCreated> {
  const found = await pool.query<{ result: string | null }>(
    sql`SELECT create_configuration_revision(${input.partition.tenant},${input.partition.project},${input.revision},${input.parent ?? null},${input.canonical},${configurationRevisionDigest(input.canonical)},${input.authority.kind},${input.authority.subject})::text AS result`,
  );
  const result = found.rows[0]?.result;
  if (result === "ParentNotFound" || result === "IdentityConflict")
    return { created: result };
  if (result !== "Created" && result !== "AlreadyExists")
    throw new Error(`configuration transition returned ${String(result)}`);
  return {
    created: result,
    revision: await requiredConfiguration(
      pool,
      input.partition,
      input.revision,
    ),
  };
}

async function createDraft(
  pool: pg.Pool,
  input: CreateDraftInput,
): Promise<DraftCreated> {
  const found = await pool.query<{
    result: string | null;
    ticket: string | null;
  }>(
    sql`SELECT result,ticket FROM create_draft(${input.partition.tenant},${input.partition.project},${input.configurationRevision},${input.configurationDigest},${input.expectedProjectSequence},${encodeDraftAuthoring(input.authoring)},${input.brief.intent},${[...input.brief.links]},${[...input.brief.checks]},${input.brief.branch ?? null},${input.brief.finalization?.mode ?? briefFinalizationDefault.mode},${input.brief.finalization?.target ?? null},${input.authority.kind},${input.authority.subject})`,
  );
  const row = found.rows[0];
  if (row?.result === "ConfigurationNotFound")
    return { created: "ConfigurationNotFound" };
  if (row?.result === "Stale") return { created: "Stale" };
  if (row?.result !== "Created" || row.ticket === null)
    throw new Error("draft creation returned no ticket");
  return {
    created: "Created",
    draft: await requiredDraft(pool, input.partition, Number(row.ticket)),
  };
}

async function reviseDraft(
  pool: pg.Pool,
  input: ReviseDraftInput,
): Promise<DraftRevised> {
  const found = await pool.query<{
    result: string | null;
    authoring_version: string | null;
    state: string | null;
  }>(
    sql`SELECT * FROM revise_draft(${input.partition.tenant},${input.partition.project},${input.ticket},${input.expectedVersion},${input.configurationRevision},${encodeDraftAuthoring(input.authoring)},${input.brief.intent},${[...input.brief.links]},${[...input.brief.checks]},${input.brief.branch ?? null},${input.brief.finalization?.mode ?? briefFinalizationDefault.mode},${input.brief.finalization?.target ?? null},${input.authority.kind},${input.authority.subject})`,
  );
  const row = found.rows[0];
  if (row === undefined || row.result === "NotFound")
    return { revised: "NotFound" };
  if (row.result === "ConfigurationNotFound")
    return { revised: "ConfigurationNotFound" };
  if (row.result === "Stale") {
    if (row.authoring_version === null)
      throw new Error("draft revision returned Stale with no current version");
    return {
      revised: "Stale",
      currentVersion: projectRowCounter(
        row.authoring_version,
        "authoring version",
      ),
    };
  }
  if (row.result === "NotDraft" && row.state !== null)
    return { revised: "NotDraft", state: nonDraftState(row.state) };
  if (row.result !== "Revised")
    throw new Error(`draft revision returned ${row.result}`);
  return {
    revised: "Revised",
    draft: await requiredDraft(pool, input.partition, input.ticket),
  };
}

async function deleteDraft(
  pool: pg.Pool,
  input: DeleteDraftInput,
): Promise<DraftDeleted> {
  const found = await pool.query<{
    result: string | null;
    authoring_version: string | null;
    state: string | null;
  }>(
    sql`SELECT * FROM delete_draft(${input.partition.tenant},${input.partition.project},${input.ticket},${input.expectedVersion},${input.authority.kind},${input.authority.subject})`,
  );
  const row = found.rows[0];
  if (row === undefined || row.result === "NotFound")
    return { deleted: "NotFound" };
  if (row.result === "Stale") {
    if (row.authoring_version === null)
      throw new Error("draft deletion returned Stale with no current version");
    return {
      deleted: "Stale",
      currentVersion: projectRowCounter(
        row.authoring_version,
        "authoring version",
      ),
    };
  }
  if (row.result === "NotDraft" && row.state !== null)
    return { deleted: "NotDraft", state: nonDraftState(row.state) };
  if (row.result !== "Deleted")
    throw new Error(`draft deletion returned ${row.result}`);
  return {
    deleted: "Deleted",
    draft: await requiredDraft(pool, input.partition, input.ticket),
  };
}

/** Answers the native authoring port through constrained server functions. */
export function postgresAuthoring(
  pool: pg.Pool,
): AuthoringStore & RepositoryConfigurationStore {
  return {
    initializeDraft: (partition, revision, dependencyCandidatesMax) =>
      initializeDraft(pool, partition, revision, dependencyCandidatesMax),
    configurations: (partition, query) =>
      readConfigurations(pool, partition, query),
    configuration: (partition, revision) =>
      readConfiguration(pool, partition, revision),
    draft: (partition, ticket) => readDraft(pool, partition, ticket),
    createConfiguration: (input) => createConfiguration(pool, input),
    importRepositoryConfigurations: (input) =>
      importRepositoryConfigurations(pool, input),
    createDraft: (input) => createDraft(pool, input),
    reviseDraft: (input) => reviseDraft(pool, input),
    deleteDraft: (input) => deleteDraft(pool, input),
  };
}
