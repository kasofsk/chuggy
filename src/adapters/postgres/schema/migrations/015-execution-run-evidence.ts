import { apiRole, workerPlaneRole, type Migration } from "../shared.ts";

/**
 * Where one attempt's transcript batches and its configuration snapshot are
 * recorded, the bytes themselves living in the blob store this row points at.
 *
 * A ROW IS A POINTER AND A MEASUREMENT. The digest and the byte count are the
 * plane's own reading of what arrived and not the harness's claim about it, and
 * the event count is recounted from the bytes; a machine outside this cluster
 * states what it likes and this tree stores what it measured.
 *
 * BATCHES ARE CONTIGUOUS FROM ONE. A gap would be a transcript nobody can say
 * is whole, so a batch that is not the next one is refused rather than stored
 * out of order, and the run that produced it keeps going either way.
 */
export const migration015: Migration = {
  version: 15,
  name: "execution-run-evidence",
  statements: [
    `CREATE TABLE ticket_execution_run_transcript_batch (
       tenant text NOT NULL, project text NOT NULL, task_key text NOT NULL,
       attempt integer NOT NULL CHECK(attempt >= 0),
       batch integer NOT NULL CHECK(batch BETWEEN 1 AND 4096),
       digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
       bytes bigint NOT NULL CHECK(bytes >= 0),
       events bigint NOT NULL CHECK(events >= 0),
       recorded_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,task_key,attempt,batch),
       FOREIGN KEY(tenant,project,task_key) REFERENCES ticket_execution(tenant,project,task_key) ON DELETE CASCADE)`,
    `CREATE TABLE ticket_execution_run_configuration (
       tenant text NOT NULL, project text NOT NULL, task_key text NOT NULL,
       attempt integer NOT NULL CHECK(attempt >= 0),
       digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
       bytes bigint NOT NULL CHECK(bytes >= 0),
       recorded_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY(tenant,project,task_key,attempt),
       FOREIGN KEY(tenant,project,task_key) REFERENCES ticket_execution(tenant,project,task_key) ON DELETE CASCADE)`,
    `GRANT SELECT,INSERT ON ticket_execution_run_transcript_batch,
       ticket_execution_run_configuration TO ${workerPlaneRole}`,
    `GRANT SELECT ON ticket_execution_run_transcript_batch,
       ticket_execution_run_configuration TO ${apiRole}`,
  ],
};
