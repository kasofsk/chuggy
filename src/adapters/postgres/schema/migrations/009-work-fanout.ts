import type { Migration } from "../shared.ts";

/**
 * A work set is one task, so there is no width to author. The `CreateTicket`
 * payload loses `workFanout`, and `dispatch_candidate` stops publishing the
 * `work_fanout` an author chose.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD TOO. A stored release names a fan-out,
 * and the validator this image installs refuses a payload that does — the
 * field is not optional here, it is gone, and an entry whose bytes are what
 * its digest attests cannot be rewritten into one this machine admits. So a
 * journal with rows in it comes up holding a ticket the actor cannot replay,
 * and dropping the column behind it would hide that behind a schema that looks
 * migrated. The guard refuses the migration instead and names
 * `deploy/rig/wipe-tickets.sql`, which is what empties the journal it needs.
 *
 * AND WHY THE PAYLOAD IS REFUSED FOR NAMING THE FIELD RATHER THAN IGNORED FOR
 * IT. 005 let the keys it deleted fall out of the validator, because entries
 * carrying them were still in the journal and had to keep validating. Behind
 * the wipe nobody's history carries this one, so the only writer that could
 * name it is an image of the earlier vintage pointed at a migrated database —
 * and that writer means a width the machine would silently spend as one task.
 * Refusing the entry is what makes that loud at the mailbox rather than at a
 * ticket that ran narrower than it was released.
 *
 * THE CANDIDATE'S CHECK LEAVES AND COMES BACK. `dispatch_candidate_check` is
 * one constraint over the ticket, the version and the width, and dropping a
 * column drops every constraint naming it — so the two floors that are left
 * would go with the width and nothing would say so. It is dropped by name and
 * written again carrying them.
 *
 * NO GRANT FOLLOWS THE COLUMN OUT. The api role reads this relation and the
 * ticket-service role writes it, both by table rather than by column
 * (`baseline/privileges.ts`), so a column leaving takes no privilege with it —
 * unlike 008's projection, where the grants are per column and a new one
 * arrives ungranted until a line says otherwise.
 *
 * THE MAILBOX BOUND IS NARROWED BECAUSE A CANDIDATE NOW WEIGHS LESS, which is
 * 005's move made again for the same reason: the widest observation one lead
 * turn may be given is a sum over the parts, and a dispatch candidate that no
 * longer carries a width shrinks it, so the row that must hold one is
 * re-rendered at the new figure and the budget seeded from it re-seeded.
 *
 * A NARROWED LENGTH CHECK REVALIDATES STORED ROWS, so a second guard holds a
 * `session_turn` arm at the new figure, as 004 and 005 each held one at
 * theirs. It stands beside the journal's rather than inside it, so each
 * refusal names the relation holding the rows it means; the wipe above empties
 * both.
 */

/**
 * What this migration renders `sessionTurnInputCharsMax` as, in the mailbox
 * bound it re-renders and in the observation budget it re-seeds.
 */
export const leadObservationTokensPerDecisionAt009 = 17_360_363;

export const migration009: Migration = {
  version: 9,
  name: "a work set is one task, so a ticket authors no fan-out",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `ALTER TABLE public.dispatch_candidate
       DROP CONSTRAINT dispatch_candidate_check,
       DROP COLUMN work_fanout,
       ADD CONSTRAINT dispatch_candidate_check CHECK (((ticket >= 1) AND (ticket_version >= 1)))`,
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
           AND value->>'out' IN ('FinalizationSucceeded',
             'FinalizationNeedsWork', 'FinalizationResultUnavailable');
       END IF;
       IF tag = 'ExecutionBlocked' THEN
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket');
       END IF;
       IF tag <> 'CreateTicket' OR jsonb_typeof(value) <> 'object'
          OR NOT command_integer(value->'ticket')
          OR jsonb_typeof(value->'deps') <> 'array'
          OR jsonb_typeof(value->'prog') <> 'array'
          OR value ? 'workFanout'
          OR COALESCE(value->>'finalizer', 'ManagedFinalizer') <> 'ManagedFinalizer' THEN
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
            OR COALESCE(item->>'combinator', 'UnanimousPass') <> 'UnanimousPass' THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.session_turn
                     WHERE length(input) > 17360363) THEN
           RAISE EXCEPTION 'rows this migration no longer admits remain in session_turn'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `ALTER TABLE public.session_turn
       DROP CONSTRAINT session_turn_text_is_bounded,
       ADD CONSTRAINT session_turn_text_is_bounded CHECK ((((length(input) >= 1) AND (length(input) <= 17360363)) AND (COALESCE(length(result), 0) <= 65536)))`,
    `UPDATE public.selector_runtime_settings
        SET controls = replace(controls, '"tokensPerDecision":17363763', '"tokensPerDecision":17360363')`,
    `UPDATE public.selector_runtime_settings_history
        SET controls = replace(controls, '"tokensPerDecision":17363763', '"tokensPerDecision":17360363')`,
  ],
};
