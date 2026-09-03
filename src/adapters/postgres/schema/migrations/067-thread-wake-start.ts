/**
 * Where a thread's mailbox starts: the change log's position at the moment the
 * thread was opened, written on the session row, and the one predicate that
 * makes the wake join read it.
 *
 * A THREAD IS ANSWERABLE FOR WHAT HAPPENS AFTER IT EXISTS. 062's
 * `thread_wake_candidates` joins the change log to every open thread and puts
 * nothing between them but the installation-wide cursor, so what a new thread
 * is woken by is decided by where that cursor happens to stand — a fact about
 * the pass's progress, not about the member. On an installation whose cursor is
 * behind, the first thread opened is woken by history: eight `Wake` turns from
 * sequences 267-334 filled one to `threadBacklogMax` on the rig and refused its
 * owner's first message (kasofsk/chuggy#541). The two facts are separated here:
 * the cursor says how far the pass has read, and the session row says what the
 * thread was opened after.
 *
 * THE POSITION IS STORED BECAUSE IT IS NOT DERIVABLE. `opened_at` and
 * `project_change.created_at` are both `now()`, which is the transaction's
 * start: a change row inserted by a long transaction carries an instant older
 * than a row with a higher sequence, so an instant comparison is not the log's
 * order and would wake a thread by a row it must not see, or hide one it must.
 * The log's head at the moment the row is written is a different fact from the
 * instant it was written at, and standing rule 3 is about duplicates of a
 * derivable fact.
 *
 * THE DOOR READS THE HEAD, NOT ITS CALLER. `open_member_thread` still takes the
 * six arguments it took, because a watermark passed in is a watermark an API
 * could choose, and what a thread is answerable for is not a caller's to name.
 *
 * NOTHING MOVES IT. No `GRANT UPDATE` names the column, so it is written by the
 * INSERT that opens the session and by nothing else; granting it would be the
 * deliberate act that makes a thread's mailbox rewritable, and the negative
 * space is the control. It is NOT added to `agent_session_is_written_once`,
 * whose tuple guards the columns some role may write.
 *
 * A THREAD ALREADY OPEN KEEPS THE MAILBOX IT HAS, and the default of 0 is what
 * says so: it is the watermark under which the installation cursor alone
 * decides, which is what every open thread has been living under. A backfill to
 * the cursor would be a no-op — `advance_thread_wake_cursor` moves by
 * `greatest`, so no sequence at or below the cursor is ever a candidate again.
 *
 * THE TWO DEFINERS ARE RE-RENDERED, NOT SHARED. Their bodies repeat 062's
 * because a migration is a snapshot: a fragment imported by both would rewrite
 * 062 for a fresh installation and leave a migrated one on what it applied, and
 * two installations reading the same ledger would hold different functions.
 * Each is `CREATE OR REPLACE` at the signature 062 declared, which keeps the
 * owner and the grant the door already has.
 */

import { threadWakesPerPassMax } from "../../../../contract/http.ts";
import { threadCapabilitiesDefault } from "../../../../interpreter/thread.ts";
import {
  schemaTextSet,
  threadOpenFunction,
  threadWakeCandidatesFunction,
  type Migration,
} from "../shared.ts";

/** The roster a thread is opened with, rendered as the literal the definer writes. */
const threadRosterLiteral = `ARRAY[${schemaTextSet([
  ...threadCapabilitiesDefault,
])}]::text[]`;

/** The change log's head, as the door writing a thread row reads it. */
const changeLogHead = `coalesce((SELECT max(head.sequence) FROM project_change head),0)`;

const wakeStartColumn = [
  `ALTER TABLE agent_session
     ADD COLUMN opened_after_sequence bigint NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_session
     ADD CONSTRAINT agent_session_opens_after_a_sequence
       CHECK (opened_after_sequence >= 0)`,
];

