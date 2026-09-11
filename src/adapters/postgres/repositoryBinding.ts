/**
 * PostgreSQL side of binding a repository to a project: the owner's door, and
 * the epoch a binding is made under.
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

import { asRepositoryId } from "../../interpreter/finalizer.ts";
import { asRecoveryEpoch } from "../../interpreter/projectStore.ts";
import type {
  Partition,
  RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import type {
  ProjectRepositoryBindings,
  ProjectRepositoryBound,
  RepositoryBindingAdministration,
  RepositoryBindingOutcome,
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

/** The latest epoch, a database that has never had one being a failure rather than a refusal. */
async function currentRecoveryEpoch(pool: pg.Pool): Promise<RecoveryEpoch> {
  const found = await pool.query<{ epoch: string }>(
    sql`SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1`,
  );
  const latest = found.rows[0];
  if (latest === undefined)
    throw new Error(
      "repository binding: this database has no recovery epoch, so nothing can be bound under one",
    );
  return asRecoveryEpoch(latest.epoch);
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
      const found = await pool.query<{
        repository: string | null;
        bound_at: string | null;
      }>(
        sql`SELECT repository,bound_at::text AS bound_at
              FROM list_project_repository_bindings(
                ${partition.tenant},${partition.project},
                ${projectRepositoriesAnsweredMax})`,
      );
      return found.rows.map((row) => {
        if (row.repository === null || row.bound_at === null)
          throw new Error("repository binding: a binding is half a row");
        return {
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
    currentRecoveryEpoch: () => currentRecoveryEpoch(pool),
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
