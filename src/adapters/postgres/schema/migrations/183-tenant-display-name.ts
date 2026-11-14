/**
 * A tenant has a display name, which its administrators change through the
 * access plane, and which every tenant already standing starts as its name.
 *
 * A ROW INSERTED NAMING NONE IS GIVEN ITS NAME, by a trigger rather than by
 * each door that inserts one, so `create_project` is unchanged and no tenant
 * row is ever without one.
 *
 * A DISPLAY NAME IS THE TENANT'S NAME OR WITHIN THE CONTRACT'S BOUND. A name
 * is bounded more tightly than a tenant's, so the bound holds of a name it was
 * given and not of the one it starts as.
 *
 * THE DISPLAY NAME IS THE ONE COLUMN A TENANT CHANGES. The trigger that holds
 * a tenant immutable lets an update through where nothing else on the row
 * moved, and its deletion rule, and every other table it guards, are 174's.
 *
 * THE ACCESS PLANE WRITES IT, inserting the row where a tenant it made has
 * none yet, as one whose first project has not come does not. That row takes
 * the name here as well, as the authority's tuples already had.
 */

import { accessPlaneRole, type Migration } from "../shared.ts";

/** What this migration renders `displayNameCharsMax` as, in the row's bound. */
export const tenantDisplayNameCharsMaxAt183 = 64;

const projectDeleting = `EXISTS(SELECT 1 FROM public.project p
                 WHERE p.tenant=OLD.tenant AND p.project=OLD.project
                   AND p.lifecycle='Deleting')`;

export const migration183: Migration = {
  version: 183,
  name: "a tenant has a display name its administrators change",
  statements: [
    `ALTER TABLE public.tenant ADD COLUMN display_name text`,
    `CREATE FUNCTION public.tenant_display_name_given() RETURNS trigger
       LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$ BEGIN
         NEW.display_name := coalesce(NEW.display_name, NEW.tenant);
         RETURN NEW; END $$`,
    `CREATE TRIGGER tenant_display_name_given BEFORE INSERT ON public.tenant
       FOR EACH ROW EXECUTE FUNCTION public.tenant_display_name_given()`,
    `CREATE OR REPLACE FUNCTION public.project_creation_is_immutable() RETURNS trigger
       LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
       AS $$ BEGIN
         IF TG_OP='UPDATE' AND TG_TABLE_NAME='tenant'
            AND to_jsonb(NEW)-'display_name' = to_jsonb(OLD)-'display_name' THEN
           RETURN NEW;
         END IF;
         IF TG_OP='DELETE' THEN
           IF TG_TABLE_NAME='tenant' THEN
             IF NOT EXISTS(SELECT 1 FROM public.project p WHERE p.tenant=OLD.tenant) THEN
               RETURN OLD;
             END IF;
           ELSIF TG_TABLE_NAME='project_creation_grant' THEN
             IF EXISTS(SELECT 1 FROM public.project_creation_operation o
                         JOIN public.project p ON p.tenant=o.tenant AND p.project=o.project
                        WHERE o.operation=OLD.operation AND p.lifecycle='Deleting') THEN
               RETURN OLD;
             END IF;
           ELSIF ${projectDeleting} THEN
             RETURN OLD;
           END IF;
         END IF;
         RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
           USING ERRCODE='integrity_constraint_violation'; END $$`,
    `UPDATE public.tenant SET display_name=tenant`,
    `ALTER TABLE public.tenant ALTER COLUMN display_name SET NOT NULL`,
    `ALTER TABLE public.tenant ADD CONSTRAINT tenant_display_name_is_bounded
       CHECK (display_name=tenant
              OR char_length(display_name) BETWEEN 1 AND ${String(tenantDisplayNameCharsMaxAt183)})`,
    `GRANT SELECT (tenant, display_name) ON public.tenant TO ${accessPlaneRole}`,
    `GRANT INSERT (tenant, display_name) ON public.tenant TO ${accessPlaneRole}`,
    `GRANT UPDATE (display_name) ON public.tenant TO ${accessPlaneRole}`,
  ],
};
