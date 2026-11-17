/**
 * A project is called something beside the name that addresses it.
 *
 * `project.name` is what its creator called it, bounded by the contract's
 * `projectDisplayNameCharsMax`, and absent for a project no creation named: one
 * that stood before this, and one an operator provisions. An absent name is
 * read as the project's identity, which is what such a project was called
 * until now, so the identity is never stored a second time. The API role reads
 * the column as it reads the others the inventory lists.
 *
 * `create_project` takes the name beside the project and answers the name the
 * project holds: a creation answers the one it wrote, and a repeat the one the
 * first creation wrote, so a creator asking again under another name is told
 * what the project is called rather than renaming it. A replay under the same
 * operation naming another name names a different request, and is
 * `OperationConflict`. Its signature changes, so 26's door is dropped and
 * created with the name added, under 26's owner and grant.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectCreateFunction,
  type Migration,
} from "../shared.ts";

const retired = `public.${projectCreateFunction}(in_tenant text, in_project text, in_standing text, in_tenant_reserved boolean, in_operation text, in_authority_kind text, in_authority_subject text)`;
const signature = `public.${projectCreateFunction}(in_tenant text, in_project text, in_name text, in_standing text, in_tenant_reserved boolean, in_operation text, in_authority_kind text, in_authority_subject text)`;

const door = `CREATE FUNCTION ${signature}
    RETURNS TABLE(outcome text, tenant_created boolean, grants_written boolean, operation text, name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE existing project_creation_operation%ROWTYPE;
             existing_name text;
             refusal text;
     BEGIN
       IF in_standing IS NULL
          OR in_standing NOT IN ('Administers','Claimed','Unclaimed') THEN
         RAISE EXCEPTION 'create_project: unknown standing %', in_standing
           USING ERRCODE='invalid_parameter_value';
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended('project-creation:'||in_operation,0));
       SELECT * INTO existing FROM project_creation_operation o
        WHERE o.operation=in_operation;
       IF FOUND THEN
         SELECT coalesce(p.name,p.project) INTO existing_name FROM project p
          WHERE p.tenant=existing.tenant AND p.project=existing.project;
         IF existing.tenant=in_tenant AND existing.project=in_project
            AND existing_name=in_name
            AND existing.authority_kind=in_authority_kind
            AND existing.authority_subject=in_authority_subject
           THEN RETURN QUERY SELECT 'AlreadyCreated', existing.tenant_created,
             EXISTS(SELECT 1 FROM project_creation_grant g
                     WHERE g.operation=in_operation), in_operation, existing_name;
           ELSE RETURN QUERY VALUES ('OperationConflict', false, false, in_operation, NULL::text);
         END IF;
         RETURN;
       END IF;
       IF in_standing='Claimed' THEN
         refusal := 'TenantTaken';
       ELSIF in_standing='Unclaimed' AND in_tenant_reserved
             AND NOT EXISTS(SELECT 1 FROM tenant t WHERE t.tenant=in_tenant) THEN
         RETURN QUERY VALUES ('TenantReserved', false, false, in_operation, NULL::text);
         RETURN;
       ELSE
         INSERT INTO tenant(tenant) VALUES(in_tenant) ON CONFLICT DO NOTHING;
         tenant_created := FOUND;
         IF in_standing='Unclaimed' AND NOT tenant_created THEN
           refusal := 'TenantTaken';
         ELSE
           INSERT INTO project(tenant,project,name,lifecycle)
             VALUES(in_tenant,in_project,in_name,'Active') ON CONFLICT DO NOTHING;
           IF NOT FOUND THEN
             refusal := 'ProjectExists';
           ELSE
             INSERT INTO project_creation_operation
               (operation,tenant,project,tenant_created,authority_kind,authority_subject)
               VALUES(in_operation,in_tenant,in_project,tenant_created,
                      in_authority_kind,in_authority_subject);
             RETURN QUERY VALUES ('Created', tenant_created, false, in_operation, in_name);
             RETURN;
           END IF;
         END IF;
       END IF;
       SELECT * INTO existing FROM project_creation_operation o
        WHERE o.tenant=in_tenant AND o.project=in_project
          AND o.authority_kind=in_authority_kind
          AND o.authority_subject=in_authority_subject;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyCreated', existing.tenant_created,
           EXISTS(SELECT 1 FROM project_creation_grant g
                   WHERE g.operation=existing.operation), existing.operation,
           (SELECT coalesce(p.name,p.project) FROM project p
             WHERE p.tenant=in_tenant AND p.project=in_project);
       ELSE
         RETURN QUERY VALUES (refusal, false, false, in_operation, NULL::text);
       END IF;
     END $$`;

export const migration183: Migration = {
  version: 183,
  name: "a project is called something beside the name that addresses it",
  statements: [
    `ALTER TABLE public.project ADD COLUMN name text`,
    `ALTER TABLE public.project ADD CONSTRAINT project_name_is_bounded
       CHECK (length(name) BETWEEN 1 AND 100)`,
    `GRANT SELECT(name) ON TABLE public.project TO ${apiRole}`,
    `DROP FUNCTION ${retired}`,
    door,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
  ],
};
