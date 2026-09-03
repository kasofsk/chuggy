/**
 * What a session may hold, what it was told to be, and the two reads its tools
 * and its placement need.
 *
 * A GENERATED CHECK IS REPLACED WHERE IT WAS LAST WRITTEN. 058 generated
 * `agent_session_capabilities_are_known` from `allSessionCapabilities`, and the
 * roster has since grown the three the chuggy tools are admitted by. A fresh
 * installation therefore already holds the wide check and one that ran 058
 * before those members existed holds the narrow one for ever, so replacing it
 * here is what makes a migrated database and a fresh one end the same. The
 * device is 059's, twice over, and the reason has not changed.
 *
 * THE PROMPT IS A COLUMN AND NOT A TURN'S INPUT. A lead was told what it is
 * inside every observation, which spends the mailbox's own budget on text that
 * never changes; it moves to the session row, where the pod reads it once and
 * the agent runtime records it for the conversation. It is the one field of the
 * row a later write may move — `agent_session_is_written_once` freezes a named
 * list and this column is deliberately not on it — because objectives an owner
 * edits must be able to reach the next session that opens.
 *
 * THE COLUMN'S BOUND IS THE WIDEST KIND'S. `agentSessionPromptCharsMax` is the
 * maximum over the per-kind ceilings the contract declares, which today is the
 * lead's alone; a kind that composes a longer prompt widens it, and the
 * migration that adds that kind must replace this check exactly as this one
 * replaces 058's — a bound generated from a roster is only true where it was
 * last written.
 *
 * ONE DOOR RESOLVES THE LEAD ITSELF. `set_session_system_prompt` takes a
 * project and not a session, exactly as `enqueue_lead_turn` does: a role that
 * could name any session could rewrite a member's thread prompt, and the
 * selector's role is the only one granted this.
 *
 * `read_project_drafts` IS A BOUNDED READ AND NOT A NEW BOUNDARY. The API
 * already holds `SELECT` on the authoring relations (007), so this function
 * gives it nothing it could not write for itself; what it gives is one page
 * shape both the one-draft read and the page read answer in, bounded by the
 * wire's own page maximum. Saying that here is the point: a definer described
 * as a control it is not, is worse than none.
 *
 * THE SEEDED `toolAllowlist` STOPS ADMITTING EVERYTHING. `["*"]` was written
 * for a policy that held no tools, and `enforcePolicyControls` admits anything
 * against it, so a lead with a roster would be judged by a control that checked
 * nothing. The allowlist is narrowed to the lead's own roster and only where it
 * is still the seeded wildcard: a list an owner has already written is theirs.
 */

