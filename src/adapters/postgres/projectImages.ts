/**
 * PostgreSQL side of a project's icon and banner: the artifact each role
 * names, read by the API and written through the door it is granted.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  projectImageRoles,
  type ProjectImageRole,
} from "../../contract/http.ts";
import {
  asProjectArtifactId,
  type ProjectArtifactId,
} from "../../interpreter/finalizerPreparation.ts";
import type { ProjectImageStore } from "../../interpreter/projectImages.ts";
import { placementWriteOutcome } from "./executionPlacement.ts";

/** The API's read of one project's images and the door it names them through. */
export function postgresProjectImages(pool: pg.Pool): ProjectImageStore {
  return {
    images: async (partition) => {
      const found = await pool.query<{ role: string; artifact: string | null }>(
        sql`SELECT role,artifact FROM project_image
             WHERE tenant=${partition.tenant} AND project=${partition.project}`,
      );
      const images: {
        -readonly [Role in ProjectImageRole]?: ProjectArtifactId;
      } = {};
      for (const row of found.rows) {
        const role = projectImageRoles.find((known) => known === row.role);
        if (role === undefined)
          throw new Error(`project images: ${row.role} is no role`);
        if (row.artifact !== null)
          images[role] = asProjectArtifactId(row.artifact);
      }
      return images;
    },
    writeImage: async (partition, role, artifact, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_project_image(
              ${partition.tenant},${partition.project},${role},
              ${artifact ?? null},
              ${authority.kind},${authority.subject})::text AS outcome`,
      );
      return placementWriteOutcome(found.rows[0]?.outcome);
    },
  };
}
