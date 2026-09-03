/**
 * A delivery is keyed by the decision that asked for it and the ticket it
 * carries, and a project says how many tickets one decision may dispatch.
 *
 * BOTH HALVES ARE ONE MIGRATION because both are the storage of one change. A
 * relation rekeyed without the control would let a decision write rows nothing
 * bounds, and a control written without the rekey would bound a number the
 * relation cannot hold; a half-applied pair is a state nothing reads correctly.
 *
 * THE BACKFILL IS TOTAL BECAUSE THE COMMAND ALWAYS NAMES THE TICKET. Every row
 * of this relation was written from a `ProposeDispatch`, whose `ticket` the
 * dispatch acceptance definer refuses a command without, and the adapter has
 * been reading the ticket out of that same command since before this column
 * existed — so the column the key moves to is filled from the expression the
 * reader already used, and a row that could not be read afterwards could not
 * have been read before.
 *
 * `operation` KEEPS ITS UNIQUE. One operation still names one delivery row,
 * which is what lets reconciliation settle one row from one operation outcome;
 * the operation a decision's dispatch of a ticket is submitted under is derived
 * per ticket, so the two keys agree without either being the other.
 *
 * A CLAIM NAMES A ROW AND NOT A DECISION. The claim functions selected rows by
 * `selector_decision`, which was a key and is now a prefix: left alone, one
 * claimable row would claim, charge an attempt to and defer every sibling row
 * of its decision. Both claims name the whole key, and both order by it, so a
 * page under contention is a total order rather than an arbitrary one.
 *
 * A FUNCTION RE-CREATED WITHOUT ITS REVOKE IS PUBLIC-EXECUTABLE. Three of these
 * change signature, so each is dropped and created rather than replaced, and
 * dropping takes the owner, the revoke and every grant with it. All three are
 * re-issued below and each is asserted by a case of its own, because this is
 * the defect this tree has already found twice.
 *
 * `review_selector_proposal` IS NOT RE-CREATED. Its arms already update every
 * `AwaitingApproval` row of a decision and its signature does not move, so
 * dropping it would put its grants at risk to change nothing. A review is of
 * the decision — one row in `selector_proposal_review`, one feedback item the
 * lead reads — and the cases below assert that over a decision holding several
 * rows rather than leaving it to a reader of the old body.
 *
 * THE INSTALLATION DEFAULT IS A FLOOR AND NOT A VALUE, as the two migrations
 * that last moved these controls also had it: an installation that already
 * states a wider budget keeps what it states, and the revision the raise mints
 * is recorded like every other. The floor is written from the constant the
 * TypeScript side reads rather than by re-typing the controls literal, which
 * would drift from it the first time either moved.
 */

import {
  apiRole,
  boundaryOwnerRole,
  selectorClaimFunction,
  selectorControlRole,
  selectorDeliveryFunction,
  selectorProjectSettingsFunction,
  selectorReconcileClaimFunction,
  selectorServiceRole,
  type Migration,
} from "../shared.ts";

/**
 * What an installation dispatches per decision until an owner says otherwise.
 * It is the installation default and not the ceiling: `leadDispatchesMax`
 * bounds what any project may ask for, and this is what one gets without
 * asking.
 */
export const leadDispatchesPerDecision = 3;

/**
 * One row per ticket, under the decision that asked for it. The key is what
 * requires the column, so nothing declares it `NOT NULL` beside the key: a
 * second declaration of the same property is a second thing to keep true, and
 * an untotal backfill is refused by the key either way.
 */
const deliveryPerTicket = [
  `ALTER TABLE selector_proposal_delivery ADD COLUMN ticket bigint`,
  `UPDATE selector_proposal_delivery SET ticket=(command::jsonb->>'ticket')::bigint`,
  `ALTER TABLE selector_proposal_delivery
     ADD CONSTRAINT selector_proposal_ticket_is_positive CHECK (ticket >= 1),
     DROP CONSTRAINT selector_proposal_delivery_pkey,
     ADD CONSTRAINT selector_proposal_delivery_pkey
       PRIMARY KEY (selector_decision,ticket)`,
];

const claimArguments = "integer";
const claimColumns = `selector_decision text,ticket bigint,tenant text,
       project text,operation text,command text,attempts bigint`;