import {
  agentSessionPromptCharsMax,
  nativeHttpPageItemsMax,
} from "../../../../contract/http.ts";
import {
  allSessionCapabilities,
  sessionCapabilitiesMax,
} from "../../../../interpreter/agentSession.ts";
import { leadToolAllowlist } from "../../../../interpreter/leadTools.ts";
import {
  apiRole,
  boundaryOwnerRole,
  projectDraftsReadFunction,
  repositoryBindingReadFunction,
  schedulerRole,
  schemaTextSet,
  selectorServiceRole,
  sessionAttemptReadFunction,
  sessionOpenFunction,
  sessionSystemPromptSetFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** What one lead turn may spend on tools, where the seeded row was written for a policy with none. */
export const leadToolCallsPerDecision = 200;

/** The objectives door's argument types, which its grant and its callers share. */
export const systemPromptSetSignature = "text,text,text";

/** The signature 058 opened a session under, and the one this migration retypes it to. */
const openSignature = "text,text,text,text,text,text,text[],text";
const promptedOpenSignature = `${openSignature},text`;

/** The bound a session's own key columns are matched against one function's arguments. */
const sessionArguments =
  "tenant=in_tenant AND project=in_project AND session=in_session";

/**
 * The capability check regenerated over the widened roster. It is written here
 * exactly as 058 renders it, so the constraint a migrated installation ends
 * with is the one a fresh generation writes.
 */
const widenedCapabilities = [
  `ALTER TABLE agent_session
     DROP CONSTRAINT agent_session_capabilities_are_known,
     ADD CONSTRAINT agent_session_capabilities_are_known CHECK (
       cardinality(capabilities) BETWEEN 0 AND ${sessionCapabilitiesMax}
       AND capabilities <@ ARRAY[${schemaTextSet([
         ...allSessionCapabilities,
       ])}]::text[])`,
];

/**
 * The objectives a session is opened with and a later turn may move, and the
 * one door that moves them.
 */
const systemPrompt = [
  `ALTER TABLE agent_session ADD COLUMN system_prompt text`,
  `ALTER TABLE agent_session ADD CONSTRAINT agent_session_prompt_is_bounded
     CHECK (system_prompt IS NULL
            OR length(system_prompt) BETWEEN 1 AND ${agentSessionPromptCharsMax})`,
  `GRANT UPDATE (system_prompt) ON agent_session TO ${boundaryOwnerRole}`,
  `DROP FUNCTION ${sessionOpenFunction}(${openSignature})`,
  `CREATE FUNCTION ${sessionOpenFunction}(
     in_tenant text,in_project text,in_session text,in_kind text,in_principal text,
     in_parent text,in_capabilities text[],in_credential_slot text,
     in_system_prompt text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record; drawn record;
     BEGIN
       SELECT s.kind,s.principal,s.parent_session,s.capabilities,s.credential_slot,
              s.system_prompt,s.state
         INTO held FROM agent_session s WHERE s.${sessionArguments} FOR UPDATE;
       IF FOUND THEN
         RETURN CASE WHEN held.state='Open' AND held.kind=in_kind
                      AND held.principal=in_principal
                      AND held.parent_session IS NOT DISTINCT FROM in_parent
                      AND held.capabilities IS NOT DISTINCT FROM in_capabilities
                      AND held.credential_slot=in_credential_slot
                      AND held.system_prompt IS NOT DISTINCT FROM in_system_prompt
                     THEN 'AlreadyOpen' ELSE 'Conflict' END;
       END IF;
       IF in_kind='Lead' AND EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead') THEN
         RETURN 'Conflict';
       END IF;
       IF in_kind='Thread' AND EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
              AND s.principal=in_principal AND s.state='Open') THEN
         RETURN 'Conflict';
       END IF;
       IF in_kind='Inquiry' AND NOT EXISTS(SELECT 1 FROM agent_session s
            WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_parent) THEN
         RETURN 'Conflict';
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       INSERT INTO agent_session
         (tenant,project,session,kind,principal,parent_session,capabilities,
          credential_slot,account,cluster,system_prompt)
       VALUES(in_tenant,in_project,in_session,in_kind,in_principal,in_parent,
              in_capabilities,in_credential_slot,drawn.account,drawn.cluster,
              in_system_prompt);
       RETURN 'Opened';
     END $$`,
  `ALTER FUNCTION ${sessionOpenFunction}(${promptedOpenSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionOpenFunction}(${promptedOpenSignature})
     FROM PUBLIC`,
  `CREATE FUNCTION ${sessionSystemPromptSetFunction}(
     in_tenant text,in_project text,in_prompt text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record;
     BEGIN
       SELECT s.session,s.system_prompt INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Lead'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoLead'; END IF;
       IF held.system_prompt IS NOT DISTINCT FROM in_prompt THEN
         RETURN 'Unchanged';
       END IF;
       UPDATE agent_session s SET system_prompt=in_prompt
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=held.session;
       RETURN 'Set';
     END $$`,
  `ALTER FUNCTION ${sessionSystemPromptSetFunction}(${systemPromptSetSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionSystemPromptSetFunction}(${systemPromptSetSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionSystemPromptSetFunction}(${systemPromptSetSignature})
     TO ${selectorServiceRole}`,
];

/**
 * The facts a pod is answered with, retyped rather than widened, which a
 * changed return type is. Nothing else about it moves.
 */
const promptedSessionFacts = [
  `DROP FUNCTION ${sessionAttemptReadFunction}(text)`,
  `CREATE FUNCTION ${sessionAttemptReadFunction}(in_secret_digest text)
     RETURNS TABLE(tenant text,project text,session text,attempt text,generation bigint,
                   kind text,principal text,capabilities text[],credential_slot text,
                   agent_reference text,system_prompt text,live boolean)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              s.capabilities,s.credential_slot,s.agent_reference,s.system_prompt,
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`,
  `ALTER FUNCTION ${sessionAttemptReadFunction}(text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionAttemptReadFunction}(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionAttemptReadFunction}(text)
     TO ${workerPlaneRole}`,
];

/**
 * One page of the drafts a project still holds open, ascending by ticket. Only
 * `Draft` rows are answered: a released draft is a ticket and is read as one,
 * and a deleted one is gone.
 */
const projectDrafts = [
  `CREATE FUNCTION ${projectDraftsReadFunction}(
     in_tenant text,in_project text,in_after bigint,in_max bigint)
     RETURNS TABLE(ticket bigint,authoring_version bigint,state text,
                   configuration_revision text,authoring text,
                   intent text,branch text,finalization_mode text,
                   finalization_target text,links text[],checks text[],
                   version_name text,version_number bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT d.ticket,d.authoring_version,d.state,d.configuration_revision,
              r.authoring,b.intent,b.branch,b.finalization_mode,
              b.finalization_target,
              (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                WHERE k.tenant=d.tenant AND k.project=d.project
                  AND k.ticket=d.ticket),
              (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                WHERE c.tenant=d.tenant AND c.project=d.project
                  AND c.ticket=d.ticket),
              v.name,v.number
         FROM draft d
         JOIN draft_revision r USING (tenant,project,ticket,authoring_version)
         LEFT JOIN draft_brief b
           ON b.tenant=d.tenant AND b.project=d.project AND b.ticket=d.ticket
         LEFT JOIN repository_configuration_provenance p
           ON p.tenant=d.tenant AND p.project=d.project
          AND p.revision=d.configuration_revision
         LEFT JOIN repository_configuration_version v
           ON v.tenant=d.tenant AND v.project=d.project
          AND v.name=p.name AND v.digest=p.digest
        WHERE d.tenant=in_tenant AND d.project=in_project AND d.state='Draft'
          AND d.ticket>coalesce(in_after,0)
        ORDER BY d.ticket
        LIMIT least(coalesce(in_max,${nativeHttpPageItemsMax + 1}),
                    ${nativeHttpPageItemsMax + 1})
     $$`,
  `ALTER FUNCTION ${projectDraftsReadFunction}(text,text,bigint,bigint)
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectDraftsReadFunction}(text,text,bigint,bigint)
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${projectDraftsReadFunction}(text,text,bigint,bigint)
     TO ${apiRole}`,
];

/**
 * The binding read the session pass needs. 021 created it and 027 replaced it,
 * granted to the API alone; a session is placed with the repository its project
 * is bound to, and the scheduler is what places one.
 */
const schedulerReadsTheBinding = [
  `GRANT EXECUTE ON FUNCTION ${repositoryBindingReadFunction}(text,text)
     TO ${schedulerRole}`,
];

/**
 * The installation's tool controls, narrowed to what a lead may hold. The
 * allowlist moves only where it is still the seeded wildcard, and the call
 * bound is a floor: an owner who has already written either keeps what they
 * set, and the revision the change mints is recorded like every other.
 */
const leadToolControls = [
  `UPDATE selector_runtime_settings
      SET controls=jsonb_set(
            jsonb_set(controls::jsonb,'{toolAllowlist}',
              CASE WHEN controls::jsonb->'toolAllowlist' = '["*"]'::jsonb
                   THEN '${JSON.stringify(leadToolAllowlist)}'::jsonb
                   ELSE controls::jsonb->'toolAllowlist' END),
            '{limits,toolCallsPerDecision}',
            to_jsonb(greatest(
              (controls::jsonb->'limits'->>'toolCallsPerDecision')::bigint,
              ${leadToolCallsPerDecision}::bigint)))::text,
          revision=revision+1,updated_at=now()
    WHERE singleton=1
      AND (controls::jsonb->'toolAllowlist' = '["*"]'::jsonb
        OR (controls::jsonb->'limits'->>'toolCallsPerDecision')::bigint
             < ${leadToolCallsPerDecision})`,
  `INSERT INTO selector_runtime_settings_history
     (revision,mode,dispatch_mode,base_prompt,controls,
      administrator_kind,administrator_subject)
     SELECT revision,mode,dispatch_mode,base_prompt,controls,'System','lead tools migration'
       FROM selector_runtime_settings ON CONFLICT (revision) DO NOTHING`,
];

/** The lead's tools, the objectives it holds them under, and the reads both need. */
export const migration061: Migration = {
  version: 61,
  name: "the lead's tools and the objectives it holds them under",
  statements: [
    ...widenedCapabilities,
    ...systemPrompt,
    ...promptedSessionFacts,
    ...projectDrafts,
    ...schedulerReadsTheBinding,
    ...leadToolControls,
  ],
};
