import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { ProjectAccess } from "../../interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../interpreter/operationInbox.ts";
import { projectAuthorizationFunction } from "./schema.ts";

interface ProjectAuthorityRow {
  readonly authority_kind: string | null;
  readonly authority_subject: string | null;
}

export function postgresProjectAccess(pool: pg.Pool): ProjectAccess {
  return {
    authorize: async (principal, partition, access) => {
      const found = await pool.query<ProjectAuthorityRow>(
        sql`SELECT authority_kind,authority_subject
              FROM authorize_project_access(
                ${principal},${partition.tenant},${partition.project},${access})`,
      );
      const row = found.rows[0];
      if (row === undefined) return undefined;
      if (found.rows.length !== 1)
        throw new Error(
          `${projectAuthorizationFunction}: one membership resolved more than once`,
        );
      if (row.authority_kind === null || row.authority_subject === null)
        throw new Error(
          `${projectAuthorizationFunction}: a membership resolved no authority`,
        );
      return {
        kind: asAuthorityKind(row.authority_kind),
        subject: asAuthoritySubject(row.authority_subject),
      };
    },
  };
}