/**
 * The two claims, each naming the whole key. The delivery claim's order gains
 * the ticket because `retry_at` alone leaves the rows of one decision written
 * in one statement ordered by nothing at all.
 */
const claimsNameTheWholeKey = [
  `DROP FUNCTION ${selectorClaimFunction}(${claimArguments})`,
  `CREATE FUNCTION ${selectorClaimFunction}(delivery_limit integer)
     RETURNS TABLE(${claimColumns})
     LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       UPDATE selector_proposal_delivery delivery
         SET attempts=delivery.attempts+1,retry_at=now()+interval '30 seconds'
       WHERE (delivery.selector_decision,delivery.ticket) IN (
         SELECT candidate.selector_decision,candidate.ticket
           FROM selector_proposal_delivery candidate
         WHERE candidate.state='Pending' AND candidate.retry_at<=now()
         ORDER BY candidate.retry_at,candidate.selector_decision,candidate.ticket
         LIMIT CASE WHEN delivery_limit BETWEEN 1 AND 100 THEN delivery_limit ELSE 0 END
         FOR UPDATE SKIP LOCKED)
       RETURNING delivery.selector_decision,delivery.ticket,delivery.tenant,
         delivery.project,delivery.operation,delivery.command,delivery.attempts
     $$`,
  `ALTER FUNCTION ${selectorClaimFunction}(${claimArguments})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorClaimFunction}(${claimArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorClaimFunction}(${claimArguments})
     TO ${selectorServiceRole}`,
  `DROP FUNCTION ${selectorReconcileClaimFunction}(${claimArguments})`,
  `CREATE FUNCTION ${selectorReconcileClaimFunction}(delivery_limit integer)
     RETURNS TABLE(${claimColumns})
     LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       UPDATE selector_proposal_delivery delivery
         SET reconciliation_attempts=delivery.reconciliation_attempts+1,
             reconcile_at=now()+interval '30 seconds'
       WHERE (delivery.selector_decision,delivery.ticket) IN (
         SELECT candidate.selector_decision,candidate.ticket
           FROM selector_proposal_delivery candidate
         WHERE candidate.state='Submitted'
           AND coalesce(candidate.reconcile_at,'-infinity'::timestamptz)<=now()
         ORDER BY coalesce(candidate.reconcile_at,'-infinity'::timestamptz),
           candidate.selector_decision,candidate.ticket
         LIMIT CASE WHEN delivery_limit BETWEEN 1 AND 100 THEN delivery_limit ELSE 0 END
         FOR UPDATE SKIP LOCKED)
       RETURNING delivery.selector_decision,delivery.ticket,delivery.tenant,
         delivery.project,delivery.operation,delivery.command,
         delivery.reconciliation_attempts AS attempts
     $$`,
  `ALTER FUNCTION ${selectorReconcileClaimFunction}(${claimArguments})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorReconcileClaimFunction}(${claimArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorReconcileClaimFunction}(${claimArguments})
     TO ${selectorServiceRole}`,
];

const advanceArguments = "text,bigint,text,text";

/**
 * One delivery settles alone. Its arms carried only the decision, which under
 * the new key would move every row of a decision on one row's answer — and
 * losing the others is exactly what partial failure must not do.
 */
const settlementNamesItsTicket = [
  `DROP FUNCTION ${selectorDeliveryFunction}(text,text,text)`,
  `CREATE FUNCTION ${selectorDeliveryFunction}(
     in_decision text,in_ticket bigint,in_transition text,in_outcome text)
     RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       IF in_transition='Submitted' THEN
         UPDATE selector_proposal_delivery SET state='Submitted',reconcile_at=now()
           WHERE selector_decision=in_decision AND ticket=in_ticket
             AND state='Pending';
       ELSIF in_transition='Terminal' THEN
         UPDATE selector_proposal_delivery SET state='Terminal',outcome=in_outcome,
           reconcile_at=NULL
           WHERE selector_decision=in_decision AND ticket=in_ticket
             AND state IN ('Pending','Submitted');
       ELSE RAISE EXCEPTION 'invalid selector delivery transition';
       END IF;
       RETURN FOUND;
     END $$`,
  `ALTER FUNCTION ${selectorDeliveryFunction}(${advanceArguments})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorDeliveryFunction}(${advanceArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorDeliveryFunction}(${advanceArguments})
     TO ${selectorServiceRole}`,
];

