import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
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
    bind: async (command) => {
      const result = await pool.query<{ outcome: string | null }>(
        sql`SELECT bind_project_repository(
          ${command.partition.tenant},${command.partition.project},
          ${command.repository},${command.recoveryEpoch},${command.operation},
          ${command.authority.kind},${command.authority.subject})::text AS outcome`,
      );
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
