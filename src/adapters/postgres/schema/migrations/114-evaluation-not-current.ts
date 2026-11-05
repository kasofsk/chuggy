/**
 * An abandoned evaluation that is no longer the ticket's current one is
 * refused as `EvaluationNotCurrent`, carrying its ticket and work cycle.
 *
 * `decision_refusal_is_valid` IS REPLACED and both constraints on
 * `decision_input` are, admitting the code beside every one 085 admitted, so
 * no stored row is refused by the new constraints. The function body is 085's
 * with the one branch added, written out so this file goes on saying what it
 * installed.
 */

import type { Migration } from "../shared.ts";
import {
  boundaryRefusals,
  dependencyRefusals,
  domainRefusals as domainRefusalsAt085,
  textArray,
  textList,
  ticketRefusals,
} from "./085-dependencies-change.ts";

/** Every refusal the machine decides, each stored with its payload. */
const domainRefusals = [...domainRefusalsAt085, "EvaluationNotCurrent"];

/** The predicate `decision_input_refusal_is_its_outcome` holds a stored refusal to, by its code. */
const refusalValidator = `CREATE OR REPLACE FUNCTION public.decision_refusal_is_valid(code text, refusal text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE value jsonb; item jsonb;
     BEGIN
       IF code IS NULL OR refusal IS NULL OR NOT (refusal IS JSON OBJECT) THEN
         RETURN false;
       END IF;
       IF (refusal::jsonb)->>'type' IS DISTINCT FROM code THEN
         RETURN false;
       END IF;
       value := (refusal::jsonb)->'value';
       IF code IN (${textList(ticketRefusals)}) THEN
         RETURN command_reference(value);
       END IF;
       IF jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR NOT command_reference(value->'ticket') THEN
         RETURN false;
       END IF;
       IF code IN (${textList(dependencyRefusals)}) THEN
         IF jsonb_typeof(value->'dependencies') IS DISTINCT FROM 'array'
            OR jsonb_array_length(value->'dependencies') < 1
            OR (SELECT count(DISTINCT element)
                  FROM jsonb_array_elements(value->'dependencies') AS elements(element))
               <> jsonb_array_length(value->'dependencies') THEN
           RETURN false;
         END IF;
         FOR item IN SELECT element
               FROM jsonb_array_elements(value->'dependencies') AS elements(element) LOOP
           IF NOT command_reference(item) THEN RETURN false; END IF;
         END LOOP;
         RETURN true;
       END IF;
       IF code = 'TicketRevisionStale' THEN
         RETURN command_reference(value->'expected')
           AND command_reference(value->'current');
       END IF;
       IF code = 'TaskNotCurrent' THEN
         RETURN task_identity_is_valid(value->'task');
       END IF;
       IF code = 'EvaluationNotCurrent' THEN
         RETURN command_reference(value->'workCycle');
       END IF;
       IF code = 'FinalizationNotCurrent' THEN
         RETURN command_reference(value->'workCycle')
           AND command_reference(value->'generation');
       END IF;
       RETURN false;
     END $$`;

export const migration114: Migration = {
  version: 114,
  name: "an abandoned evaluation that is not the current one is refused EvaluationNotCurrent",
  statements: [
    refusalValidator,
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])})))),
       DROP CONSTRAINT decision_input_refusal_is_its_outcome,
       ADD CONSTRAINT decision_input_refusal_is_its_outcome CHECK ((
CASE
    WHEN (outcome_code = ANY (${textArray(domainRefusals)})) THEN (decision_refusal_is_valid(outcome_code, refusal) IS TRUE)
    ELSE (refusal IS NULL)
END))`,
  ],
};
