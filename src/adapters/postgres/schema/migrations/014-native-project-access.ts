import {
  apiRole,
  boundaryOwnerRole,
  projectAuthorizationFunction,
  type Migration,
} from "../shared.ts";

const nativeProjectAccess = [
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

export const migration014: Migration = {
  version: 14,
  name: "native project access",
  statements: [...nativeProjectAccess],
};
