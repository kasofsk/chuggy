/**
 * PostgreSQL side of a person's own appearance: the doors their themes and
 * their global choice are read and written through, each granted to the API
 * and handed the one principal it serves.
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
  AppearanceStore,
  OwnedTheme,
} from "../../interpreter/appearance.ts";

interface OwnedThemeRow {
  readonly theme: string | null;
  readonly document: unknown;
}

interface ThemeChoiceRow {
  readonly built_in: string | null;
  readonly owned: string | null;
}

function appearanceNumber(value: string | null): number {
  return themeNumberSchema.parse(Number(value));
}

function appearanceTheme(row: OwnedThemeRow): OwnedTheme {
  return {
    theme: appearanceNumber(row.theme),
    document: themeDocumentSchema.parse(row.document),
  };
}

function appearanceChoice(
  row: ThemeChoiceRow | undefined,
): ThemeChoice | undefined {
  if (row === undefined) return undefined;
  if (row.owned !== null)
    return { kind: "Owned", theme: appearanceNumber(row.owned) };
  const builtIn = builtInThemeIds.find((id) => id === row.built_in);
  if (builtIn === undefined) throw new Error("appearance: unknown built-in");
  return { kind: "BuiltIn", theme: builtIn };
}

/** The API's doors to one person's own themes and their global choice. */
export function postgresAppearance(pool: pg.Pool): AppearanceStore {
  return {
    themes: async (principal) => {
      const found = await pool.query<OwnedThemeRow>(
        sql`SELECT t.theme::text AS theme,t.document FROM owned_themes(${principal}) t`,
      );
      return found.rows.map(appearanceTheme);
    },
    theme: async (principal, theme) => {
      const found = await pool.query<OwnedThemeRow>(
        sql`SELECT t.theme::text AS theme,t.document FROM owned_themes(${principal}) t
             WHERE t.theme=${theme}::bigint`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : appearanceTheme(row);
    },
    create: async (principal, document, themesMax) => {
      const found = await pool.query<{ theme: string | null }>(
        sql`SELECT create_owned_theme(${principal},${JSON.stringify(document)}::jsonb,
              ${themesMax}::bigint)::text AS theme`,
      );
      const theme = found.rows[0]?.theme ?? null;
      return theme === null ? undefined : appearanceNumber(theme);
    },
    write: async (principal, theme, document) => {
      const found = await pool.query<{ written: boolean | null }>(
        sql`SELECT write_owned_theme(${principal},${theme}::bigint,
              ${JSON.stringify(document)}::jsonb) AS written`,
      );
      return found.rows[0]?.written === true;
    },
    delete: async (principal, theme) => {
      const found = await pool.query<{ deleted: boolean | null }>(
        sql`SELECT delete_owned_theme(${principal},${theme}::bigint) AS deleted`,
      );
      return found.rows[0]?.deleted === true;
    },
    choice: async (principal) => {
      const found = await pool.query<ThemeChoiceRow>(
        sql`SELECT c.built_in,c.owned::text AS owned FROM read_theme_choice(${principal}) c`,
      );
      return appearanceChoice(found.rows[0]);
    },
    choose: async (principal, choice) => {
      const builtIn = choice?.kind === "BuiltIn" ? choice.theme : null;
      const owned = choice?.kind === "Owned" ? choice.theme : null;
      const found = await pool.query<{ chosen: boolean | null }>(
        sql`SELECT write_theme_choice(${principal},${builtIn}::text,
              ${owned}::bigint) AS chosen`,
      );
      return found.rows[0]?.chosen === true;
    },
  };
}
