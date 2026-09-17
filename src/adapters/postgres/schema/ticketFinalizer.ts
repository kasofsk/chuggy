import { finalizerRole } from "./shared.ts";

export const ticketFinalizerMigrationStatements: readonly string[] = [
  `CREATE TABLE ticket_machine_finalization (
     tenant text NOT NULL, project text NOT NULL, identity text NOT NULL CHECK(length(identity) BETWEEN 1 AND 256),
     obligation text NOT NULL, state text NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Completed')),
     claim_owner text, claim_until timestamptz, claim_recovery_epoch text, claim_generation bigint NOT NULL DEFAULT 0 CHECK(claim_generation >= 0),
     repository text, recovery_epoch text, base_ref text, base_commit text, head_ref text, candidate text,
     promotion text NOT NULL DEFAULT 'Idle' CHECK(promotion IN ('Idle','Unanswered','Published')),
     request jsonb, publication jsonb NOT NULL DEFAULT '{"publication":"Unopened"}',
     merging jsonb NOT NULL DEFAULT '{"merging":"Unasked"}', outcome text, evidence_ref bigint,
     created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     PRIMARY KEY(tenant,project,identity), FOREIGN KEY(tenant,project) REFERENCES project(tenant,project),
     FOREIGN KEY(tenant,project,evidence_ref) REFERENCES ticket_machine_content(tenant,project,reference),
     CHECK((outcome IS NULL) = (evidence_ref IS NULL)),
     CHECK(state<>'Completed' OR outcome IS NOT NULL))`,
  `CREATE INDEX ticket_machine_finalization_pending ON ticket_machine_finalization(created_at,tenant,project,identity) WHERE state='Pending'`,
  `CREATE FUNCTION fence_ticket_machine_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
     DECLARE project_lifecycle text;
     DECLARE current_epoch text;
     BEGIN
       SELECT lifecycle INTO STRICT project_lifecycle FROM project WHERE tenant=OLD.tenant AND project=OLD.project;
       SELECT epoch INTO STRICT current_epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1;
       IF NEW.claim_owner IS NOT NULL AND OLD.claim_owner IS NOT NULL AND OLD.claim_until>clock_timestamp() AND (project_lifecycle<>'Active' OR OLD.claim_recovery_epoch IS DISTINCT FROM current_epoch) THEN
         RETURN NULL;
       END IF;
       RETURN NEW;
     END $$`,
  `CREATE TRIGGER ticket_machine_finalization_fence BEFORE UPDATE ON ticket_machine_finalization
     FOR EACH ROW EXECUTE FUNCTION fence_ticket_machine_finalization()`,
  `GRANT SELECT ON ticket_machine_finalization TO ${finalizerRole}`,
  `GRANT UPDATE(state,claim_owner,claim_until,claim_recovery_epoch,claim_generation,
     repository,recovery_epoch,base_ref,base_commit,head_ref,candidate,promotion,
     request,publication,merging,outcome,evidence_ref,updated_at)
     ON ticket_machine_finalization TO ${finalizerRole}`,
  `GRANT SELECT,INSERT ON ticket_machine_content TO ${finalizerRole}`,
  `GRANT USAGE ON SEQUENCE ticket_machine_content_reference_seq TO ${finalizerRole}`,
];
