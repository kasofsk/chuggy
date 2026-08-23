/**
 * The membership rows behind `authorize_project_access`, written as one
 * statement each.
 *
 * A GRANT REPLACES RATHER THAN ADDS. Re-running one has to be the same as
 * running it once, and the row's key is the principal and the project, so the
 * conflicting row is overwritten with exactly the access asked for. Adding to
 * it instead would make a narrowed grant unreachable — an administrator could
 * only ever widen, and revoking wholesale would be the one way back.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  ProjectMembership,
  ProjectMembershipAdministration,
} from "../../interpreter/projectMembership.ts";

export function postgresProjectMembership(
  pool: pg.Pool,
): ProjectMembershipAdministration {
  return {
    grant: async (membership: ProjectMembership) => {
      await pool.query(
        sql`INSERT INTO project_membership
              (principal,tenant,project,authority_kind,authority_subject,
               may_read,may_mutate,may_dispatch,may_propose)
            VALUES (${membership.principal},${membership.partition.tenant},
                    ${membership.partition.project},${membership.authority.kind},
                    ${membership.authority.subject},
                    ${membership.access.has("Read")},
                    ${membership.access.has("Mutate")},
                    ${membership.access.has("DispatchTicket")},
                    ${membership.access.has("ProposeDispatch")})
            ON CONFLICT (principal,tenant,project) DO UPDATE
              SET authority_kind=EXCLUDED.authority_kind,
                  authority_subject=EXCLUDED.authority_subject,
                  may_read=EXCLUDED.may_read,
                  may_mutate=EXCLUDED.may_mutate,
                  may_dispatch=EXCLUDED.may_dispatch,
                  may_propose=EXCLUDED.may_propose`,
      );
    },

    revoke: async (target) => {
      const removed = await pool.query<{ principal: string }>(
        sql`DELETE FROM project_membership
             WHERE principal=${target.principal}
               AND tenant=${target.partition.tenant}
               AND project=${target.partition.project}
         RETURNING principal`,
      );
      return removed.rows.length > 0;
    },
  };
}
