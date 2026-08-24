import {
  accountIdentityFunction,
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  projectAuthorizationFunction,
  schedulerRole,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
  type Migration,
} from "./shared.ts";

export const nativeProjectAccess = [
  `CREATE TABLE project_membership (
     principal          text    NOT NULL,
     tenant             text    NOT NULL,
     project            text    NOT NULL,
     authority_kind     text    NOT NULL,
     authority_subject  text    NOT NULL,
     may_read           boolean NOT NULL,
     may_mutate         boolean NOT NULL,
     may_dispatch       boolean NOT NULL,
     may_propose        boolean NOT NULL,
     PRIMARY KEY (principal, tenant, project),
     CONSTRAINT project_membership_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT project_membership_identities_are_present CHECK (
       principal <> '' AND authority_kind <> '' AND authority_subject <> ''),
     CONSTRAINT project_membership_grants_something CHECK (
       may_read OR may_mutate OR may_dispatch OR may_propose)
   )`,
  `CREATE FUNCTION ${projectAuthorizationFunction}(
     in_principal text,in_tenant text,in_project text,in_access text)
     RETURNS TABLE (authority_kind text,authority_subject text)
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       IF in_access NOT IN ('Read','Mutate','DispatchTicket','ProposeDispatch') THEN
         RAISE EXCEPTION 'unknown project access kind';
       END IF;
       RETURN QUERY
         SELECT membership.authority_kind,membership.authority_subject
           FROM project_membership membership
          WHERE membership.principal=in_principal
            AND membership.tenant=in_tenant AND membership.project=in_project
            AND CASE in_access
              WHEN 'Read' THEN membership.may_read
              WHEN 'Mutate' THEN membership.may_mutate
              WHEN 'DispatchTicket' THEN membership.may_dispatch
              WHEN 'ProposeDispatch' THEN membership.may_propose
            END;
     END $$`,
  `ALTER FUNCTION ${projectAuthorizationFunction}(text,text,text,text)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON project_membership FROM PUBLIC`,
  `GRANT SELECT ON project_membership TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectAuthorizationFunction}(text,text,text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${projectAuthorizationFunction}(text,text,text,text)
     TO ${apiRole}`,
];

export const nativeOperationsViews = [
  `GRANT SELECT (tenant,project,execution,ticket,task,cluster,
     source_request,configuration_revision,configuration_digest,requirement_identity,
     requirement_value,requirement_digest,requirement_source,platform_default_version,
     status,outcome,result_manifest,
     retries_spent,registered_at,terminal_at) ON execution TO ${apiRole}`,
  `GRANT SELECT (tenant,project,execution,attempt,attempt_number,generation,
     state,opened_at,ended_at) ON execution_attempt TO ${apiRole}`,
  `GRANT SELECT (tenant,project,manifest,attempt,schema_version,digest,verdict,recorded_at)
     ON execution_result TO ${apiRole}`,
  `GRANT SELECT (tenant,project,manifest,ordinal,role,path,digest,bytes)
     ON execution_result_artifact TO ${apiRole}`,
  `GRANT SELECT (tenant,project,request,task,kind,stage)
     ON execution_request_task TO ${apiRole}`,
];

export const accessMigrations: readonly Migration[] = [
  {
    version: 14,
    name: "native project access",
    statements: [...nativeProjectAccess],
  },
  {
    version: 15,
    name: "native operational reads",
    statements: [...nativeOperationsViews],
  },
  {
    version: 16,
    name: "runtime schema readiness",
    statements: [
      `GRANT SELECT ON schema_migration TO ${apiRole},${ticketServiceRole},
         ${selectorServiceRole},${schedulerRole},${finalizerRole}`,
    ],
  },
  {
    version: 17,
    name: "selector context account read",
    statements: [
      `GRANT EXECUTE ON FUNCTION ${accountIdentityFunction}(text,text) TO ${apiRole}`,
    ],
  },
  {
    version: 18,
    name: "selector review schema readiness",
    statements: [`GRANT SELECT ON schema_migration TO ${selectorReviewRole}`],
  },
];
