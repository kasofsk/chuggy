import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  RepositoryActivationAdministration,
  RepositoryActivationOutcome,
} from "../../interpreter/repositoryActivation.ts";

const allOutcomes: readonly RepositoryActivationOutcome[] = [
  "Activated",
  "AlreadyActivated",
  "OperationConflict",
  "ExpectedRepositoryMismatch",
  "RecoveryEpochMismatch",
  "RepositoryBoundElsewhere",
];

export function postgresRepositoryActivation(
  pool: pg.Pool,
): RepositoryActivationAdministration {
  return {
    writer: async () => {
      const found = await pool.query<{
        writer_role: string | null;
        can_execute: boolean | null;
      }>(
        sql`SELECT current_user::text AS writer_role,
          has_function_privilege(current_user,
            'activate_project_repository(text,text,text,text,text,text,text,text)',
            'EXECUTE')::boolean AS can_execute`,
      );
      const row = found.rows[0];
      if (row?.writer_role === undefined || row.writer_role === null)
        throw new Error(
          "repository activation: the server named no current role",
        );
      return { role: row.writer_role, canExecute: row.can_execute === true };
    },
    activate: async (activation) => {
      const result = await pool.query<{ outcome: string | null }>(
        sql`SELECT activate_project_repository(
          ${activation.partition.tenant},${activation.partition.project},
          ${activation.expectedRepository},${activation.repository},
          ${activation.recoveryEpoch},${activation.operation},
          ${activation.authority.kind},${activation.authority.subject})::text AS outcome`,
      );
      const outcome = result.rows[0]?.outcome;
      if (
        outcome === null ||
        outcome === undefined ||
        !allOutcomes.includes(outcome as RepositoryActivationOutcome)
      )
        throw new Error(
          `repository activation: unknown outcome ${String(outcome)}`,
        );
      return outcome as RepositoryActivationOutcome;
    },
  };
}
