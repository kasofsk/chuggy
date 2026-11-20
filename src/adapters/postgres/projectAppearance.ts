/**
 * PostgreSQL side of a project's appearance: the project's own default theme,
 * read by the API and written through the door it is granted, and each
 * person's override for the project, through the doors handed the one
 * principal they serve.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  builtInThemeIds,
  themeDocumentSchema,
  themeNumberSchema,
  type ThemeChoice,
} from "../../contract/appearance.ts";
import type {
  ProjectThemeOverrideChosen,
  ProjectThemeStore,
} from "../../interpreter/projectAppearance.ts";
import { placementWriteOutcome } from "./executionPlacement.ts";

interface ProjectThemeOverrideRow {
  readonly built_in: string | null;
  readonly owned: string | null;
}

function projectAppearanceOverride(
  row: ProjectThemeOverrideRow | undefined,
): ThemeChoice | undefined {
  if (row === undefined) return undefined;
  if (row.owned !== null)
    return { kind: "Owned", theme: themeNumberSchema.parse(Number(row.owned)) };
  const builtIn = builtInThemeIds.find((id) => id === row.built_in);
  if (builtIn === undefined)
    throw new Error("project appearance: unknown built-in");
  return { kind: "BuiltIn", theme: builtIn };
}

const projectAppearanceChosen: readonly ProjectThemeOverrideChosen[] = [
  "Chosen",
  "ThemeNotFound",
  "NotFound",
];

function projectAppearanceChosenOutcome(
  outcome: string | null | undefined,
): ProjectThemeOverrideChosen {
  const known = projectAppearanceChosen.find((named) => named === outcome);
  if (known === undefined)
    throw new Error(`project appearance: ${String(outcome)} is no outcome`);
  return known;
}

/** The API's read of one project's default theme and each person's override, and the doors it writes them through. */
export function postgresProjectAppearance(pool: pg.Pool): ProjectThemeStore {
  return {
    projectTheme: async (partition) => {
      const found = await pool.query<{ document: unknown }>(
        sql`SELECT document FROM project_theme
             WHERE tenant=${partition.tenant} AND project=${partition.project}`,
      );
      const document = found.rows[0]?.document ?? null;
      return document === null
        ? undefined
        : themeDocumentSchema.parse(document);
    },
    writeProjectTheme: async (partition, document, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_project_theme(
              ${partition.tenant},${partition.project},
              ${document === undefined ? null : JSON.stringify(document)}::jsonb,
              ${authority.kind},${authority.subject})::text AS outcome`,
      );
      return placementWriteOutcome(found.rows[0]?.outcome);
    },
    override: async (partition, principal) => {
      const found = await pool.query<ProjectThemeOverrideRow>(
        sql`SELECT o.built_in,o.owned::text AS owned
              FROM read_project_theme_override(
                ${partition.tenant},${partition.project},${principal}) o`,
      );
      return projectAppearanceOverride(found.rows[0]);
    },
    writeOverride: async (partition, principal, choice) => {
      const builtIn = choice?.kind === "BuiltIn" ? choice.theme : null;
      const owned = choice?.kind === "Owned" ? choice.theme : null;
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT write_project_theme_override(
              ${partition.tenant},${partition.project},${principal},
              ${builtIn}::text,${owned}::bigint)::text AS outcome`,
      );
      return projectAppearanceChosenOutcome(found.rows[0]?.outcome);
    },
  };
}
