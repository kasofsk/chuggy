/**
 * PostgreSQL side of binding a repository to a project: the owner's door, and
 * the epoch a binding is made under, which is the one reader every other holder
 * of an epoch already asks.
 *
 * THE ABSENT PROJECT IS A RAISE AND IS READ AS ONE. The door refuses a binding
 * against a project it cannot find by raising, because an operator's identity
 * must stay unspent; the message it raises with is the only thing that tells
 * that refusal apart from a foreign key this door could violate some other way,
 * so both terms are matched and anything else is left to raise.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { projectRepositoriesAnsweredMax } from "../../contract/http.ts";

import { postgresOwnershipEpoch } from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";

import { asRepositoryId } from "../../interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import type { RepositoryBindingListing } from "../../interpreter/repositoryConfiguration.ts";
import {
  asRepositoryLanding,
  type ProjectRepositoryBindings,
  type ProjectRepositoryBound,
  type ProjectRepositoryLandingOutcome,
  type ProjectRepositoryLandingStore,
  type RepositoryBindingAdministration,
  type RepositoryBindingOutcome,
} from "../../interpreter/repositoryBinding.ts";

const allOutcomes: readonly RepositoryBindingOutcome[] = [
  "Bound",
  "AlreadyBound",
  "OperationConflict",
  "RecoveryEpochMismatch",
  "RepositoryBoundElsewhere",
];

/** What the door raises with when the project it was asked to bind into is not there. */
const projectAbsentCode = "23503";
const projectAbsentMessage = "repository binding project is absent";

function repositoryBindingProjectAbsent(failure: unknown): boolean {
  return (
    typeof failure === "object" &&
    failure !== null &&
    "code" in failure &&
    failure.code === projectAbsentCode &&
    "message" in failure &&
    failure.message === projectAbsentMessage
  );
}

/** One binding as every door that answers a whole one selects it. */
interface ProjectRepositoryBoundRow {
  readonly repository: string | null;
  readonly bound_at: string | null;
  readonly landing_mode: string | null;
}

function projectRepositoryBoundOf(
  row: ProjectRepositoryBoundRow,
): ProjectRepositoryBound {
  if (
    row.repository === null ||
    row.bound_at === null ||
    row.landing_mode === null
  )
    throw new Error("repository binding: a binding is half a row");
  return {
    repository: asRepositoryId(row.repository),
    boundAt: row.bound_at,
    landing: asRepositoryLanding(row.landing_mode),
  };
}

/**
 * Every repository one project binds, oldest first, through the door the API
 * holds EXECUTE on. It is a door rather than a table read because
 * `project_repository` is the finalizer's and the scheduler's relation, and a
 * SELECT grant on it would hand the API every project's bindings to answer one
 * project's question with.
 */
export function postgresProjectRepositoryBindings(
  pool: pg.Pool,
): ProjectRepositoryBindings {
  return {
    bindings: async (
      partition: Partition,
    ): Promise<readonly ProjectRepositoryBound[]> => {
      const found = await pool.query<ProjectRepositoryBoundRow>(
        sql`SELECT repository,bound_at::text AS bound_at,landing_mode
              FROM list_project_repository_bindings(
                ${partition.tenant},${partition.project},
                ${projectRepositoriesAnsweredMax})`,
      );
      return found.rows.map(projectRepositoryBoundOf);
    },
  };
}

/**
 * Every binding there is, through the door only the importer holds EXECUTE on.
 * It is a door for `list_project_repository_bindings`'s reason and crosses
 * partitions for the importer's: its caller imports for the whole estate, so
 * the partition is a column of the answer rather than an argument to the ask.
 */
export function postgresRepositoryBindingListing(
  pool: pg.Pool,
): RepositoryBindingListing {
  return {
    bindings: async (max: number) => {
      const found = await pool.query<{
        tenant: string | null;
        project: string | null;
        repository: string | null;
        bound_at: string | null;
      }>(
        sql`SELECT tenant,project,repository,bound_at::text AS bound_at
              FROM list_repository_bindings(${max})`,
      );
      return found.rows.map((row) => {
        if (
          row.tenant === null ||
          row.project === null ||
          row.repository === null ||
          row.bound_at === null
        )
          throw new Error("repository binding: a binding is half a row");
        return {
          partition: {
            tenant: asTenantId(row.tenant),
            project: asProjectId(row.project),
          },
          repository: asRepositoryId(row.repository),
          boundAt: row.bound_at,
        };
      });
    },
  };
}