/**
 * The column a project holds its own dispatch budget in, and the history
 * beside it. The history takes no check of its own, as none of the five limit
 * columns beside it does: its only writer copies a row the settings table has
 * already answered for, and a constraint whose writer cannot violate it is a
 * second statement of one property rather than a second guard.
 */
const projectDispatchBudget = [
  `ALTER TABLE selector_project_settings
     ADD COLUMN dispatches_per_decision bigint,
     ADD CONSTRAINT selector_project_dispatches_are_positive CHECK (
       dispatches_per_decision IS NULL OR dispatches_per_decision >= 1)`,
  `ALTER TABLE selector_project_settings_history
     ADD COLUMN dispatches_per_decision bigint`,
];

const projectSettingsArguments =
  "text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text";

/** What a write answers with: the project's own columns beside the defaults they fall back to. */
const projectSettingsColumns = `
       revision bigint,north_star text,mode text,dispatch_mode text,
       base_prompt text,model_allowlist text,tool_allowlist text,
       tokens_per_decision bigint,milliseconds_per_decision bigint,
       tool_calls_per_decision bigint,dispatches_per_decision bigint,
       input_bytes_per_decision bigint,
       candidate_pages_per_decision bigint,operational_context_max_age_ms bigint,
       installation_revision bigint,installation_mode text,
       installation_dispatch_mode text,installation_base_prompt text,
       installation_controls text`;

/** The written row read back at the revision this write produced, and no later one. */
const projectSettingsProjection = `
  SELECT settings.revision,settings.north_star,settings.mode,settings.dispatch_mode,
         settings.base_prompt,settings.model_allowlist,settings.tool_allowlist,
         settings.tokens_per_decision,settings.milliseconds_per_decision,
         settings.tool_calls_per_decision,settings.dispatches_per_decision,
         settings.input_bytes_per_decision,
         settings.candidate_pages_per_decision,
         settings.operational_context_max_age_ms,installation.revision,
         installation.mode,installation.dispatch_mode,installation.base_prompt,
         installation.controls
    FROM selector_project_settings settings
    CROSS JOIN selector_runtime_settings installation
   WHERE settings.tenant=in_tenant AND settings.project=in_project
     AND settings.revision=written AND installation.singleton=1`;

/**
 * The write, widened by one column. Its shape is the one its own migration
 * argues and nothing here changes it: a write still replaces the whole override
 * set under an advisory lock on the project, and clearing this override is the
 * same statement as setting it.
 */
