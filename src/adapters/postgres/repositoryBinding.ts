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
import type {
  ReadOnlyRepositoriesPort,
  ReadOnlyRepositoriesRead,
} from "../../interpreter/taskBriefing.ts";
import {
  asRepositoryLanding,
  type ProjectRepositoryBindings,
  type ProjectRepositoryBound,
  type ProjectRepositoryLandingOutcome,
  type ProjectRepositoryLandingStore,
  type ProjectRepositoryRetirementOutcome,
  type ProjectRepositoryRetirementStore,
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

/**
 * One binding as every door that answers a whole one selects it. `retired_at`
 * is null on a live binding, which is the one column here whose absence says
 * something rather than being a half-read row.
 */
interface ProjectRepositoryBoundRow {
  readonly repository: string | null;
  readonly bound_at: string | null;
  readonly landing_mode: string | null;
  readonly pipelines_writable: boolean | null;
  readonly retired_at: string | null;
}

function projectRepositoryBoundOf(
  row: ProjectRepositoryBoundRow,
): ProjectRepositoryBound {
  if (
    row.repository === null ||
    row.bound_at === null ||
    row.landing_mode === null ||
    row.pipelines_writable === null
  )
    throw new Error("repository binding: a binding is half a row");
  return {
    repository: asRepositoryId(row.repository),
    boundAt: row.bound_at,
    landing: asRepositoryLanding(row.landing_mode),
    pipelinesWritable: row.pipelines_writable,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
  };
}

/**
 * Every repository one project binds, oldest first, through the door the API
 * and the scheduler hold EXECUTE on. It is a door rather than a table read
 * because `project_repository` is the finalizer's and the scheduler's relation,
 * and a SELECT grant on it would hand the API every project's bindings to
 * answer one project's question with.
 */
export function postgresProjectRepositoryBindings(
  pool: pg.Pool,
): ProjectRepositoryBindings {
  return {
    bindings: async (
      partition: Partition,
    ): Promise<readonly ProjectRepositoryBound[]> => {
      const found = await pool.query<ProjectRepositoryBoundRow>(
        sql`SELECT repository,to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS bound_at,landing_mode,
                   pipelines_writable,to_char(retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS retired_at
              FROM list_project_repository_bindings(
                ${partition.tenant},${partition.project},
                ${projectRepositoriesAnsweredMax})`,
      );
      return found.rows.map(projectRepositoryBoundOf);
    },
  };
}

/**
 * The repositories one execution's project binds live beside the one its own
 * input bundle pins, oldest first, through the same per-project door, which the
 * scheduler holds for this read alone. A failed read is `Unavailable` rather
 * than a throw, because the scheduler holds an attempt it could not brief
 * instead of losing its loop.
 */
export function postgresReadOnlyRepositories(
  pool: pg.Pool,
): ReadOnlyRepositoriesPort {
  return {
    repositories: async (
      partition,
      execution,
    ): Promise<ReadOnlyRepositoriesRead> => {
      let found: pg.QueryResult<{ repository: string | null }>;
      try {
        found = await pool.query<{ repository: string | null }>(
          sql`SELECT l.repository
                FROM list_project_repository_bindings(
                  ${partition.tenant},${partition.project},
                  ${projectRepositoriesAnsweredMax}) l
               WHERE l.retired_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1
                     FROM execution e
                     JOIN execution_request q
                       ON q.tenant=e.tenant AND q.project=e.project
                      AND q.request=e.source_request
                     JOIN input_bundle_reference b
                       ON b.tenant=q.tenant AND b.project=q.project
                      AND b.bundle=q.input_bundle AND b.reference_kind='Repository'
                    WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
                      AND e.execution=${execution}
                      AND b.reference_id=l.repository)
               ORDER BY l.bound_at,l.repository`,
        );
      } catch {
        return { read: "Unavailable" };
      }
      return {
        read: "Repositories",
        repositories: found.rows.map((row) => {
          if (row.repository === null)
            throw new Error(
              "repository binding: a binding names no repository",
            );
          return asRepositoryId(row.repository);
        }),
      };
    },
  };
}

/**
 * Every LIVE binding there is, through the door only the importer holds
 * EXECUTE on: a retired one names a remote the estate has moved on from, and
 * an import that kept asking it would fail every run.
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
        sql`SELECT tenant,project,repository,to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS bound_at
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
 * The SQLSTATEs a write against one binding did not complete under.
 * `query_canceled` is every cancellation a statement can meet, its deadline
 * included, and `deadlock_detected` is the cycle a server broke to let one
 * write through; both leave a write that can be made again.
 */
const bindingIncompleteWriteCodes: readonly string[] = ["57014", "40P01"];

function repositoryBindingWriteIncomplete(failure: unknown): boolean {
  if (typeof failure !== "object" || failure === null) return false;
  const code = (failure as { readonly code?: unknown }).code;
  return typeof code === "string" && bindingIncompleteWriteCodes.includes(code);
}

/** The row a write against one binding answered with, whichever outcome it answered. */
interface ProjectRepositoryWrittenRow extends ProjectRepositoryBoundRow {
  readonly outcome: string | null;
}

function postgresRepositoryLandingOutcome(
  row: ProjectRepositoryWrittenRow | undefined,
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
 * One binding's settings, read through a door the API, the worker plane and
 * the finalizer hold EXECUTE on and written through one only the API holds.
 * The point read is a door of its own rather than a search of the listing,
 * because a project binding more repositories than the listing answers would
 * have the one asked about fall off the end of it.
 */
export function postgresProjectRepositoryLanding(
  pool: pg.Pool,
): ProjectRepositoryLandingStore {
  return {
    landing: async (partition, repository) => {
      const found = await pool.query<ProjectRepositoryBoundRow>(
        sql`SELECT repository,to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS bound_at,landing_mode,
                   pipelines_writable,to_char(retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS retired_at
              FROM read_project_repository_landing(
                ${partition.tenant},${partition.project},${repository})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : projectRepositoryBoundOf(row);
    },
    setLanding: async (command) => {
      let found: pg.QueryResult<ProjectRepositoryWrittenRow>;
      try {
        found = await pool.query<ProjectRepositoryWrittenRow>(
          sql`SELECT outcome,repository,to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS bound_at,landing_mode,
                     pipelines_writable,to_char(retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS retired_at
                FROM set_project_repository_landing(
                  ${command.partition.tenant},${command.partition.project},
                  ${command.repository},${command.expected.mode},
                  ${command.landing.mode},
                  ${command.pipelinesWritable.expected},
                  ${command.pipelinesWritable.wanted})`,
        );
      } catch (failure) {
        if (repositoryBindingWriteIncomplete(failure))
          return { outcome: "Unavailable" };
        throw failure;
      }
      return postgresRepositoryLandingOutcome(found.rows[0]);
    },
  };
}

function postgresRepositoryRetirementOutcome(
  row: ProjectRepositoryWrittenRow | undefined,
): ProjectRepositoryRetirementOutcome {
  if (row === undefined)
    throw new Error("repository retirement: the door answered no row");
  if (row.outcome === "NotBound") return { outcome: "NotBound" };
  if (row.outcome !== "Retired")
    throw new Error(
      `repository retirement: unknown outcome ${String(row.outcome)}`,
    );
  return { outcome: row.outcome, binding: projectRepositoryBoundOf(row) };
}

/**
 * One binding retired through the door the API holds EXECUTE on. It takes the
 * same row lock and answers the same incompleteness as the landing write, for
 * the same reason: the caller's next act is to read the binding again, and a
 * write cancelled under its lock is one that can be made again.
 */
export function postgresProjectRepositoryRetirement(
  pool: pg.Pool,
): ProjectRepositoryRetirementStore {
  return {
    retire: async (command) => {
      let found: pg.QueryResult<ProjectRepositoryWrittenRow>;
      try {
        found = await pool.query<ProjectRepositoryWrittenRow>(
          sql`SELECT outcome,repository,to_char(bound_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS bound_at,landing_mode,
                     pipelines_writable,to_char(retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS retired_at
                FROM retire_project_repository(
                  ${command.partition.tenant},${command.partition.project},
                  ${command.repository})`,
        );
      } catch (failure) {
        if (repositoryBindingWriteIncomplete(failure))
          return { outcome: "Unavailable" };
        throw failure;
      }
      return postgresRepositoryRetirementOutcome(found.rows[0]);
    },
  };
}
