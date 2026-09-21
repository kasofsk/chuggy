import type { Migration } from "../shared.ts";

/**
 * The accounts leave the schema: the gas, rework and finalization balances a
 * ticket was metered by, the pricing a release froze onto its dispatch
 * candidate, the deployment policy those were configured from, and the two
 * escalation reasons only a spent account could reach.
 *
 * THE GUARD IS THE FIRST STATEMENT BECAUSE A NARROWED CHECK IS NOT A NO-OP
 * OVER STORED ROWS. `ADD CONSTRAINT` revalidates what the relation already
 * holds, settled rows as much as live ones, so an installation that ever
 * parked a ticket at a removed wall would otherwise fail partway down this
 * list; it refuses at the top instead, naming the relations that hold the
 * rows, and the whole migration rolls back with its ledger row.
 *
 * `journal_entry` IS INSIDE THE GUARD, WHICH IS WHERE THIS DRAWS ITS LINE
 * DIFFERENTLY FROM THE HANDOFF REMOVAL. A journal entry is not a record that
 * is written and then left alone: the actor replays it under the current
 * deciders, and a history that reached a wall the machine no longer has cannot
 * be replayed at all. So the guard reads the two fields that say a step
 * reached one — the step record's own label, and the reason an
 * `ExecutionBlocked` event carried — rather than matching text anywhere in the
 * row, because a row that mentions a wall is not a row that reached it. The
 * cast stands behind `IS JSON OBJECT` as the `journal_entry_release_ticket`
 * index does, so a row that is not a document is not a cast failure.
 *
 * THE AUTHORING POLICY IS REWRITTEN RATHER THAN EMPTIED, AND RENDERED THE WAY
 * ITS WRITER RENDERS IT. The row is what a starting image compares its own
 * configuration against, so the retained keys are written back in the order
 * the domain configuration declares them — the order the encoder emits —
 * rather than left in whatever order dropping keys through `jsonb` would
 * produce, and a migrated installation holds the same text a fresh one
 * installs.
 */
export const migration004: Migration = {
  version: 4,
  name: "the accounts leave the schema",
  statements: [
    `DO $$
       DECLARE holders text;
       BEGIN
         SELECT string_agg(relation, ', ' ORDER BY relation) INTO holders FROM (
           SELECT 'ticket_projection' AS relation
            WHERE EXISTS (SELECT FROM public.ticket_projection
                           WHERE reason IN ('GasExhausted', 'FinalizationBudgetExhausted'))
           UNION ALL
           SELECT 'native_action'
            WHERE EXISTS (SELECT FROM public.native_action
                           WHERE reason IN ('GasExhausted', 'FinalizationBudgetExhausted'))
           UNION ALL
           SELECT 'journal_entry'
            WHERE EXISTS (SELECT FROM public.journal_entry
                           WHERE (CASE WHEN entry IS JSON OBJECT
                                       THEN entry::jsonb END)->'rec'->>'label'
                                 IN ('ticket-escalated gas_exhausted',
                                     'ticket-escalated finalization_budget_exhausted')
                              OR (CASE WHEN entry IS JSON OBJECT
                                       THEN entry::jsonb END)->'event'->'value'->>'reason'
                                 IN ('GasExhausted', 'FinalizationBudgetExhausted'))
         ) AS held;
         IF holders IS NOT NULL THEN
           RAISE EXCEPTION 'account rows remain in %', holders
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb;
     BEGIN
       IF event IS NULL OR jsonb_typeof(event) <> 'object'
          OR jsonb_typeof(event->'type') <> 'string' THEN
         RETURN false;
       END IF;
       tag := event->>'type'; value := event->'value';
       IF tag IN ('Revoke', 'Dispatch', 'ResumeTicket') THEN
         RETURN command_integer(value);
       END IF;
       IF tag = 'TaskDone' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND command_integer(value->'tid')
           AND value->>'verdict' IN ('Pass', 'Fail')
           AND jsonb_typeof(value->'result') = 'object'
           AND command_integer(value->'result'->'manifest')
           AND command_integer(value->'result'->'digest')
           AND command_integer(value->'result'->'schema');
       END IF;
       IF tag = 'FinalizationResult' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'out' IN ('FinalizationSucceeded', 'FinalizationFailed');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket')
           AND value->>'reason' IN ('NoReason', 'WorkFailed', 'ReworkBudgetExhausted',
             'DependencyRevoked', 'ExecutionPolicyDenied', 'TicketConfigIncompatible',
             'ExecutionProfileUnavailable', 'RuntimeVersionUnsupported',
             'RequiredCapabilityUnavailable');
       END IF;
       IF tag <> 'ReleaseTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR NOT command_integer(value->'workFanout')
          OR value->>'finalizer' NOT IN ('NoFinalizer', 'ManagedFinalizer') THEN
         RETURN false;
       END IF;
       IF (SELECT count(*) FROM jsonb_array_elements(value->'deps')) <>
          (SELECT count(DISTINCT element)
             FROM jsonb_array_elements(value->'deps') AS elements(element)) THEN
         RETURN false;
       END IF;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'deps') AS elements(element) LOOP
         IF NOT command_integer(item) THEN RETURN false; END IF;
       END LOOP;
       FOR item IN SELECT element FROM jsonb_array_elements(value->'prog') AS elements(element) LOOP
         IF jsonb_typeof(item) <> 'object' OR NOT command_integer(item->'fanout')
            OR item->>'combinator' NOT IN ('UnanimousPass', 'AnyPass') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
    `ALTER TABLE public.ticket_projection
       DROP CONSTRAINT ticket_projection_accounts_are_not_negative,
       DROP CONSTRAINT ticket_projection_accounts_are_whole,
       DROP COLUMN gas_left,
       DROP COLUMN rework_left,
       DROP COLUMN finalization_left,
       DROP CONSTRAINT ticket_projection_reason_is_known,
       ADD CONSTRAINT ticket_projection_reason_is_known CHECK ((reason = ANY (ARRAY['NoReason'::text, 'WorkFailed'::text, 'ReworkBudgetExhausted'::text, 'DependencyRevoked'::text, 'ExecutionPolicyDenied'::text, 'TicketConfigIncompatible'::text, 'ExecutionProfileUnavailable'::text, 'RuntimeVersionUnsupported'::text, 'RequiredCapabilityUnavailable'::text])))`,
    `ALTER TABLE public.native_action
       DROP CONSTRAINT native_action_reason_check,
       ADD CONSTRAINT native_action_reason_check CHECK ((reason = ANY (ARRAY['NoReason'::text, 'WorkFailed'::text, 'ReworkBudgetExhausted'::text, 'DependencyRevoked'::text, 'ExecutionPolicyDenied'::text, 'TicketConfigIncompatible'::text, 'ExecutionProfileUnavailable'::text, 'RuntimeVersionUnsupported'::text, 'RequiredCapabilityUnavailable'::text])))`,
    `ALTER TABLE public.dispatch_candidate
       DROP COLUMN rework_policy,
       DROP COLUMN finalization_pricing,
       DROP COLUMN resume_pricing`,
    `UPDATE public.deployment_authoring_policy
        SET domain_configuration = format('{"nTickets":%s,"nTasks":%s,"maxStages":%s}',
              domain_configuration::jsonb->>'nTickets',
              domain_configuration::jsonb->>'nTasks',
              domain_configuration::jsonb->>'maxStages')`,
  ],
};