const projectSettingsWriteTakesTheBudget = [
  `DROP FUNCTION ${selectorProjectSettingsFunction}(
     text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,text,text)`,
  `CREATE FUNCTION ${selectorProjectSettingsFunction}(
     in_tenant text,in_project text,expected_revision bigint,
     new_north_star text,new_mode text,new_dispatch_mode text,new_base_prompt text,
     new_model_allowlist text,new_tool_allowlist text,
     new_tokens_per_decision bigint,new_milliseconds_per_decision bigint,
     new_tool_calls_per_decision bigint,new_dispatches_per_decision bigint,
     new_input_bytes_per_decision bigint,
     new_candidate_pages_per_decision bigint,new_operational_context_max_age_ms bigint,
     in_administrator_kind text,in_administrator_subject text)
     RETURNS TABLE(${projectSettingsColumns})
     LANGUAGE plpgsql SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE written bigint; standing bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended(
         'selector-settings:'||length(in_tenant)||':'||in_tenant||in_project,0));
       SELECT settings.revision INTO standing FROM selector_project_settings settings
         WHERE settings.tenant=in_tenant AND settings.project=in_project;
       IF coalesce(standing,0)<>expected_revision THEN RETURN; END IF;
       IF expected_revision=0 THEN
         INSERT INTO selector_project_settings
           (tenant,project,revision,north_star,mode,dispatch_mode,base_prompt,
            model_allowlist,tool_allowlist,tokens_per_decision,
            milliseconds_per_decision,tool_calls_per_decision,
            dispatches_per_decision,input_bytes_per_decision,
            candidate_pages_per_decision,operational_context_max_age_ms)
           VALUES (in_tenant,in_project,1,new_north_star,new_mode,new_dispatch_mode,
            new_base_prompt,new_model_allowlist,new_tool_allowlist,
            new_tokens_per_decision,new_milliseconds_per_decision,
            new_tool_calls_per_decision,new_dispatches_per_decision,
            new_input_bytes_per_decision,
            new_candidate_pages_per_decision,new_operational_context_max_age_ms)
           RETURNING selector_project_settings.revision INTO written;
       ELSE
         UPDATE selector_project_settings SET revision=selector_project_settings.revision+1,
           north_star=new_north_star,mode=new_mode,dispatch_mode=new_dispatch_mode,
           base_prompt=new_base_prompt,model_allowlist=new_model_allowlist,
           tool_allowlist=new_tool_allowlist,tokens_per_decision=new_tokens_per_decision,
           milliseconds_per_decision=new_milliseconds_per_decision,
           tool_calls_per_decision=new_tool_calls_per_decision,
           dispatches_per_decision=new_dispatches_per_decision,
           input_bytes_per_decision=new_input_bytes_per_decision,
           candidate_pages_per_decision=new_candidate_pages_per_decision,
           operational_context_max_age_ms=new_operational_context_max_age_ms,
           updated_at=now()
         WHERE tenant=in_tenant AND project=in_project
           AND selector_project_settings.revision=expected_revision
         RETURNING selector_project_settings.revision INTO written;
       END IF;
       IF written IS NULL THEN RETURN; END IF;
       INSERT INTO selector_project_settings_history
         (tenant,project,revision,north_star,mode,dispatch_mode,base_prompt,
          model_allowlist,tool_allowlist,tokens_per_decision,
          milliseconds_per_decision,tool_calls_per_decision,
          dispatches_per_decision,input_bytes_per_decision,
          candidate_pages_per_decision,operational_context_max_age_ms,
          administrator_kind,administrator_subject)
         SELECT settings.tenant,settings.project,settings.revision,settings.north_star,
           settings.mode,settings.dispatch_mode,settings.base_prompt,
           settings.model_allowlist,settings.tool_allowlist,settings.tokens_per_decision,
           settings.milliseconds_per_decision,settings.tool_calls_per_decision,
           settings.dispatches_per_decision,settings.input_bytes_per_decision,
           settings.candidate_pages_per_decision,
           settings.operational_context_max_age_ms,in_administrator_kind,
           in_administrator_subject
           FROM selector_project_settings settings
          WHERE settings.tenant=in_tenant AND settings.project=in_project;
       RETURN QUERY ${projectSettingsProjection};
     END $$`,
  `ALTER FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArguments})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArguments}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${selectorProjectSettingsFunction}(${projectSettingsArguments})
     TO ${apiRole},${selectorControlRole}`,
];

/** The installation's dispatch budget, raised to what a lead turn may ask for. */
const installationDispatchBudget = [
  `UPDATE selector_runtime_settings
      SET controls=jsonb_set(controls::jsonb,'{limits,dispatchesPerDecision}',
            to_jsonb(greatest(
              coalesce((controls::jsonb->'limits'->>'dispatchesPerDecision')::bigint,0),
              ${leadDispatchesPerDecision}::bigint)))::text,
          revision=revision+1,updated_at=now()
    WHERE singleton=1
      AND coalesce((controls::jsonb->'limits'->>'dispatchesPerDecision')::bigint,0)
            < ${leadDispatchesPerDecision}`,
  `INSERT INTO selector_runtime_settings_history
     (revision,mode,dispatch_mode,base_prompt,controls,
      administrator_kind,administrator_subject)
     SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','lead dispatch migration'
       FROM selector_runtime_settings ON CONFLICT (revision) DO NOTHING`,
];

/** A delivery per ticket, and the budget a project bounds its decisions by. */
export const migration064: Migration = {
  version: 64,
  name: "a delivery is one decision's dispatch of one ticket",
  statements: [
    ...deliveryPerTicket,
    ...claimsNameTheWholeKey,
    ...settlementNamesItsTicket,
    ...projectDispatchBudget,
    ...projectSettingsWriteTakesTheBudget,
    ...installationDispatchBudget,
  ],
};