export function postgresRepositoryBinding(
  pool: pg.Pool,
): RepositoryBindingAdministration {
  return {
    writer: async () => {
      const found = await pool.query<{
        writer_role: string | null;
        can_execute: boolean | null;
      }>(
        sql`SELECT current_user::text AS writer_role,
          has_function_privilege(current_user,
            'bind_project_repository(text,text,text,text,text,text,text)',
            'EXECUTE')::boolean AS can_execute`,
      );
      const row = found.rows[0];
      if (row?.writer_role === undefined || row.writer_role === null)
        throw new Error("repository binding: the server named no current role");
      return { role: row.writer_role, canExecute: row.can_execute === true };
    },
    currentRecoveryEpoch: () =>
      postgresTransaction(pool, postgresOwnershipEpoch),
    bind: async (command) => {
      let result: pg.QueryResult<{ outcome: string | null }>;
      try {
        result = await pool.query<{ outcome: string | null }>(
          sql`SELECT bind_project_repository(
            ${command.partition.tenant},${command.partition.project},
            ${command.repository},${command.recoveryEpoch},${command.operation},
            ${command.authority.kind},${command.authority.subject})::text AS outcome`,
        );
      } catch (failure) {
        if (repositoryBindingProjectAbsent(failure)) return "ProjectAbsent";
        throw failure;
      }
      const outcome = result.rows[0]?.outcome;
      if (
        outcome === null ||
        outcome === undefined ||
        !allOutcomes.includes(outcome as RepositoryBindingOutcome)
      )
        throw new Error(
          `repository binding: unknown outcome ${String(outcome)}`,
        );
      return outcome as RepositoryBindingOutcome;
    },
  };
}

/**
 * The SQLSTATEs a landing write did not complete under. `query_canceled` is
 * every cancellation a statement can meet, its deadline included, and
 * `deadlock_detected` is the cycle a server broke to let one write through;
 * both leave a write that can be made again.
 */
const landingIncompleteWriteCodes: readonly string[] = ["57014", "40P01"];

function repositoryLandingIncomplete(failure: unknown): boolean {
  if (typeof failure !== "object" || failure === null) return false;
  const code = (failure as { readonly code?: unknown }).code;
  return typeof code === "string" && landingIncompleteWriteCodes.includes(code);
}

/** The row a landing write answered with, whichever outcome it answered. */
interface ProjectRepositoryLandingRow extends ProjectRepositoryBoundRow {
  readonly outcome: string | null;
}

function postgresRepositoryLandingOutcome(
  row: ProjectRepositoryLandingRow | undefined,
): ProjectRepositoryLandingOutcome {
  if (row === undefined)
    throw new Error("repository landing: the door answered no row");
  if (row.outcome === "NotBound") return { outcome: "NotBound" };
  if (row.outcome !== "Written" && row.outcome !== "LandingMoved")
    throw new Error(
      `repository landing: unknown outcome ${String(row.outcome)}`,
    );
  return { outcome: row.outcome, binding: projectRepositoryBoundOf(row) };
}

/**
 * One binding's landing, read and moved through the two doors the API holds
 * EXECUTE on. The point read is a door of its own rather than a search of the
 * listing, because a project binding more repositories than the listing
 * answers would have the one asked about fall off the end of it.
 */
export function postgresProjectRepositoryLanding(
  pool: pg.Pool,
): ProjectRepositoryLandingStore {
  return {
    landing: async (partition, repository) => {
      const found = await pool.query<ProjectRepositoryBoundRow>(
        sql`SELECT repository,bound_at::text AS bound_at,landing_mode
              FROM read_project_repository_landing(
                ${partition.tenant},${partition.project},${repository})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : projectRepositoryBoundOf(row);
    },
    setLanding: async (command) => {
      let found: pg.QueryResult<ProjectRepositoryLandingRow>;
      try {
        found = await pool.query<ProjectRepositoryLandingRow>(
          sql`SELECT outcome,repository,bound_at::text AS bound_at,landing_mode
                FROM set_project_repository_landing(
                  ${command.partition.tenant},${command.partition.project},
                  ${command.repository},${command.expected.mode},
                  ${command.landing.mode})`,
        );
      } catch (failure) {
        if (repositoryLandingIncomplete(failure))
          return { outcome: "Unavailable" };
        throw failure;
      }
      return postgresRepositoryLandingOutcome(found.rows[0]);
    },
  };
}
