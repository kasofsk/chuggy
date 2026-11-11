/**
 * A session holds whether it runs on its own system prompt with none of its
 * project's settings, and the session plane and the selector read it.
 *
 * `agent_session` gains `system_prompt_own`, false on every row already there.
 * `open_project_lead` takes it and writes it, `lead_session` answers it to the
 * selector, and `read_session_attempt` to the session plane, an inquiry its
 * parent's, as 133 answers an inquiry its parent's model and effort. Each
 * function is dropped and recreated under 133's owner and grants, its body the
 * one 133 or 143 gave it with the column added.
 */

import {
  boundaryOwnerRole,
  leadOpenFunction,
  leadSessionFunction,
  selectorServiceRole,
  sessionAttemptReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

const leadOpenWithout = `public.${leadOpenFunction}(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text, in_auto_compact_window bigint, in_model text, in_effort text)`;

const leadOpenWith = `public.${leadOpenFunction}(in_tenant text, in_project text, in_session text, in_principal text, in_credential_slot text, in_system_prompt text, in_auto_compact_window bigint, in_model text, in_effort text, in_system_prompt_own boolean)`;

const lead = `public.${leadSessionFunction}(in_tenant text, in_project text)`;

const attempt = `public.${sessionAttemptReadFunction}(in_secret_digest text)`;

/** The owner a function is installed under, callable by `role` and by nobody else but its owner. */
function owned(signature: string, role: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT ALL ON FUNCTION ${signature} TO ${role}`,
  ];
}

const leadOpen = `CREATE FUNCTION ${leadOpenWith} RETURNS TABLE(opened text, session text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
     DECLARE held text; drawn record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Lead' AND s.state='Open'
        FOR UPDATE;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       BEGIN
         INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt,auto_compact_window,model,effort,
            system_prompt_own)
         VALUES(in_tenant,in_project,in_session,'Lead',in_principal,
                ARRAY['RepositoryRead', 'ProjectRead', 'DraftAuthor', 'LeadDecision']::text[],in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt,
                in_auto_compact_window,in_model,in_effort,in_system_prompt_own);
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Lead' AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`;

const leadRead = `CREATE FUNCTION ${lead} RETURNS TABLE(session text, state text, agent_reference text, system_prompt text, auto_compact_window bigint, model text, effort text, credential_slot text, system_prompt_own boolean, tokens bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT s.session,s.state,s.agent_reference,s.system_prompt,
              s.auto_compact_window,s.model,s.effort,s.credential_slot,
              s.system_prompt_own,
              (SELECT t.tokens FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session AND t.state='Answered'
                  AND t.input_kind='Observation'
                ORDER BY t.ordinal DESC LIMIT 1)
         FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=(SELECT candidate.session FROM agent_session candidate
        WHERE candidate.tenant=in_tenant AND candidate.project=in_project
          AND candidate.kind='Lead'
        ORDER BY (candidate.state='Open') DESC,candidate.opened_at DESC,
                 candidate.session DESC
        LIMIT 1)
     $$`;

const attemptRead = `CREATE FUNCTION ${attempt} RETURNS TABLE(tenant text, project text, session text, attempt text, generation bigint, kind text, principal text, capabilities text[], credential_slot text, agent_reference text, system_prompt text, auto_compact_window bigint, model text, effort text, fork_from text, system_prompt_own boolean, live boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       SELECT a.tenant,a.project,a.session,a.attempt,a.generation,s.kind,s.principal,
              s.capabilities,s.credential_slot,s.agent_reference,s.system_prompt,
              s.auto_compact_window,
              CASE WHEN s.kind='Inquiry' THEN p.model ELSE s.model END,
              CASE WHEN s.kind='Inquiry' THEN p.effort ELSE s.effort END,
              p.agent_reference,
              CASE WHEN s.kind='Inquiry' THEN coalesce(p.system_prompt_own,false)
                   ELSE s.system_prompt_own END,
              (a.state IN ('Placing','Running') AND s.state='Open'
               AND a.recovery_epoch=(SELECT epoch FROM recovery_epoch
                                      ORDER BY ordinal DESC LIMIT 1))
         FROM session_attempt a
         JOIN agent_session s ON s.tenant=a.tenant AND s.project=a.project
                             AND s.session=a.session
         LEFT JOIN agent_session p ON p.tenant=s.tenant AND p.project=s.project
                                  AND p.session=s.parent_session
        WHERE a.bearer_secret_digest=in_secret_digest
     $$`;

export const migration154: Migration = {
  version: 154,
  name: "a session holds whether it runs on its own system prompt alone",
  statements: [
    `ALTER TABLE public.agent_session
       ADD COLUMN system_prompt_own boolean NOT NULL DEFAULT false`,
    `DROP FUNCTION ${leadOpenWithout}`,
    leadOpen,
    ...owned(leadOpenWith, selectorServiceRole),
    `DROP FUNCTION ${lead}`,
    leadRead,
    ...owned(lead, selectorServiceRole),
    `DROP FUNCTION ${attempt}`,
    attemptRead,
    ...owned(attempt, workerPlaneRole),
  ],
};
