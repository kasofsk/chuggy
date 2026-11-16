/**
 * A project keeps a default theme, and a person keeps a theme of their own for
 * one project, above it.
 *
 * THE PROJECT'S DEFAULT IS A DOCUMENT, NOT A REFERENCE, so it does not change
 * or vanish when the person who wrote it edits or deletes a theme of their own.
 * It is the project's own row and who set it, absent until an administrator
 * writes one, written as `project_owner_fallback` is: through one door that
 * answers `Unchanged` where nothing moved, a row naming no document being a
 * project that cleared it.
 *
 * A PERSON'S OVERRIDE NAMES A BUILT-IN OR A THEME OF THEIR OWN, never both, as
 * their global choice in `193` does, and the key it points at carries their
 * principal, so it cannot name another person's theme. Deleting the theme
 * deletes the override with it, which reads as none.
 *
 * BOTH GO WITH THEIR PROJECT. Each points at `project` and cascades from it, so
 * `delete_unrun_project` takes them with the project row.
 *
 * EVERY DOOR IS THE BOUNDARY OWNER'S, callable by the API and nobody else. The
 * API reads the project's row as it reads its fallback, and each override
 * through the door handed the one principal it serves.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectThemeOverrideReadFunction,
  projectThemeOverrideWriteFunction,
  projectThemeSetFunction,
  type Migration,
} from "../shared.ts";

const themeSet = `public.${projectThemeSetFunction}(in_tenant text, in_project text, in_document jsonb, in_authority_kind text, in_authority_subject text)`;

const overrideRead = `public.${projectThemeOverrideReadFunction}(in_tenant text, in_project text, in_principal text)`;

const overrideWrite = `public.${projectThemeOverrideWriteFunction}(in_tenant text, in_project text, in_principal text, in_built_in text, in_owned bigint)`;

/** The owner a door is installed under, and the API its only caller. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ];
}

export const migration194: Migration = {
  version: 194,
  name: "a project keeps a default theme, and a person a theme of their own for one project",
  statements: [
    `CREATE TABLE public.project_theme (
       tenant text NOT NULL,
       project text NOT NULL,
       document jsonb
         CONSTRAINT project_theme_document_is_a_bounded_object
         CHECK (document IS NULL OR (jsonb_typeof(document) = 'object'
                AND octet_length(document::text) <= 8192)),
       set_by_kind text NOT NULL
         CONSTRAINT project_theme_setter_kind_is_bounded
         CHECK (length(set_by_kind) BETWEEN 1 AND 256),
       set_by_subject text NOT NULL
         CONSTRAINT project_theme_setter_subject_is_bounded
         CHECK (length(set_by_subject) BETWEEN 1 AND 256),
       set_at timestamp with time zone NOT NULL,
       PRIMARY KEY (tenant,project),
       CONSTRAINT project_theme_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project)
         ON DELETE CASCADE)`,
    `CREATE TABLE public.project_theme_override (
       tenant text NOT NULL,
       project text NOT NULL,
       principal text NOT NULL
         CONSTRAINT project_theme_override_principal_is_bounded
         CHECK (length(principal) BETWEEN 1 AND 256),
       built_in text
         CONSTRAINT project_theme_override_built_in_is_known
         CHECK (built_in IN ('chuggy','harbour','ember','high-contrast')),
       owned bigint,
       PRIMARY KEY (tenant,project,principal),
       CONSTRAINT project_theme_override_names_one_theme
         CHECK (num_nonnulls(built_in, owned) = 1),
       CONSTRAINT project_theme_override_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project)
         ON DELETE CASCADE,
       CONSTRAINT project_theme_override_owned_is_its_principals
         FOREIGN KEY (principal, owned)
         REFERENCES public.owned_theme(principal, theme) ON DELETE CASCADE)`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.project_theme TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.project_theme TO ${apiRole}`,
    `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.project_theme_override TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${themeSet} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE standing jsonb;
       BEGIN
         PERFORM 1 FROM project p
          WHERE p.tenant=in_tenant AND p.project=in_project FOR KEY SHARE;
         IF NOT FOUND THEN RETURN 'NotFound'; END IF;
         SELECT t.document INTO standing FROM project_theme t
          WHERE t.tenant=in_tenant AND t.project=in_project FOR UPDATE;
         IF standing IS NOT DISTINCT FROM in_document THEN
           RETURN 'Unchanged';
         END IF;
         INSERT INTO project_theme
           (tenant,project,document,set_by_kind,set_by_subject,set_at)
           VALUES (in_tenant,in_project,in_document,
                   in_authority_kind,in_authority_subject,now())
           ON CONFLICT (tenant,project) DO UPDATE
             SET document=EXCLUDED.document,
                 set_by_kind=EXCLUDED.set_by_kind,
                 set_by_subject=EXCLUDED.set_by_subject,
                 set_at=EXCLUDED.set_at;
         RETURN 'Written';
       END
     $$`,
    ...owned(themeSet),
    `CREATE FUNCTION ${overrideRead}
       RETURNS TABLE(built_in text, owned bigint)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       SELECT o.built_in, o.owned FROM project_theme_override o
        WHERE o.tenant = in_tenant AND o.project = in_project
          AND o.principal = in_principal
     $$`,
    ...owned(overrideRead),
    `CREATE FUNCTION ${overrideWrite} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       BEGIN
         IF in_built_in IS NULL AND in_owned IS NULL THEN
           DELETE FROM project_theme_override
            WHERE tenant = in_tenant AND project = in_project
              AND principal = in_principal;
           RETURN 'Chosen';
         END IF;
         PERFORM FROM project p
           WHERE p.tenant = in_tenant AND p.project = in_project
           FOR KEY SHARE;
         IF NOT FOUND THEN RETURN 'NotFound'; END IF;
         IF in_owned IS NOT NULL THEN
           PERFORM FROM owned_theme
             WHERE principal = in_principal AND theme = in_owned
             FOR KEY SHARE;
           IF NOT FOUND THEN RETURN 'ThemeNotFound'; END IF;
         END IF;
         INSERT INTO project_theme_override(tenant, project, principal, built_in, owned)
           VALUES (in_tenant, in_project, in_principal, in_built_in, in_owned)
         ON CONFLICT (tenant, project, principal) DO UPDATE
           SET built_in = EXCLUDED.built_in, owned = EXCLUDED.owned;
         RETURN 'Chosen';
       END
     $$`,
    ...owned(overrideWrite),
  ],
};
