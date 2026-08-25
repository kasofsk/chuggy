import {
  allNativeActionKinds,
  allNativeActionResolutions,
  nativeActionResolutions,
} from "../../../../interpreter/ticketCommand.ts";
import { finalizationOutcomeTags } from "../../../../domain/generated/modelTypes.ts";
import {
  allFinalizationRequestKinds,
  finalizerIdentityCharsMax,
} from "../../../../interpreter/finalizer.ts";
import {
  acceptanceBody,
  publicCommandGrammarBody,
} from "./005-durable-prioritized-decision-mailbox.ts";
import { finalizationSubmissionBody } from "./013-durable-finalizer.ts";
import {
  boundaryOwnerRole,
  finalizationFunction,
  finalizerRole,
  schemaTextSet,
  type Migration,
} from "../shared.ts";

const pairing = allNativeActionKinds
  .map(
    (kind) =>
      `(asked = '${kind}' AND NEW.resolution IN (${schemaTextSet(nativeActionResolutions[kind])}))`,
  )
  .join("\n              OR ");

export const migration026: Migration = {
  version: 26,
  name: "post-promotion handoff recovery outcomes",
  statements: [
    `CREATE OR REPLACE ${acceptanceBody}`,
    `CREATE OR REPLACE FUNCTION public_ticket_command_is_valid${publicCommandGrammarBody}`,
    `ALTER TABLE finalization_request ADD COLUMN kind text NOT NULL DEFAULT 'RunFinalizer'`,
    `ALTER TABLE finalization_request ALTER COLUMN kind DROP DEFAULT,
       ADD CONSTRAINT finalization_request_kind_is_known CHECK (
         kind IN (${schemaTextSet(allFinalizationRequestKinds)}))`,
    `CREATE OR REPLACE FUNCTION ${finalizationSubmissionBody}`,
    `ALTER FUNCTION ${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${finalizationFunction}(text,text,text,text,text,text,bigint,text,text,text)
       TO ${finalizerRole}`,
    `CREATE OR REPLACE FUNCTION ticket_command_is_valid(command jsonb) RETURNS boolean
       LANGUAGE plpgsql IMMUTABLE AS $$
       BEGIN
         IF command IS NULL OR jsonb_typeof(command) <> 'object' THEN
           RETURN false;
         END IF;
         IF command->>'command' = 'SubmitFinalizationResult' THEN
           RETURN jsonb_typeof(command->'version') = 'number'
             AND command->>'version' = '1'
             AND jsonb_typeof(command->'request') = 'string'
             AND length(command->>'request') BETWEEN 1 AND ${finalizerIdentityCharsMax}
             AND jsonb_typeof(command->'attempt') = 'string'
             AND length(command->>'attempt') BETWEEN 1 AND ${finalizerIdentityCharsMax}
             AND command_integer(command->'requestGeneration')
             AND (command->>'requestGeneration')::numeric >= 1
             AND jsonb_typeof(command->'recoveryEpoch') = 'string'
             AND length(command->>'recoveryEpoch') BETWEEN 1 AND ${finalizerIdentityCharsMax}
             AND command->>'outcome' IN (${schemaTextSet(finalizationOutcomeTags)});
         END IF;
         RETURN public_ticket_command_is_valid(command)
           AND (command->>'command' <> 'Decide'
             OR command->'event'->>'type' NOT IN ('FinalizationResult', 'AbandonHandoff'));
       END $$`,
    `ALTER FUNCTION ticket_command_is_valid(jsonb) OWNER TO ${boundaryOwnerRole}`,
    `ALTER TABLE native_action
       DROP CONSTRAINT native_action_kind_is_known,
       DROP CONSTRAINT native_action_kind_names_its_capability,
       ADD CONSTRAINT native_action_kind_is_known CHECK (
         kind IN (${schemaTextSet(allNativeActionKinds)})),
       ADD CONSTRAINT native_action_kind_names_its_capability CHECK (
         (kind IN ('TicketEscalation', 'HandoffBlock')) =
           (required_capability = 'ResolveTicket')
         AND (kind = 'FinalizationApproval') =
           (required_capability = 'ApproveFinalization')
         AND (kind = 'FinalizationApproval') = (attempt IS NOT NULL))`,
    `ALTER TABLE native_action_resolution
       DROP CONSTRAINT native_action_resolution_is_known,
       ADD CONSTRAINT native_action_resolution_is_known CHECK (
         resolution IN (${schemaTextSet(allNativeActionResolutions)}))`,
    `CREATE OR REPLACE FUNCTION native_action_resolution_pairs_with_its_kind()
       RETURNS trigger LANGUAGE plpgsql AS $$
       DECLARE asked text;
       BEGIN
         SELECT n.kind INTO asked FROM native_action n
          WHERE n.tenant = NEW.tenant AND n.project = NEW.project
            AND n.action = NEW.action;
         IF NOT (${pairing}) THEN
           RAISE EXCEPTION '% is not an answer a % asks for', NEW.resolution, asked
             USING ERRCODE = 'integrity_constraint_violation';
         END IF;
         RETURN NEW;
       END $$`,
  ],
};
