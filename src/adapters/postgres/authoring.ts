/** PostgreSQL implementation of versioned native authoring. */

import { createHash } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asTicketId } from "../../domain/ids.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  encodeDraftAuthoring,
  parseDraftAuthoring,
  type AuthoringStore,
  type ConfigurationCreated,
  type ConfigurationRevisionResource,
  type DraftCreated,
  type DraftDeleted,
  type DraftResource,
  type DraftRevised,
  type DraftState,
} from "../../interpreter/authoring.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { projectRowCounter } from "./rows.ts";

interface DraftRow {
  readonly ticket: string;
  readonly authoring_version: string;
  readonly state: string;
  readonly configuration_revision: string;
  readonly authoring: string;
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
    sql`SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,r.authoring
       FROM draft d JOIN draft_revision r USING (tenant,project,ticket,authoring_version)
      WHERE d.tenant=${partition.tenant} AND d.project=${partition.project}
        AND d.ticket=${ticket}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
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
    authoring: parseDraftAuthoring(row.authoring),
  };
}

async function readConfiguration(
  pool: pg.Pool,
  partition: Partition,
  revision: string,
): Promise<ConfigurationRevisionResource | undefined> {
  const found = await pool.query<{
    parent: string | null;
    canonical: string;
    digest: string;
  }>(
    sql`SELECT parent,canonical,digest FROM configuration_revision
      WHERE tenant=${partition.tenant} AND project=${partition.project}
        AND revision=${revision}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const canonical = asCanonicalConfiguration(row.canonical);
  if (digest(canonical) !== row.digest)
    throw new Error("configuration revision content contradicts its digest");
  const resource = {
    partition,
    revision: asConfigurationRevisionId(revision),
    canonical,
    digest: row.digest,
  };
  return row.parent === null
    ? resource
    : { ...resource, parent: asConfigurationRevisionId(row.parent) };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

async function createConfiguration(
  pool: pg.Pool,
  input: CreateConfigurationInput,
): Promise<ConfigurationCreated> {
  const found = await pool.query<{ result: string | null }>(
    sql`SELECT create_configuration_revision(${input.partition.tenant},${input.partition.project},${input.revision},${input.parent ?? null},${input.canonical},${digest(input.canonical)},${input.authority.kind},${input.authority.subject})::text AS result`,
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
    sql`SELECT result,ticket FROM create_draft(${input.partition.tenant},${input.partition.project},${input.configurationRevision},${encodeDraftAuthoring(input.authoring)},${input.authority.kind},${input.authority.subject})`,
  );
  const row = found.rows[0];
  if (row?.result === "ConfigurationNotFound")
    return { created: "ConfigurationNotFound" };
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
    sql`SELECT * FROM revise_draft(${input.partition.tenant},${input.partition.project},${input.ticket},${input.expectedVersion},${input.configurationRevision},${encodeDraftAuthoring(input.authoring)},${input.authority.kind},${input.authority.subject})`,
  );
  const row = found.rows[0];
  if (row === undefined || row.result === "NotFound")
    return { revised: "NotFound" };
  if (row.result === "ConfigurationNotFound")
    return { revised: "ConfigurationNotFound" };
  if (row.result === "Stale")
    return {
      revised: "Stale",
      currentVersion: projectRowCounter(
        row.authoring_version ?? "",
        "authoring version",
      ),
    };
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
  if (row.result === "Stale")
    return {
      deleted: "Stale",
      currentVersion: projectRowCounter(
        row.authoring_version ?? "",
        "authoring version",
      ),
    };
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
export function postgresAuthoring(pool: pg.Pool): AuthoringStore {
  return {
    configuration: (partition, revision) =>
      readConfiguration(pool, partition, revision),
    draft: (partition, ticket) => readDraft(pool, partition, ticket),
    createConfiguration: (input) => createConfiguration(pool, input),
    createDraft: (input) => createDraft(pool, input),
    reviseDraft: (input) => reviseDraft(pool, input),
    deleteDraft: (input) => deleteDraft(pool, input),
  };
}
