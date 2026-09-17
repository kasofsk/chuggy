import {
  apiRole,
  schedulerRole,
  workerPlaneRole,
  finalizerRole,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";
import { ticketMachineQueueStatements } from "../ticketMachineQueue.ts";
import { ticketExecutionSchemaStatements } from "../ticketExecution.ts";
import { ticketFinalizerMigrationStatements } from "../ticketFinalizer.ts";

/** Fresh projects use the adopted ticket model; legacy histories remain separate. */
export const migration002: Migration = {
  version: 2,
  name: "ticket-machine",
  statements: [
    `ALTER TABLE project ADD COLUMN ticket_model text NOT NULL DEFAULT 'Legacy'
       CHECK (ticket_model IN ('Legacy','Chuggernaut'))`,
    `ALTER TABLE project ALTER COLUMN ticket_model SET DEFAULT 'Chuggernaut'`,
    `CREATE TABLE ticket_machine_content (
       tenant text NOT NULL, project text NOT NULL,
       reference bigint GENERATED ALWAYS AS IDENTITY CHECK(reference BETWEEN 1 AND 9007199254740991),
       media_type text NOT NULL CHECK(length(media_type) BETWEEN 1 AND 256),
       digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
       content text NOT NULL CHECK(octet_length(content)<=1048576),
       PRIMARY KEY(tenant,project,reference), UNIQUE(tenant,project,media_type,digest),
       FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
    `CREATE TABLE ticket_machine_input (
       tenant text NOT NULL, project text NOT NULL, identity text NOT NULL CHECK(length(identity) BETWEEN 1 AND 256),
       origin text NOT NULL CHECK(origin IN ('Author','Execution','Finalizer')),
       command text NOT NULL, attribution text NOT NULL, metadata text,
       decision text NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0),
       UNIQUE(tenant,project,sequence),
       PRIMARY KEY(tenant,project,identity), FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
    `CREATE TABLE ticket_machine_event (
       tenant text NOT NULL, project text NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0),
       input_identity text NOT NULL, event text NOT NULL,
       PRIMARY KEY(tenant,project,sequence), UNIQUE(tenant,project,input_identity),
       FOREIGN KEY(tenant,project,input_identity) REFERENCES ticket_machine_input(tenant,project,identity))`,
    `CREATE TABLE ticket_machine_obligation (
       tenant text NOT NULL, project text NOT NULL, identity text NOT NULL,
       sequence bigint NOT NULL, position integer NOT NULL CHECK(position >= 0),
       obligation text NOT NULL, delivered boolean NOT NULL DEFAULT false,
       PRIMARY KEY(tenant,project,identity), UNIQUE(tenant,project,sequence,position),
       FOREIGN KEY(tenant,project,sequence) REFERENCES ticket_machine_event(tenant,project,sequence))`,
    `GRANT SELECT,INSERT ON ticket_machine_input,
       ticket_machine_event,ticket_machine_obligation TO ${ticketServiceRole}`,
    `GRANT UPDATE(delivered) ON ticket_machine_obligation TO ${ticketServiceRole}`,
    `GRANT SELECT,INSERT ON ticket_machine_content TO ${ticketServiceRole}`,
    `GRANT USAGE ON SEQUENCE ticket_machine_content_reference_seq TO ${ticketServiceRole}`,
    `GRANT SELECT(ticket_model) ON project TO ${apiRole},${schedulerRole}`,
    ...ticketMachineQueueStatements,
    ...ticketExecutionSchemaStatements,
    `GRANT SELECT(forge,app,account,tenant,installation_id) ON forge_installation TO ${schedulerRole}`,
    `GRANT SELECT ON ticket_execution,recovery_epoch TO ${workerPlaneRole}`,
    `GRANT UPDATE(worker_outcome) ON ticket_execution TO ${workerPlaneRole}`,
    ...ticketFinalizerMigrationStatements,
    `GRANT SELECT,INSERT ON ticket_machine_finalization TO ${ticketServiceRole}`,
    `GRANT SELECT,INSERT ON ticket_execution TO ${ticketServiceRole}`,
    `GRANT UPDATE(state,claim_owner,claim_expires_at,recovery_epoch) ON ticket_execution TO ${ticketServiceRole}`,
    `GRANT SELECT ON ticket_execution TO ${schedulerRole}`,
    `GRANT UPDATE(state,attempt,claim_owner,claim_expires_at,recovery_epoch,available_at,terminal_input_identity,capability_digest,worker_outcome) ON ticket_execution TO ${schedulerRole}`,
    `GRANT SELECT,INSERT ON ticket_execution_cancellation TO ${ticketServiceRole}`,
    `GRANT SELECT,INSERT ON ticket_machine_content TO ${apiRole},${schedulerRole},${finalizerRole}`,
    `GRANT USAGE ON SEQUENCE ticket_machine_content_reference_seq TO ${apiRole},${schedulerRole},${finalizerRole}`,
  ],
};
