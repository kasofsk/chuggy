import {
  apiRole,
  boundaryOwnerRole,
  projectCreateFunction,
  projectCreationGrantsFunction,
  type Migration,
} from "../shared.ts";

const signature = `public.${projectCreateFunction}(in_tenant text, in_project text, in_tenant_new boolean, in_operation text, in_authority_kind text, in_authority_subject text)`;
const grantsSignature = `public.${projectCreationGrantsFunction}(in_operation text)`;

/**
 * A tenant is a row, and a signed-in principal creates a project through one
 * door. The tenant row is what makes a tenant name first-come: the door inserts
 * it or finds it under the same unique key a concurrent creator waits on, so
 * the caller's expectation that the tenant is new is answered `TenantTaken`
 * rather than a project in a tenant somebody else just made.
 *
 * WHO CREATED A TENANT IS THE OPERATION THAT DID. The operation row records
 * whether it made the tenant, and at most one may, so the creator is read from
 * there rather than stored twice. Rows backfilled from existing projects carry
 * no creation instant, because none was ever recorded.
 *
 * ONLY A CREATION IS RECORDED. A refusal writes nothing, so a retry under the
 * same identity is decided again; a replay answers `AlreadyCreated` with
 * whether the tenant was made, which is what the caller re-asserts access from.
 *
 * ACCESS IS RE-ASSERTED ONLY UNTIL IT IS RECORDED AS WRITTEN. The caller records
 * an operation's grants once the authority has taken them, in a table of their
 * own so the operation row stays immutable, and a replay after that is told so
 * and writes nothing: a grant an operator revoked is not restored by replaying
 * the request that first made it.
 */
export const migration026: Migration = {
  version: 26,
  name: "a principal creates a project, and a tenant is a row",
  statements: [
    `CREATE TABLE public.tenant (
       tenant text PRIMARY KEY,
       created_at timestamp with time zone DEFAULT now())`,
    `INSERT INTO public.tenant(tenant,created_at)
       SELECT DISTINCT tenant, NULL::timestamp with time zone FROM public.project`,
    `ALTER TABLE public.project ADD CONSTRAINT project_names_a_tenant
       FOREIGN KEY (tenant) REFERENCES public.tenant(tenant)`,
    `CREATE TABLE public.project_creation_operation (
       operation text PRIMARY KEY,
       tenant text NOT NULL,
       project text NOT NULL,
       tenant_created boolean NOT NULL,
       authority_kind text NOT NULL,
       authority_subject text NOT NULL,
       recorded_at timestamp with time zone DEFAULT now() NOT NULL,
       CONSTRAINT project_creation_operation_is_bounded CHECK (
         length(operation) BETWEEN 1 AND 256
         AND length(authority_kind) BETWEEN 1 AND 256
         AND length(authority_subject) BETWEEN 1 AND 256),
       CONSTRAINT project_creation_operation_names_a_project
         FOREIGN KEY (tenant,project) REFERENCES public.project(tenant,project))`,
    `CREATE TABLE public.project_creation_grant (
       operation text PRIMARY KEY
         REFERENCES public.project_creation_operation(operation),
       recorded_at timestamp with time zone DEFAULT now() NOT NULL)`,
    `CREATE UNIQUE INDEX project_creation_operation_creates_a_tenant_once
       ON public.project_creation_operation(tenant) WHERE tenant_created`,
    `CREATE FUNCTION public.project_creation_is_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
     RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
       USING ERRCODE='integrity_constraint_violation'; END $$`,
    `ALTER FUNCTION public.project_creation_is_immutable() OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER tenant_is_immutable BEFORE DELETE OR UPDATE ON public.tenant
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `CREATE TRIGGER project_creation_operation_is_immutable BEFORE DELETE OR UPDATE ON public.project_creation_operation
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `CREATE TRIGGER project_creation_grant_is_immutable BEFORE DELETE OR UPDATE ON public.project_creation_grant
       FOR EACH ROW EXECUTE FUNCTION public.project_creation_is_immutable()`,
    `GRANT SELECT,INSERT ON TABLE public.tenant TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT ON TABLE public.project_creation_operation TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT ON TABLE public.project_creation_grant TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${signature} RETURNS TABLE(outcome text, tenant_created boolean, grants_written boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE existing project_creation_operation%ROWTYPE;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('project-creation:'||in_operation,0));
       SELECT * INTO existing FROM project_creation_operation o
        WHERE o.operation=in_operation;
       IF FOUND THEN
         IF existing.tenant=in_tenant AND existing.project=in_project
            AND existing.authority_kind=in_authority_kind
            AND existing.authority_subject=in_authority_subject
           THEN RETURN QUERY SELECT 'AlreadyCreated', existing.tenant_created,
             EXISTS(SELECT 1 FROM project_creation_grant g
                     WHERE g.operation=in_operation);
           ELSE RETURN QUERY VALUES ('OperationConflict', false, false);
         END IF;
         RETURN;
       END IF;
       INSERT INTO tenant(tenant) VALUES(in_tenant) ON CONFLICT DO NOTHING;
       tenant_created := FOUND;
       IF in_tenant_new AND NOT tenant_created THEN
         RETURN QUERY VALUES ('TenantTaken', false, false);
         RETURN;
       END IF;
       INSERT INTO project(tenant,project,lifecycle)
         VALUES(in_tenant,in_project,'Active') ON CONFLICT DO NOTHING;
       IF NOT FOUND THEN
         RETURN QUERY VALUES ('ProjectExists', false, false);
         RETURN;
       END IF;
       INSERT INTO project_creation_operation
         (operation,tenant,project,tenant_created,authority_kind,authority_subject)
         VALUES(in_operation,in_tenant,in_project,tenant_created,
                in_authority_kind,in_authority_subject);
       RETURN QUERY VALUES ('Created', tenant_created, false);
     END $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}`,
    `CREATE FUNCTION ${grantsSignature} RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     INSERT INTO project_creation_grant(operation) VALUES(in_operation)
       ON CONFLICT DO NOTHING
    $$`,
    `ALTER FUNCTION ${grantsSignature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${grantsSignature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${grantsSignature} TO ${apiRole}`,
  ],
};
