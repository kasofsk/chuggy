/**
 * A project names an artifact of its own as its icon, and another as its
 * banner.
 *
 * A ROW IS ONE ROLE OF ONE PROJECT, naming the artifact by its identity and
 * who named it, absent until an administrator names one, written as
 * `project_theme` is: through one door that answers `Unchanged` where nothing
 * moved, a row naming no artifact being a role that was cleared. The type and
 * size the API checks before naming one are the artifact's own and stored
 * nowhere here.
 *
 * IT GOES WITH ITS PROJECT, pointing at `project` and cascading from it, so
 * `delete_unrun_project` takes it with the project row.
 *
 * THE DOOR IS THE BOUNDARY OWNER'S, callable by the API and nobody else, which
 * reads the relation directly, as the inventory does for each project's icon.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectImageSetFunction,
  type Migration,
} from "../shared.ts";

const imageSet = `public.${projectImageSetFunction}(in_tenant text, in_project text, in_role text, in_artifact text, in_authority_kind text, in_authority_subject text)`;

export const migration195: Migration = {
  version: 195,
  name: "a project names an artifact of its own as its icon and its banner",
  statements: [
    `CREATE TABLE public.project_image (
       tenant text NOT NULL,
       project text NOT NULL,
       role text NOT NULL
         CONSTRAINT project_image_role_is_known
         CHECK (role IN ('icon','banner')),
       artifact text
         CONSTRAINT project_image_artifact_is_bounded
         CHECK (artifact IS NULL OR length(artifact) BETWEEN 1 AND 256),
       set_by_kind text NOT NULL
         CONSTRAINT project_image_setter_kind_is_bounded
         CHECK (length(set_by_kind) BETWEEN 1 AND 256),
       set_by_subject text NOT NULL
         CONSTRAINT project_image_setter_subject_is_bounded
         CHECK (length(set_by_subject) BETWEEN 1 AND 256),
       set_at timestamp with time zone NOT NULL,
       PRIMARY KEY (tenant,project,role),
       CONSTRAINT project_image_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project)
         ON DELETE CASCADE)`,
    `GRANT SELECT,INSERT,UPDATE ON TABLE public.project_image TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON TABLE public.project_image TO ${apiRole}`,
    `CREATE FUNCTION ${imageSet} RETURNS text
       LANGUAGE plpgsql VOLATILE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE standing text;
       BEGIN
         PERFORM 1 FROM project p
          WHERE p.tenant=in_tenant AND p.project=in_project FOR KEY SHARE;
         IF NOT FOUND THEN RETURN 'NotFound'; END IF;
         SELECT i.artifact INTO standing FROM project_image i
          WHERE i.tenant=in_tenant AND i.project=in_project
            AND i.role=in_role FOR UPDATE;
         IF standing IS NOT DISTINCT FROM in_artifact THEN
           RETURN 'Unchanged';
         END IF;
         INSERT INTO project_image
           (tenant,project,role,artifact,set_by_kind,set_by_subject,set_at)
           VALUES (in_tenant,in_project,in_role,in_artifact,
                   in_authority_kind,in_authority_subject,now())
           ON CONFLICT (tenant,project,role) DO UPDATE
             SET artifact=EXCLUDED.artifact,
                 set_by_kind=EXCLUDED.set_by_kind,
                 set_by_subject=EXCLUDED.set_by_subject,
                 set_at=EXCLUDED.set_at;
         RETURN 'Written';
       END
     $$`,
    `ALTER FUNCTION ${imageSet} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${imageSet} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${imageSet} TO ${apiRole}`,
  ],
};
