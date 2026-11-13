/**
 * A person keeps themes of their own and one global choice of theme, each
 * keyed by their principal alone, so it follows them into every workspace.
 *
 * A THEME'S NUMBER IS NEVER GIVEN TWICE, to the same person or another, so a
 * number read once names that theme or nothing. A creation takes a lock on the
 * person's principal and counts what they hold, so two racing past the bound
 * keep one.
 *
 * A CHOICE NAMES A BUILT-IN OR A THEME OF ITS OWN PERSON'S, never both, and the
 * key it points at carries the principal, so it cannot name another person's
 * theme. Deleting the theme deletes the choice with it, which reads as none.
 *
 * EVERY DOOR IS HANDED ONE PRINCIPAL AND READS OR WRITES THAT PERSON ALONE. Each
 * is the boundary owner's, callable by the API and nobody else, and neither
 * relation is granted to a runtime role.
 */

import {
  apiRole,
  boundaryOwnerRole,
  ownedThemeCreateFunction,
  ownedThemeDeleteFunction,
  ownedThemesFunction,
  ownedThemeWriteFunction,
  themeChoiceReadFunction,
  themeChoiceWriteFunction,
  type Migration,
} from "../shared.ts";

const themes = `public.${ownedThemesFunction}(in_principal text)`;

const create = `public.${ownedThemeCreateFunction}(in_principal text, in_document jsonb, in_themes_max bigint)`;

const write = `public.${ownedThemeWriteFunction}(in_principal text, in_theme bigint, in_document jsonb)`;

const remove = `public.${ownedThemeDeleteFunction}(in_principal text, in_theme bigint)`;

const choice = `public.${themeChoiceReadFunction}(in_principal text)`;

const choose = `public.${themeChoiceWriteFunction}(in_principal text, in_built_in text, in_owned bigint)`;

/** The owner a door is installed under, and the API its only caller. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ];
}

export const migration167: Migration = {
  version: 167,
  name: "a person keeps themes of their own and one global choice of theme",
  statements: [
    `CREATE TABLE public.owned_theme (
       theme bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       principal text NOT NULL
         CONSTRAINT owned_theme_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       document jsonb NOT NULL
         CONSTRAINT owned_theme_document_is_a_bounded_object
         CHECK (jsonb_typeof(document) = 'object'
                AND octet_length(document::text) <= 8192),
       CONSTRAINT owned_theme_is_its_principals UNIQUE (principal, theme))`,
    `CREATE TABLE public.theme_choice (
       principal text PRIMARY KEY
         CONSTRAINT theme_choice_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       built_in text
         CONSTRAINT theme_choice_built_in_is_known
         CHECK (built_in IN ('chuggy','harbour','ember','high-contrast')),
       owned bigint,
       CONSTRAINT theme_choice_names_one_theme
         CHECK (num_nonnulls(built_in, owned) = 1),
       CONSTRAINT theme_choice_owned_is_its_principals
         FOREIGN KEY (principal, owned)
         REFERENCES public.owned_theme(principal, theme) ON DELETE CASCADE)`,
    `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.owned_theme TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.theme_choice TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${themes}
       RETURNS TABLE(theme bigint, document jsonb)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT t.theme, t.document FROM owned_theme t
        WHERE t.principal = in_principal
        ORDER BY t.theme
     $$`,
    ...owned(themes),
    `CREATE FUNCTION ${create} RETURNS bigint
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE created bigint;
       BEGIN
         PERFORM pg_advisory_xact_lock(hashtextextended('owned-theme:' || in_principal, 0));
         IF (SELECT count(*) FROM owned_theme WHERE principal = in_principal) >= in_themes_max
         THEN RETURN NULL;
         END IF;
         INSERT INTO owned_theme(principal, document) VALUES (in_principal, in_document)
           RETURNING theme INTO created;
         RETURN created;
       END
     $$`,
    ...owned(create),
    `CREATE FUNCTION ${write} RETURNS boolean
       LANGUAGE sql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH written AS (
         UPDATE owned_theme SET document = in_document
          WHERE principal = in_principal AND theme = in_theme
         RETURNING 1)
       SELECT EXISTS (SELECT FROM written)
     $$`,
    ...owned(write),
    `CREATE FUNCTION ${remove} RETURNS boolean
       LANGUAGE sql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH deleted AS (
         DELETE FROM owned_theme
          WHERE principal = in_principal AND theme = in_theme
         RETURNING 1)
       SELECT EXISTS (SELECT FROM deleted)
     $$`,
    ...owned(remove),
    `CREATE FUNCTION ${choice}
       RETURNS TABLE(built_in text, owned bigint)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT c.built_in, c.owned FROM theme_choice c
        WHERE c.principal = in_principal
     $$`,
    ...owned(choice),
    `CREATE FUNCTION ${choose} RETURNS boolean
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       BEGIN
         IF in_built_in IS NULL AND in_owned IS NULL THEN
           DELETE FROM theme_choice WHERE principal = in_principal;
           RETURN true;
         END IF;
         IF in_owned IS NOT NULL THEN
           PERFORM FROM owned_theme
             WHERE principal = in_principal AND theme = in_owned
             FOR KEY SHARE;
           IF NOT FOUND THEN RETURN false; END IF;
         END IF;
         INSERT INTO theme_choice(principal, built_in, owned)
           VALUES (in_principal, in_built_in, in_owned)
         ON CONFLICT (principal) DO UPDATE
           SET built_in = EXCLUDED.built_in, owned = EXCLUDED.owned;
         RETURN true;
       END
     $$`,
    ...owned(choose),
  ],
};
