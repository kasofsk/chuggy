import {
  boundaryOwnerRole,
  roleStatement,
  selectorClaimFunction,
  selectorControlRole,
  selectorDeliveryFunction,
  selectorReconcileClaimFunction,
  selectorReviewFunction,
  selectorReviewRole,
  selectorServiceRole,
  selectorSettingsFunction,
  type Migration,
} from "../shared.ts";

export const migration010: Migration = {
  version: 10,
  name: "hot-reloadable selector controls",
  statements: [
    roleStatement(selectorControlRole),
    roleStatement(selectorReviewRole),
    `CREATE TABLE selector_runtime_settings (
         singleton integer PRIMARY KEY DEFAULT 1, revision bigint NOT NULL DEFAULT 1,
         mode text NOT NULL DEFAULT 'Running', dispatch_mode text NOT NULL DEFAULT 'Automatic',
         base_prompt text NOT NULL, controls text NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now(),
         CHECK (singleton=1), CHECK (revision >= 1),
         CHECK (mode IN ('Running','Paused')),
         CHECK (dispatch_mode IN ('Automatic','ApprovalRequired')),
         CHECK (length(base_prompt) BETWEEN 1 AND 65536 AND length(controls) BETWEEN 2 AND 65536)
       )`,
    `INSERT INTO selector_runtime_settings (singleton,base_prompt,controls) VALUES
         (1,'Select at most one currently dispatchable ticket. Use the supplied project view and advisory operational context. Prefer work that unblocks other tickets, respect explicit urgency and dependencies, and wait when evidence or safe capacity is insufficient. Use only authorized selector tools and record the evidence used for the decision.',
         '{"modelAllowlist":["*"],"toolAllowlist":["*"],"limits":{"tokensPerDecision":8192,"millisecondsPerDecision":120000,"toolCallsPerDecision":20,"inputBytesPerDecision":1048576,"candidatePagesPerDecision":1,"concurrentDecisions":4,"selectionsPerMinute":60},"operationalContextMaxAgeMs":30000}')`,
    `CREATE TABLE selector_runtime_settings_history (
         revision bigint PRIMARY KEY, mode text NOT NULL, dispatch_mode text NOT NULL,
         base_prompt text NOT NULL,
         controls text NOT NULL, administrator_kind text NOT NULL,
         administrator_subject text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
         CHECK (revision >= 1), CHECK (mode IN ('Running','Paused')),
         CHECK (dispatch_mode IN ('Automatic','ApprovalRequired')),
         CHECK (length(base_prompt) BETWEEN 1 AND 65536 AND length(controls) BETWEEN 2 AND 65536),
         CHECK (length(administrator_kind) BETWEEN 1 AND 256),
         CHECK (length(administrator_subject) BETWEEN 1 AND 256)
       )`,
    `INSERT INTO selector_runtime_settings_history
         (revision,mode,dispatch_mode,base_prompt,controls,administrator_kind,administrator_subject)
         SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','migration'
           FROM selector_runtime_settings`,
    `ALTER TABLE selector_project_state ADD COLUMN working_memory text NOT NULL DEFAULT '{}'
         CHECK (length(working_memory) <= 65536)`,
    `ALTER TABLE selector_interaction ADD COLUMN observed_token text`,
    `ALTER TABLE selector_proposal_delivery
         ADD COLUMN reconcile_at timestamptz,
         ADD COLUMN reconciliation_attempts bigint NOT NULL DEFAULT 0,
         DROP CONSTRAINT selector_proposal_delivery_state_check,
         ADD CHECK (state IN ('AwaitingApproval','Pending','Submitted','Terminal')),
         ADD CHECK (reconciliation_attempts >= 0)`,
    `CREATE TABLE selector_proposal_review (
         ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         selector_decision text NOT NULL UNIQUE,
         tenant text NOT NULL, project text NOT NULL,
         outcome text NOT NULL, reviewer_kind text NOT NULL,
         reviewer_subject text NOT NULL, feedback text,
         reviewed_at timestamptz NOT NULL DEFAULT now(),
         FOREIGN KEY (selector_decision,tenant,project)
           REFERENCES selector_interaction (selector_decision,tenant,project),
         CHECK (outcome IN ('Approved','Rejected')),
         CHECK (length(reviewer_kind) BETWEEN 1 AND 256),
         CHECK (length(reviewer_subject) BETWEEN 1 AND 256),
         CHECK (feedback IS NULL OR length(feedback) <= 65536)
       )`,
    `CREATE FUNCTION enforce_selector_proposal_initial_state() RETURNS trigger
         LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
         DECLARE configured_mode text; running_mode text;
         BEGIN
           SELECT mode,dispatch_mode INTO STRICT running_mode,configured_mode
             FROM selector_runtime_settings WHERE singleton=1 FOR SHARE;
           IF running_mode='Paused' THEN RETURN NULL; END IF;
           NEW.state=CASE configured_mode WHEN 'Automatic' THEN 'Pending'
             ELSE 'AwaitingApproval' END;
           NEW.outcome=NULL;
           NEW.attempts=0;
           NEW.retry_at=now();
           NEW.reconcile_at=NULL;
           NEW.reconciliation_attempts=0;
           RETURN NEW;
         END $$`,
    `ALTER FUNCTION enforce_selector_proposal_initial_state() OWNER TO ${boundaryOwnerRole}`,
    `CREATE TRIGGER selector_proposal_initial_state
         BEFORE INSERT ON selector_proposal_delivery FOR EACH ROW
         EXECUTE FUNCTION enforce_selector_proposal_initial_state()`,
    `CREATE FUNCTION ${selectorClaimFunction}(delivery_limit integer)
         RETURNS TABLE(selector_decision text,tenant text,project text,operation text,command text,attempts bigint)
         LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
           UPDATE selector_proposal_delivery delivery
             SET attempts=delivery.attempts+1,retry_at=now()+interval '30 seconds'
           WHERE delivery.selector_decision IN (
             SELECT candidate.selector_decision FROM selector_proposal_delivery candidate
             WHERE candidate.state='Pending' AND candidate.retry_at<=now()
             ORDER BY candidate.retry_at
             LIMIT CASE WHEN delivery_limit BETWEEN 1 AND 100 THEN delivery_limit ELSE 0 END
             FOR UPDATE SKIP LOCKED)
           RETURNING delivery.selector_decision,delivery.tenant,delivery.project,
             delivery.operation,delivery.command,delivery.attempts
         $$`,
    `ALTER FUNCTION ${selectorClaimFunction}(integer) OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorDeliveryFunction}(in_decision text,in_transition text,in_outcome text)
         RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
         SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF in_transition='Submitted' THEN
             UPDATE selector_proposal_delivery SET state='Submitted',reconcile_at=now()
               WHERE selector_decision=in_decision AND state='Pending';
           ELSIF in_transition='Terminal' THEN
             UPDATE selector_proposal_delivery SET state='Terminal',outcome=in_outcome,
               reconcile_at=NULL
               WHERE selector_decision=in_decision AND state IN ('Pending','Submitted');
           ELSE RAISE EXCEPTION 'invalid selector delivery transition';
           END IF;
           RETURN FOUND;
         END $$`,
    `ALTER FUNCTION ${selectorDeliveryFunction}(text,text,text) OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorReconcileClaimFunction}(delivery_limit integer)
         RETURNS TABLE(selector_decision text,tenant text,project text,operation text,command text,attempts bigint)
         LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
           UPDATE selector_proposal_delivery delivery
             SET reconciliation_attempts=delivery.reconciliation_attempts+1,
                 reconcile_at=now()+interval '30 seconds'
           WHERE delivery.selector_decision IN (
             SELECT candidate.selector_decision FROM selector_proposal_delivery candidate
             WHERE candidate.state='Submitted'
               AND coalesce(candidate.reconcile_at,'-infinity'::timestamptz)<=now()
             ORDER BY coalesce(candidate.reconcile_at,'-infinity'::timestamptz),candidate.selector_decision
             LIMIT CASE WHEN delivery_limit BETWEEN 1 AND 100 THEN delivery_limit ELSE 0 END
             FOR UPDATE SKIP LOCKED)
           RETURNING delivery.selector_decision,delivery.tenant,delivery.project,
             delivery.operation,delivery.command,delivery.reconciliation_attempts AS attempts
         $$`,
    `ALTER FUNCTION ${selectorReconcileClaimFunction}(integer) OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorReviewFunction}(
         in_decision text,in_tenant text,in_project text,in_review text,
         in_reviewer_kind text,in_reviewer_subject text,in_feedback text)
         RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
         SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           IF in_review='Approved' THEN
             UPDATE selector_proposal_delivery SET state='Pending',retry_at=now()
               WHERE selector_decision=in_decision AND tenant=in_tenant AND project=in_project
                 AND state='AwaitingApproval';
           ELSIF in_review='Rejected' THEN
             UPDATE selector_proposal_delivery SET state='Terminal',outcome=json_build_object(
                 'state','RejectedByUser','feedback',in_feedback)::text
               WHERE selector_decision=in_decision AND tenant=in_tenant AND project=in_project
                 AND state='AwaitingApproval';
           ELSE RAISE EXCEPTION 'invalid selector proposal review';
           END IF;
           IF FOUND THEN
             INSERT INTO selector_proposal_review
               (selector_decision,tenant,project,outcome,reviewer_kind,reviewer_subject,feedback)
             VALUES (in_decision,in_tenant,in_project,in_review,
               in_reviewer_kind,in_reviewer_subject,in_feedback);
           END IF;
           RETURN FOUND;
         END $$`,
    `ALTER FUNCTION ${selectorReviewFunction}(text,text,text,text,text,text,text)
         OWNER TO ${boundaryOwnerRole}`,
    `CREATE FUNCTION ${selectorSettingsFunction}(
         expected_revision bigint,new_mode text,new_dispatch_mode text,
         new_base_prompt text,new_controls text,in_administrator_kind text,
         in_administrator_subject text)
         RETURNS TABLE(revision bigint,mode text,dispatch_mode text,base_prompt text,controls text)
         LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
         BEGIN
           RETURN QUERY WITH updated AS (
             UPDATE selector_runtime_settings current SET
               revision=current.revision+1,
               mode=coalesce(new_mode,current.mode),
               dispatch_mode=coalesce(new_dispatch_mode,current.dispatch_mode),
               base_prompt=coalesce(new_base_prompt,current.base_prompt),
               controls=coalesce(new_controls,current.controls),updated_at=now()
             WHERE singleton=1 AND current.revision=expected_revision
             RETURNING current.revision,current.mode,current.dispatch_mode,
               current.base_prompt,current.controls
           ), recorded AS (
             INSERT INTO selector_runtime_settings_history
               (revision,mode,dispatch_mode,base_prompt,controls,
                administrator_kind,administrator_subject)
             SELECT updated.revision,updated.mode,updated.dispatch_mode,
               updated.base_prompt,updated.controls,in_administrator_kind,
               in_administrator_subject FROM updated
           ) SELECT updated.revision,updated.mode,updated.dispatch_mode,
               updated.base_prompt,updated.controls FROM updated;
         END $$`,
    `ALTER FUNCTION ${selectorSettingsFunction}(bigint,text,text,text,text,text,text)
         OWNER TO ${boundaryOwnerRole}`,
    `GRANT SELECT,UPDATE ON selector_runtime_settings TO ${boundaryOwnerRole}`,
    `GRANT INSERT ON selector_runtime_settings_history TO ${boundaryOwnerRole}`,
    `GRANT SELECT,UPDATE ON selector_proposal_delivery TO ${boundaryOwnerRole}`,
    `GRANT INSERT ON selector_proposal_review TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${selectorSettingsFunction}(bigint,text,text,text,text,text,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${selectorSettingsFunction}(bigint,text,text,text,text,text,text)
         TO ${selectorControlRole}`,
    `GRANT SELECT ON selector_runtime_settings TO ${selectorServiceRole},${selectorControlRole}`,
    `GRANT SELECT ON selector_runtime_settings_history TO ${selectorControlRole}`,
    `GRANT SELECT ON selector_proposal_delivery TO ${selectorControlRole}`,
    `REVOKE ALL ON selector_project_state,selector_inventory_state,selector_interaction,
         selector_interaction_resource,selector_planning_intent,selector_proposal_delivery,selector_proposal_review
         FROM ${selectorServiceRole}`,
    `GRANT SELECT,INSERT,UPDATE ON selector_project_state TO ${selectorServiceRole}`,
    `GRANT SELECT,UPDATE ON selector_inventory_state TO ${selectorServiceRole}`,
    `GRANT SELECT,INSERT ON selector_interaction TO ${selectorServiceRole}`,
    `GRANT SELECT,INSERT ON selector_interaction_resource TO ${selectorServiceRole}`,
    `GRANT SELECT,INSERT,UPDATE,DELETE ON selector_planning_intent TO ${selectorServiceRole}`,
    `GRANT SELECT,INSERT ON selector_proposal_delivery TO ${selectorServiceRole}`,
    `REVOKE ALL ON FUNCTION ${selectorClaimFunction}(integer),
         ${selectorReconcileClaimFunction}(integer),
         ${selectorDeliveryFunction}(text,text,text),
         ${selectorReviewFunction}(text,text,text,text,text,text,text),
         enforce_selector_proposal_initial_state() FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${selectorClaimFunction}(integer),
         ${selectorReconcileClaimFunction}(integer),
         ${selectorDeliveryFunction}(text,text,text) TO ${selectorServiceRole}`,
    `GRANT SELECT ON selector_proposal_delivery TO ${selectorReviewRole}`,
    `GRANT SELECT ON selector_proposal_review TO ${selectorReviewRole}`,
    `GRANT EXECUTE ON FUNCTION ${selectorReviewFunction}(text,text,text,text,text,text,text)
         TO ${selectorReviewRole}`,
  ],
};
