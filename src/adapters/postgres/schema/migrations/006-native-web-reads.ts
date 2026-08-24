import { apiRole, type Migration } from "../shared.ts";

const nativeWebReads = [
  `REVOKE SELECT ON operation FROM ${apiRole}`,
  `GRANT SELECT (tenant, project, operation, authority_kind, admission,
                 accepted_at)
     ON operation TO ${apiRole}`,
  `GRANT SELECT (tenant, project, ordinal, input_kind, input_id, state,
                 lifecycle_generation, decided_seq, outcome_code,
                 refused_head, refused_lifecycle_generation)
     ON decision_input TO ${apiRole}`,
  `REVOKE SELECT ON project FROM ${apiRole}`,
  `GRANT SELECT (tenant, project, lifecycle, lifecycle_generation,
                 fencing_epoch, head)
     ON project TO ${apiRole}`,
  `GRANT SELECT (tenant, project, ticket, phase, seq)
     ON ticket_projection TO ${apiRole}`,
];

export const migration006: Migration = {
  version: 6,
  name: "native web reads",
  statements: [...nativeWebReads],
};
