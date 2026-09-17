export const ticketExecutionSchemaStatements = [
  `CREATE TABLE ticket_execution (
     tenant text NOT NULL, project text NOT NULL, task_key text NOT NULL CHECK(length(task_key) BETWEEN 1 AND 256),
     delivery_identity text NOT NULL CHECK(length(delivery_identity) BETWEEN 1 AND 256),
     obligation text NOT NULL, state text NOT NULL DEFAULT 'Queued'
       CHECK(state IN ('Queued','Running','Terminal','Cancelled')),
     attempt integer NOT NULL DEFAULT 0 CHECK(attempt >= 0),
     claim_owner text, claim_expires_at timestamptz, recovery_epoch text REFERENCES recovery_epoch(epoch),
     available_at timestamptz NOT NULL DEFAULT now(),
     terminal_input_identity text,
     capability_digest text CHECK(capability_digest IS NULL OR capability_digest ~ '^[0-9a-f]{64}$'),
     worker_outcome jsonb,
     PRIMARY KEY(tenant,project,task_key), UNIQUE(tenant,project,delivery_identity),
     FOREIGN KEY(tenant,project) REFERENCES project(tenant,project),
     CHECK((state='Running')=(claim_owner IS NOT NULL AND claim_expires_at IS NOT NULL AND recovery_epoch IS NOT NULL)),
     CHECK((state='Terminal')=(terminal_input_identity IS NOT NULL)))`,
  `CREATE TABLE ticket_execution_cancellation (
     tenant text NOT NULL, project text NOT NULL, identity text NOT NULL, task_key text NOT NULL,
     PRIMARY KEY(tenant,project,task_key), UNIQUE(tenant,project,identity),
     FOREIGN KEY(tenant,project) REFERENCES project(tenant,project))`,
] as const;
