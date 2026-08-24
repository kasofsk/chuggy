import {
  boundaryOwnerRole,
  selectorAttemptAdvanceFunction,
  selectorAttemptAllocateFunction,
  selectorAttemptReconcileFunction,
  selectorHostReadinessFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

export const migration011: Migration = {
  version: 11,
  name: "durable selector attempts and permits",
  statements: [
    `CREATE TABLE selector_attempt (
         attempt text PRIMARY KEY, tenant text NOT NULL, project text NOT NULL,
         state text NOT NULL, settings_revision bigint,
         observation_digest text, terminal_evidence text,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now(),
         lease_expires_at timestamptz NOT NULL DEFAULT now(),
         FOREIGN KEY (tenant,project) REFERENCES project (tenant,project),
         CHECK (length(attempt) BETWEEN 1 AND 256),
         CHECK (state IN ('Starting','Running','Terminating','Completed','Terminated','Quarantined')),
         CHECK (settings_revision IS NULL OR settings_revision >= 1),
         CHECK (observation_digest IS NULL OR observation_digest ~ '^[0-9a-f]{64}$'),
         CHECK (terminal_evidence IS NULL OR length(terminal_evidence) BETWEEN 1 AND 4096)
       )`,
    `ALTER TABLE selector_project_state
         ADD COLUMN candidate_scan_state text NOT NULL DEFAULT 'Unstarted',
         ADD COLUMN candidate_scan_exhausted_token text,
         ADD CHECK (candidate_scan_state IN ('Unstarted','Continue','Exhausted')),
         ADD CHECK (candidate_scan_exhausted_token IS NULL OR length(candidate_scan_exhausted_token) <= 65536)`,
    `UPDATE selector_project_state SET candidate_scan_state='Continue'
         WHERE candidate_scan_token IS NOT NULL`,
    `CREATE TABLE selector_decision_permit (
         attempt text PRIMARY KEY REFERENCES selector_attempt(attempt),
         acquired_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
         CHECK (released_at IS NULL OR released_at >= acquired_at)
       )`,
    `CREATE TABLE selector_observation (
         attempt text PRIMARY KEY REFERENCES selector_attempt(attempt),
         observation text NOT NULL, manifest_digest text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         CHECK (length(observation) BETWEEN 2 AND 2097152),
         CHECK (manifest_digest ~ '^[0-9a-f]{64}$')
       )`,
    `CREATE TABLE selector_runtime_readiness (
         singleton integer PRIMARY KEY DEFAULT 1, production_host boolean NOT NULL DEFAULT false,
         checked_at timestamptz NOT NULL DEFAULT now(), CHECK (singleton=1)
       )`,
    `INSERT INTO selector_runtime_readiness (singleton) VALUES (1)`,
    `INSERT INTO selector_attempt
         (attempt,tenant,project,state,settings_revision,terminal_evidence,created_at,updated_at)
         SELECT selector_decision,tenant,project,'Completed',1,'migrated completed interaction',
                started_at,completed_at FROM selector_interaction`,
    `INSERT INTO selector_decision_permit (attempt,acquired_at,released_at)
         SELECT selector_decision,started_at,completed_at FROM selector_interaction`,
    `ALTER TABLE selector_interaction ADD FOREIGN KEY (selector_decision)
         REFERENCES selector_attempt(attempt)`,
    `CREATE FUNCTION ${selectorAttemptAllocateFunction}(
         in_attempt text,in_tenant text,in_project text,
         concurrent_limit integer,rate_limit integer,decision_milliseconds integer)
         RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
         SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF length(in_attempt) NOT BETWEEN 1 AND 256
              OR concurrent_limit NOT BETWEEN 1 AND 100
              OR rate_limit NOT BETWEEN 1 AND 100000
              OR decision_milliseconds NOT BETWEEN 1 AND 3600000 THEN
             RAISE EXCEPTION 'invalid selector attempt allocation';
           END IF;
           PERFORM pg_advisory_xact_lock(1936028274);
           IF EXISTS (SELECT 1 FROM selector_attempt WHERE attempt=in_attempt) THEN
             RETURN false;
           END IF;
           IF (SELECT count(*) FROM selector_decision_permit WHERE released_at IS NULL) >= concurrent_limit
              OR (SELECT count(*) FROM selector_decision_permit
                    WHERE acquired_at >= now()-interval '1 minute') >= rate_limit THEN
             RETURN false;
           END IF;
           INSERT INTO selector_attempt (attempt,tenant,project,state,lease_expires_at)
             VALUES (in_attempt,in_tenant,in_project,'Starting',
               now()+greatest(decision_milliseconds*2,decision_milliseconds+300000)*interval '1 millisecond');
           INSERT INTO selector_decision_permit (attempt) VALUES (in_attempt);
           RETURN true;
         END $$`,
    `ALTER FUNCTION ${selectorAttemptAllocateFunction}(text,text,text,integer,integer,integer)
         OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorAttemptReconcileFunction}(attempt_limit integer)
         RETURNS TABLE(attempt text) LANGUAGE plpgsql SECURITY DEFINER
         SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF attempt_limit NOT BETWEEN 1 AND 100 THEN
             RAISE EXCEPTION 'invalid selector attempt reconciliation bound';
           END IF;
           PERFORM pg_advisory_xact_lock(1936028274);
           UPDATE selector_attempt SET state='Quarantined',updated_at=now()
             WHERE state IN ('Starting','Running') AND lease_expires_at<=now();
           RETURN QUERY SELECT candidate.attempt FROM selector_attempt candidate
             WHERE candidate.state='Quarantined'
             ORDER BY candidate.updated_at,candidate.attempt LIMIT attempt_limit;
         END $$`,
    `ALTER FUNCTION ${selectorAttemptReconcileFunction}(integer)
         OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorAttemptAdvanceFunction}(
         in_attempt text,in_transition text,in_evidence text)
         RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
         SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF in_transition='Running' THEN
             UPDATE selector_attempt SET state='Running',updated_at=now()
               WHERE attempt=in_attempt AND state='Starting';
           ELSIF in_transition='Completed' THEN
             UPDATE selector_attempt SET state='Completed',terminal_evidence=in_evidence,updated_at=now()
               WHERE attempt=in_attempt AND state='Running'
                 AND EXISTS (SELECT 1 FROM selector_observation WHERE attempt=in_attempt);
             IF FOUND THEN
               UPDATE selector_decision_permit SET released_at=now()
                 WHERE attempt=in_attempt AND released_at IS NULL;
             END IF;
           ELSIF in_transition='Quarantined' THEN
             UPDATE selector_attempt SET state='Quarantined',updated_at=now()
               WHERE attempt=in_attempt AND state IN ('Starting','Running','Terminating','Quarantined');
           ELSIF in_transition='Terminated' THEN
             UPDATE selector_attempt SET state='Terminated',terminal_evidence=in_evidence,updated_at=now()
               WHERE attempt=in_attempt AND state IN ('Starting','Running','Terminating','Quarantined');
             IF FOUND THEN
               UPDATE selector_decision_permit SET released_at=now()
                 WHERE attempt=in_attempt AND released_at IS NULL;
             END IF;
           ELSE RAISE EXCEPTION 'invalid selector attempt transition';
           END IF;
           RETURN FOUND;
         END $$`,
    `ALTER FUNCTION ${selectorAttemptAdvanceFunction}(text,text,text)
         OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorHostReadinessFunction}(in_ready boolean)
         RETURNS void LANGUAGE sql SECURITY DEFINER
         SET search_path=pg_catalog,public,pg_temp AS $$
           UPDATE selector_runtime_readiness
             SET production_host=in_ready,checked_at=now() WHERE singleton=1
         $$`,
    `ALTER FUNCTION ${selectorHostReadinessFunction}(boolean)
         OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION enforce_selector_automatic_readiness() RETURNS trigger
         LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF NEW.dispatch_mode='Automatic' AND NOT EXISTS (
             SELECT 1 FROM selector_runtime_readiness
               WHERE singleton=1 AND production_host) THEN
             RAISE EXCEPTION 'automatic selector requires a production capability host';
           END IF;
           RETURN NEW;
         END $$`,
    `ALTER FUNCTION enforce_selector_automatic_readiness() OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER selector_automatic_readiness
         BEFORE INSERT OR UPDATE OF dispatch_mode ON selector_runtime_settings
         FOR EACH ROW EXECUTE FUNCTION enforce_selector_automatic_readiness()`,
    `CREATE FUNCTION enforce_selector_proposal_attempt() RETURNS trigger
         LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM selector_attempt
             WHERE attempt=NEW.selector_decision AND tenant=NEW.tenant
               AND project=NEW.project AND state='Completed') THEN
             RAISE EXCEPTION 'selector proposal requires a completed durable attempt';
           END IF;
           RETURN NEW;
         END $$`,
    `ALTER FUNCTION enforce_selector_proposal_attempt() OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER selector_proposal_attempt
         BEFORE INSERT ON selector_proposal_delivery FOR EACH ROW
         EXECUTE FUNCTION enforce_selector_proposal_attempt()`,
    `REVOKE ALL ON selector_attempt,selector_decision_permit,selector_observation FROM PUBLIC`,
    `GRANT SELECT,INSERT,UPDATE ON selector_attempt,selector_decision_permit
         TO ${boundaryOwnerRole}`,
    `GRANT SELECT,INSERT ON selector_observation TO ${boundaryOwnerRole}`,
    `GRANT SELECT,UPDATE ON selector_runtime_readiness TO ${boundaryOwnerRole}`,
    `GRANT SELECT ON selector_attempt,selector_decision_permit,selector_observation
         TO ${selectorServiceRole}`,
    `GRANT INSERT ON selector_attempt,selector_decision_permit
         TO ${selectorServiceRole}`,
    `GRANT INSERT ON selector_observation TO ${selectorServiceRole}`,
    `GRANT UPDATE (settings_revision,observation_digest) ON selector_attempt
         TO ${selectorServiceRole}`,
    `REVOKE ALL ON FUNCTION ${selectorAttemptAllocateFunction}(text,text,text,integer,integer,integer),
         ${selectorAttemptAdvanceFunction}(text,text,text),
         ${selectorAttemptReconcileFunction}(integer),
         ${selectorHostReadinessFunction}(boolean),enforce_selector_automatic_readiness(),
         enforce_selector_proposal_attempt() FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${selectorAttemptAllocateFunction}(text,text,text,integer,integer,integer),
         ${selectorAttemptAdvanceFunction}(text,text,text),
         ${selectorAttemptReconcileFunction}(integer),
         ${selectorHostReadinessFunction}(boolean) TO ${selectorServiceRole}`,
    `ALTER TABLE selector_runtime_settings ALTER COLUMN dispatch_mode SET DEFAULT 'ApprovalRequired'`,
    `UPDATE selector_runtime_settings SET dispatch_mode='ApprovalRequired',revision=revision+1,
         updated_at=now() WHERE singleton=1 AND dispatch_mode='Automatic'`,
    `INSERT INTO selector_runtime_settings_history
         (revision,mode,dispatch_mode,base_prompt,controls,administrator_kind,administrator_subject)
         SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','trusted-policy migration'
           FROM selector_runtime_settings ON CONFLICT (revision) DO NOTHING`,
  ],
};