/** 062's door, writing the log's head it read as part of opening the row. */
const openingRecordsTheHead = [
  `CREATE OR REPLACE FUNCTION ${threadOpenFunction}(
     in_tenant text,in_project text,in_principal text,in_session text,
     in_credential_slot text,in_system_prompt text)
     RETURNS TABLE(opened text,session text)
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held text; drawn record;
     BEGIN
       SELECT s.session INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open'
        FOR UPDATE;
       IF FOUND THEN
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END IF;
       SELECT a.account,a.cluster INTO STRICT drawn FROM capacity_account a
        WHERE a.account=project_capacity_account(in_tenant,in_project);
       BEGIN
         INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,
            account,cluster,system_prompt,opened_after_sequence)
         VALUES(in_tenant,in_project,in_session,'Thread',in_principal,
                ${threadRosterLiteral},in_credential_slot,
                drawn.account,drawn.cluster,in_system_prompt,
                ${changeLogHead});
       EXCEPTION WHEN unique_violation THEN
         SELECT s.session INTO held FROM agent_session s
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.kind='Thread' AND s.principal=in_principal AND s.state='Open';
         IF NOT FOUND THEN RAISE; END IF;
         RETURN QUERY SELECT 'AlreadyOpen'::text,held; RETURN;
       END;
       RETURN QUERY SELECT 'Opened'::text,in_session;
     END $$`,
];

/**
 * The reason a change row carries, exactly as 062 decides it. It is repeated
 * for the reason the header gives, and #542 is where the reason being read off
 * the resource's present state is filed; this migration changes which rows are
 * offered, not what a row is called.
 */
const wakeReason = `CASE c.kind
    WHEN 'AgenticRefusal' THEN
      (SELECT CASE f.event WHEN 'Refused' THEN 'TicketRefused'
                           WHEN 'Lifted' THEN 'RefusalLifted' END
         FROM selector_agentic_refusal f
        WHERE f.tenant=c.tenant AND f.project=c.project
          AND f.ticket::text=c.resource
        ORDER BY f.ordinal DESC LIMIT 1)
    WHEN 'Draft' THEN
      (SELECT 'DraftDeleted' FROM draft d
        WHERE d.tenant=c.tenant AND d.project=c.project
          AND d.ticket::text=c.resource AND d.state='Deleted')
    WHEN 'Ticket' THEN
      (SELECT CASE p.phase WHEN 'Escalated' THEN 'TicketEscalated'
                           WHEN 'Done' THEN 'TicketCompleted'
                           WHEN 'Abandoned' THEN 'TicketAbandoned'
                           WHEN 'Revoked' THEN 'TicketAbandoned' END
         FROM ticket_projection p
        WHERE p.tenant=c.tenant AND p.project=c.project
          AND p.ticket::text=c.resource)
  END`;

/**
 * 062's candidate read with one predicate added. It stands beside the cursor's
 * rather than replacing it: the cursor keeps a pass from re-reading what it has
 * read, and the session's own position keeps a thread from being answerable for
 * what happened before it existed.
 */
const candidatesAfterTheOpening = [
  `CREATE OR REPLACE FUNCTION ${threadWakeCandidatesFunction}(
     in_after bigint,in_max bigint)
     RETURNS TABLE(sequence bigint,tenant text,project text,kind text,
                   resource text,reason text,principal text,session text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT c.sequence,c.tenant,c.project,c.kind,c.resource,named.reason,
              s.principal,s.session
         FROM project_change c
         CROSS JOIN LATERAL (SELECT ${wakeReason} AS reason) named
         JOIN agent_session s
           ON s.tenant=c.tenant AND s.project=c.project
          AND s.kind='Thread' AND s.state='Open'
          AND c.sequence>s.opened_after_sequence
        WHERE c.sequence>coalesce(in_after,0)
          AND named.reason IS NOT NULL
          AND EXISTS(SELECT 1 FROM draft_revision r
                       JOIN project_membership m
                         ON m.tenant=r.tenant AND m.project=r.project
                        AND m.authority_kind=r.authority_kind
                        AND m.authority_subject=r.authority_subject
                      WHERE r.tenant=c.tenant AND r.project=c.project
                        AND r.ticket::text=c.resource
                        AND m.principal=s.principal)
        ORDER BY c.sequence,s.session
        LIMIT least(coalesce(in_max,${threadWakesPerPassMax}),
                    ${threadWakesPerPassMax})
     $$`,
];

/** A thread is woken by what the log records after it was opened, and by nothing before. */
export const migration067: Migration = {
  version: 67,
  name: "a thread's mailbox starts where the change log stood when it opened",
  statements: [
    ...wakeStartColumn,
    ...openingRecordsTheHead,
    ...candidatesAfterTheOpening,
  ],
};
