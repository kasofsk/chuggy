/**
 * The membership rows behind `authorize_project_access`, written as one
 * statement each.
 *
 * A GRANT REPLACES RATHER THAN ADDS. Re-running one has to be the same as
 * running it once, and the row's key is the principal and the project, so the
 * conflicting row is overwritten with exactly the access asked for. Adding to
 * it instead would make a narrowed grant unreachable — an administrator could
 * only ever widen, and revoking wholesale would be the one way back.
 *
 * EACH PRIVILEGE IS ASKED FOR SEPARATELY. `has_table_privilege` given a
 * comma-separated list answers whether ANY of them is held, so one call naming
 * all three passes a role holding only `DELETE` — which then reaches the
 * refusal the caller's own message exists to replace.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  ProjectMembership,
  ProjectMembershipAdministration,
  ProjectMembershipWriter,
} from "../../interpreter/projectMembership.ts";

/** Every privilege any action can need, which is what one row is answered for. */
const postgresProjectMembershipPrivileges = ["INSERT", "UPDATE", "DELETE"];

export function postgresProjectMembership(
  pool: pg.Pool,
): ProjectMembershipAdministration {
  return {
    writer: async (): Promise<ProjectMembershipWriter> => {
      const found = await pool.query<{
        writer_role: string | null;
        privilege: string | null;
        holds: boolean | null;
      }>(
        sql`SELECT current_user::text AS writer_role, privilege,
                   has_table_privilege(current_user,'project_membership',privilege)::boolean
                     AS holds
              FROM unnest(${postgresProjectMembershipPrivileges}::text[]) AS privilege`,
      );
      const role = found.rows[0]?.writer_role;
      if (role === undefined || role === null)
        throw new Error("project membership: the server named no current role");
      return {
        role,
        privileges: new Set(
          found.rows
            .filter((row) => row.holds === true && row.privilege !== null)
            .map((row) => String(row.privilege)),
        ),
      };
    },

    grant: async (membership: ProjectMembership) => {
      await pool.query(
        sql`INSERT INTO project_membership
              (principal,tenant,project,authority_kind,authority_subject,
               may_read,may_mutate,may_dispatch,may_propose,may_manage_project_selector)
            VALUES (${membership.principal},${membership.partition.tenant},
                    ${membership.partition.project},${membership.authority.kind},
                    ${membership.authority.subject},
                    ${membership.access.has("Read")},
                    ${membership.access.has("Mutate")},
                    ${membership.access.has("DispatchTicket")},
                    ${membership.access.has("ProposeDispatch")},
                    ${membership.access.has("ManageProjectSelector")})
            ON CONFLICT (principal,tenant,project) DO UPDATE
              SET authority_kind=EXCLUDED.authority_kind,
                  authority_subject=EXCLUDED.authority_subject,
                  may_read=EXCLUDED.may_read,
                  may_mutate=EXCLUDED.may_mutate,
                  may_dispatch=EXCLUDED.may_dispatch,
                  may_propose=EXCLUDED.may_propose,
                  may_manage_project_selector=EXCLUDED.may_manage_project_selector`,
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
