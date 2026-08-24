import { phaseTags } from "../../../../domain/generated/modelTypes.ts";
import { allRefusalCodes } from "../../../../interpreter/projectDecision.ts";
import { schemaTextSet, ticketServiceRole, type Migration } from "../shared.ts";

const decisionRelations = [
  `ALTER TABLE journal_entry
     ADD COLUMN cause_operation text NOT NULL,
     ADD CONSTRAINT journal_entry_cause_is_effective
       UNIQUE (tenant, project, cause_operation),
     ADD CONSTRAINT journal_entry_has_its_cause
       FOREIGN KEY (tenant, project, cause_operation)
       REFERENCES operation (tenant, project, operation)`,
  `ALTER TABLE operation
     ADD COLUMN outcome_code text,
     ADD COLUMN decided_seq  bigint,
     ADD COLUMN refused_head bigint,
     ADD COLUMN refused_lifecycle_generation bigint,
     ADD CONSTRAINT operation_outcome_is_whole CHECK (
       (state = 'Refused') = (outcome_code IS NOT NULL)
       AND (state = 'Refused') = (refused_head IS NOT NULL)
       AND (state = 'Refused') = (refused_lifecycle_generation IS NOT NULL)
       AND (state = 'Succeeded') = (decided_seq IS NOT NULL)
       AND coalesce(decided_seq, 1) >= 1
       AND coalesce(refused_head, 0) >= 0
       AND coalesce(refused_lifecycle_generation, 1) >= 1
     ),
     ADD CONSTRAINT operation_outcome_code_is_known CHECK (
       outcome_code IS NULL OR outcome_code IN (${schemaTextSet(allRefusalCodes)})
     )`,
  `CREATE TABLE ticket_projection (
     tenant  text   NOT NULL,
     project text   NOT NULL,
     ticket  bigint NOT NULL,
     phase   text   NOT NULL,
     seq     bigint NOT NULL,
     PRIMARY KEY (tenant, project, ticket),
     CONSTRAINT ticket_projection_belongs_to_project
       FOREIGN KEY (tenant, project) REFERENCES project (tenant, project),
     CONSTRAINT ticket_projection_phase_is_known CHECK (
       phase IN (${schemaTextSet(phaseTags)})
     ),
     CONSTRAINT ticket_projection_counters_are_positive CHECK (
       ticket >= 1 AND seq >= 1
     )
   )`,
];

/**
 * The trigger that stops a settled operation being written again at all. It is
 * wider than the outcome the earlier version froze because the outcome now has
 * columns beside `state`, and a rule that lists them is a rule the next column
 * is added without.
 */
const decisionTerminality = [
  `CREATE OR REPLACE FUNCTION operation_stays_terminal() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.state <> 'Pending' THEN
         RAISE EXCEPTION
           'operation % is already %, and an outcome is decided once', OLD.operation, OLD.state
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END
     $$`,
];

/**
 * The trigger that makes the fencing epoch the only way to obtain a tenure. A
 * grant names columns and not values, so the rule that ownership is taken
 * rather than written has to be the server's own.
 */
const decisionGrants = [
  `GRANT SELECT ON operation TO ${ticketServiceRole}`,
  `GRANT UPDATE (state, settled_at, settled_authority_kind,
                 settled_authority_subject, outcome_code, decided_seq,
                 refused_head, refused_lifecycle_generation)
     ON operation TO ${ticketServiceRole}`,
  `GRANT UPDATE (consumable) ON inbox_item TO ${ticketServiceRole}`,
  `GRANT SELECT, INSERT ON ticket_projection TO ${ticketServiceRole}`,
  `GRANT UPDATE (phase, seq) ON ticket_projection TO ${ticketServiceRole}`,
];

/**
 * The answers acceptance classifies as ordinary work, which is every answer but
 * the one that reduces outstanding correctness risk.
 */

export const migration003: Migration = {
  version: 3,
  name: "the project decision",
  statements: [...decisionRelations, ...decisionTerminality, ...decisionGrants],
};
