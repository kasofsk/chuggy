import {
  apiRole,
  boundaryOwnerRole,
  repositoryBindingReadFunction,
  type Migration,
} from "../shared.ts";

export const migration021: Migration = {
  version: 21,
  name: "API repository binding read",
  statements: [
    `GRANT SELECT ON project_repository TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${repositoryBindingReadFunction}(in_tenant text,in_project text)
       RETURNS TABLE(repository text,recovery_epoch text)
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.repository,b.recovery_epoch FROM project_repository b
        WHERE b.tenant=in_tenant AND b.project=in_project
       $$`,
    `ALTER FUNCTION ${repositoryBindingReadFunction}(text,text) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${repositoryBindingReadFunction}(text,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(text,text) TO ${apiRole}`,
  ],
};
