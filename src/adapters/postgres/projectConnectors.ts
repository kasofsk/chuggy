/**
 * PostgreSQL side of a project's connectors, through doors the API holds
 * EXECUTE on, the worker plane only the read of one.
 *
 * A ROW IS PARSED BY THE CONTRACT ON ITS WAY OUT, so a connector this store
 * answers is one its kind's settings schema admits, whatever the column holds.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  connectorChangesPageMax,
  connectorSchema,
  type Connector,
} from "../../contract/connectors.ts";

import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../interpreter/operationInbox.ts";
import type {
  ProjectConnectorChange,
  ProjectConnectorRemoveOutcome,
  ProjectConnectorStanding,
  ProjectConnectorStore,
  ProjectConnectorWriteOutcome,
} from "../../interpreter/projectConnectors.ts";

/** One connector as the read and list doors answer it. */
interface ProjectConnectorRow {
  readonly name: string | null;
  readonly kind: string | null;
  readonly settings: unknown;
  readonly revision: string | null;
}

function projectConnectorsRevision(value: string, door: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error(`${door}: revision ${value} is not a revision`);
  return revision;
}

function projectConnectorsConnector(
  name: string | null,
  kind: string | null,
  settings: unknown,
): Connector {
  return connectorSchema.parse({ name, kind, settings });
}

function projectConnectorsStanding(
  row: ProjectConnectorRow,
): ProjectConnectorStanding {
  if (row.revision === null)
    throw new Error("project connector: a connector is half a row");
  return {
    connector: projectConnectorsConnector(row.name, row.kind, row.settings),
    revision: projectConnectorsRevision(row.revision, "project connector"),
  };
}

/** What a write or a removal door answered. */
interface ProjectConnectorWrittenRow {
  readonly outcome: string | null;
  readonly connector_revision: string | null;
}

function projectConnectorsWritten(
  row: ProjectConnectorWrittenRow | undefined,
  door: string,
): ProjectConnectorWriteOutcome {
  if (row === undefined) throw new Error(`${door}: the door answered no row`);
  const revision =
    row.connector_revision === null
      ? undefined
      : projectConnectorsRevision(row.connector_revision, door);
  switch (row.outcome) {
    case "Created":
    case "Changed":
      if (revision === undefined)
        throw new Error(`${door}: ${row.outcome} names no revision`);
      return { outcome: row.outcome, revision };
    case "Stale":
      return revision === undefined
        ? { outcome: "Stale" }
        : { outcome: "Stale", standing: revision };
    case "LimitReached":
    case "ProjectAbsent":
      return { outcome: row.outcome };
    case null:
    default:
      throw new Error(`${door}: unknown outcome ${String(row.outcome)}`);
  }
}

function projectConnectorsRemoved(
  row: ProjectConnectorWrittenRow | undefined,
): ProjectConnectorRemoveOutcome {
  const door = "project connector removal";
  if (row === undefined) throw new Error(`${door}: the door answered no row`);
  const revision =
    row.connector_revision === null
      ? undefined
      : projectConnectorsRevision(row.connector_revision, door);
  if (row.outcome === "Removed" && revision !== undefined)
    return { outcome: "Removed", revision };
  if (row.outcome === "Stale")
    return revision === undefined
      ? { outcome: "Stale" }
      : { outcome: "Stale", standing: revision };
  throw new Error(`${door}: unexpected outcome ${String(row.outcome)}`);
}

/** One change as the history door answers it. */
interface ProjectConnectorChangeRow {
  readonly change: string | null;
  readonly changed_at: string | null;
  readonly authority_kind: string | null;
  readonly authority_subject: string | null;
  readonly name: string | null;
  readonly action: string | null;
  readonly kind: string | null;
  readonly settings: unknown;
}

function projectConnectorsChange(
  row: ProjectConnectorChangeRow,
): ProjectConnectorChange {
  const door = "project connector change";
  if (
    row.change === null ||
    row.changed_at === null ||
    row.authority_kind === null ||
    row.authority_subject === null ||
    row.name === null
  )
    throw new Error(`${door}: a change is half a row`);
  const recorded = {
    change: projectConnectorsRevision(row.change, door),
    changedAt: row.changed_at,
    authority: {
      kind: asAuthorityKind(row.authority_kind),
      subject: asAuthoritySubject(row.authority_subject),
    },
  };
  switch (row.action) {
    case "Created":
    case "Changed":
      return {
        ...recorded,
        action: row.action,
        connector: projectConnectorsConnector(row.name, row.kind, row.settings),
      };
    case "Removed":
      if (row.kind !== null || row.settings !== null)
        throw new Error(`${door}: a removal holds settings`);
      return { ...recorded, action: "Removed", name: row.name };
    case null:
    default:
      throw new Error(`${door}: unknown action ${String(row.action)}`);
  }
}

export function postgresProjectConnectors(
  pool: pg.Pool,
): ProjectConnectorStore {
  return {
    connector: async (partition, name) => {
      const found = await pool.query<ProjectConnectorRow>(
        sql`SELECT name,kind,settings,revision::text AS revision
              FROM read_project_connector(
                ${partition.tenant},${partition.project},${name})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : projectConnectorsStanding(row);
    },
    connectors: async (partition) => {
      const found = await pool.query<ProjectConnectorRow>(
        sql`SELECT name,kind,settings,revision::text AS revision
              FROM list_project_connectors(
                ${partition.tenant},${partition.project})`,
      );
      return found.rows.map(projectConnectorsStanding);
    },
    write: async (command) => {
      const found = await pool.query<ProjectConnectorWrittenRow>(
        sql`SELECT outcome,connector_revision::text AS connector_revision
              FROM write_project_connector(
                ${command.partition.tenant},${command.partition.project},
                ${command.connector.name},${command.connector.kind},
                ${JSON.stringify(command.connector.settings)}::jsonb,
                ${command.expectedRevision ?? null}::bigint,
                ${command.authority.kind},${command.authority.subject})`,
      );
      return projectConnectorsWritten(found.rows[0], "project connector write");
    },
    remove: async (command) => {
      const found = await pool.query<ProjectConnectorWrittenRow>(
        sql`SELECT outcome,connector_revision::text AS connector_revision
              FROM remove_project_connector(
                ${command.partition.tenant},${command.partition.project},
                ${command.name},${command.expectedRevision ?? null}::bigint,
                ${command.authority.kind},${command.authority.subject})`,
      );
      return projectConnectorsRemoved(found.rows[0]);
    },
    changes: async (partition, before) => {
      const found = await pool.query<ProjectConnectorChangeRow>(
        sql`SELECT change::text AS change,
                   to_char(changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS changed_at,
                   authority_kind,authority_subject,name,action,kind,settings
              FROM list_project_connector_changes(
                ${partition.tenant},${partition.project},
                ${before ?? null}::bigint,${connectorChangesPageMax})`,
      );
      return found.rows.map(projectConnectorsChange);
    },
  };
}
