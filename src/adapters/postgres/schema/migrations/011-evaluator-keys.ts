import type { Migration } from "../shared.ts";

/**
 * A stage stops being a width and becomes the roster the width stood in for.
 * The `CreateTicket` payload's program carries a stage's own key and the
 * evaluators that stage runs, each named by a key of its own, where it used to
 * carry a count of identical ones.
 *
 * WHY THIS ONE OPENS WITH 008's GUARD TOO. A stored release names a fan-out
 * and names no evaluator, and the validator this image installs refuses a
 * payload shaped that way: the field is not optional here, it is gone, and an
 * entry whose bytes are what its digest attests cannot be rewritten into one
 * this machine admits. So a journal with rows in it comes up holding a ticket
 * the actor cannot replay, and installing the validator behind it would hide
 * that behind a schema that looks migrated. The guard refuses the migration
 * instead and names `deploy/rig/wipe-tickets.sql`, which is what empties the
 * journal it needs.
 *
 * AND `fanout` IS REFUSED FOR BEING NAMED RATHER THAN IGNORED FOR IT, which is
 * 009's move for 009's reason. Behind the wipe no stored entry carries it, so
 * the only writer that could name it is an image of the earlier vintage
 * pointed at a migrated database — and that writer means a width the machine
 * would now read as a stage with no evaluators in it at all. Refusing the
 * entry is what makes that loud at the mailbox rather than at a ticket that
 * ran an empty stage.
 *
 * A STAGE'S KEY IS ITS PLACE, AND THAT IS THIS TREE'S RULE RATHER THAN THE
 * PACKAGE'S, which asks only that stage keys be distinct. The identity a task
 * is spawned under names its stage by that key, and everything downstream that
 * has the key without the program in hand — the requirement an authored
 * configuration spells as a stage, the block a briefing selects, the one site
 * that turns the column back into an index — is correct only while the key and
 * the position agree. Holding them equal here is what lets that hold be stated
 * once instead of carried by each reader, and it is lifted when a stage's run
 * stores the index it was cut from. Distinctness needs no line of its own: a
 * list of positions is distinct because it is a list.
 *
 * EVALUATOR KEYS ARE NOT POSITIONAL, and the arm says so by asking only that
 * they be positive and distinct within their stage. A stage keyed `{1, 3}` is
 * well-formed, because a key is what an evaluator is called and not where it
 * was written down; the walk draws such stages, and an arm that demanded
 * `1..n` here would refuse a release the model proves.
 *
 * AND THE FLOORS ARE THE ARM'S HERE, WHERE 010 LEFT THEM TO THE COLUMNS. That
 * migration could hand positivity to a CHECK because a task's identity is
 * columns a constraint can see; a program is one document in one jsonb field,
 * so the mailbox is the only place a floor on what is inside it can be stated
 * at all. What stays out is the vocabulary's bound: how many stages a ticket
 * may hold and how far its evaluator keys may reach are the authoring's, which
 * weighs them against a configuration this function cannot read.
 *
 * AND THE SHAPE IS WEIGHED BEFORE THE VALUE, IN TWO STATEMENTS AND NOT ONE.
 * `jsonb_array_length` raises on a value that is not an array and a cast
 * raises on text that is not a number, and SQL promises no left-to-right
 * evaluation of an `OR` that would keep either out of reach. So asking that a
 * stage hold an array and an integer key is one statement, and reading them is
 * the next.
 *
 * NO DDL FOLLOWS, AND `execution_request_task.evaluator` IS WHY IT LOOKS LIKE
 * NONE IS NEEDED. That column carried an ordinal and now carries the authored
 * key, and both are positive, so the constraint holding it cannot tell the two
 * apart and has nothing to restate. `dispatch_candidate.program` is text the
 * wipe truncates, so the encoding of a stage in it travels with the
 * interpreter that writes it rather than with this schema.
 *
 * THE COMBINATOR IS CARRIED EXACTLY AS 010 CARRIES IT: absent or the one name
 * this machine has, because 005 deleted the choice and left the key readable
 * for the entries that still spelled it. This migration has no opinion about
 * it and changing the item's other fields is not a reason to acquire one.
 */

/**
 * How the generated codec spells a stage: a record of a list of records is a
 * plain object holding a plain array of plain objects. The evaluator's key and
 * the stage's are the same field name on two different records.
 */
const stageKeyField = "key";
const stageEvaluatorsField = "evaluators";
const evaluatorKeyField = "key";

export const migration011: Migration = {
  version: 11,
  name: "a stage names the evaluators it runs, and its key is its place",
  statements: [
    `DO $$
       BEGIN
         IF EXISTS (SELECT FROM public.journal_entry) THEN
           RAISE EXCEPTION 'this image replays no journal written before it; empty the journal with deploy/rig/wipe-tickets.sql first'
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
       END $$`,
    `CREATE OR REPLACE FUNCTION public.decision_event_is_valid(event jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
     DECLARE tag text; value jsonb; item jsonb; entry jsonb; place bigint;
       task jsonb; constructor text;
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
         task := value->'task'; constructor := COALESCE(task->>'type', '');
         RETURN jsonb_typeof(value) = 'object'
           AND command_integer(value->'ticket') AND NOT value ? 'tid'
           AND ((constructor = 'WorkTask'
                 AND command_integer(task->'value'->'ticket')
                 AND command_integer(task->'value'->'cycle'))
             OR (constructor = 'EvaluationTask'
                 AND command_integer(task->'value'->'ticket')
                 AND command_integer(task->'value'->'workCycle')
                 AND command_integer(task->'value'->'stage')
                 AND command_integer(task->'value'->'generation')
                 AND command_integer(task->'value'->'evaluator')))
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
       FOR item, place IN
         SELECT element, ordinality
           FROM jsonb_array_elements(value->'prog') WITH ORDINALITY AS elements(element, ordinality)
       LOOP
         IF jsonb_typeof(item) <> 'object' OR item ? 'fanout'
            OR NOT command_integer(item->'${stageKeyField}')
            OR jsonb_typeof(item->'${stageEvaluatorsField}') <> 'array'
            OR COALESCE(item->>'combinator', 'UnanimousPass') <> 'UnanimousPass' THEN
           RETURN false;
         END IF;
         IF (item->>'${stageKeyField}')::bigint <> place
            OR jsonb_array_length(item->'${stageEvaluatorsField}') < 1 THEN
           RETURN false;
         END IF;
         FOR entry IN SELECT element
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element) LOOP
           IF jsonb_typeof(entry) <> 'object'
              OR NOT command_integer(entry->'${evaluatorKeyField}') THEN
             RETURN false;
           END IF;
           IF (entry->>'${evaluatorKeyField}')::bigint < 1 THEN
             RETURN false;
           END IF;
         END LOOP;
         IF (SELECT count(DISTINCT element->'${evaluatorKeyField}')
               FROM jsonb_array_elements(item->'${stageEvaluatorsField}') AS elements(element))
            <> jsonb_array_length(item->'${stageEvaluatorsField}') THEN
           RETURN false;
         END IF;
       END LOOP;
       RETURN true;
     END $$;`,
  ],
};
