import { apiRole, type Migration } from "../shared.ts";

const nativeOperationsViews = [
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

export const migration015: Migration = {
  version: 15,
  name: "native operational reads",
  statements: [...nativeOperationsViews],
};
