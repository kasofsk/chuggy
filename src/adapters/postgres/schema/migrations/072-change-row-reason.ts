/**
 * The reason a change row carries, recorded on the row when the change is
 * appended instead of read back off the resource's present state.
 *
 * A CHANGE ROW IS AN EVENT AND WAS BEING READ AS A PROJECTION. 062 decided a
 * row's reason by looking its resource up in `ticket_projection`, `draft` or
 * the refusal ledger at the moment the wake pass ran, so every row a ticket had
 * ever produced said whatever the ticket says now: a revoked ticket's whole
 * history read `TicketAbandoned`, every row of a deleted draft read
 * `DraftDeleted`, and every refusal row read the latest event on the ledger.
 * The rig's first thread was woken once per row of one ticket's history and
 * told the same sentence each time (kasofsk/chuggy#542). The same reading makes
 * a ticket that moves twice inside one window say the later thing twice.
 *
 * IT IS NOT A STORED DUPLICATE, because what it records stops being derivable
 * the moment the resource moves again. The projection holds where a ticket
 * stands and not where it stood, so what a change meant when it was appended
 * survives on the row or nowhere, and standing rule 3 is about a copy of a fact
 * a reader can still derive.
 *
 * THE APPEND IS WHERE IT CAN BE RECORDED, and every writer already goes through
 * it: the notification bridge, the execution and artifact triggers, the
 * run-evidence trigger and the refusal trigger all reach
 * `append_project_change`, and each of them appends AFTER writing the state its
 * change is about — the draft doors publish once the draft row is updated, the
 * decision transaction publishes a ticket's notification once its projection is
 * written, and the refusal trigger fires after the ledger entry. So what this
 * function reads is the state the change produced, and a reason computed per
 * writer would be that one reading copied to every site.
 *
 * THE READS TAKE NO LOCK, which is what 038's header rests on. They are plain
 * selects over relations the boundary owner already reads to answer the wake
 * join, so an append still waits on nothing and still names no relation in the
 * lock order `src/adapters/postgres/scheduler.ts` declares.
 *
 * WHAT A REFUSAL ROW READS IS THE LEDGER'S HEAD FOR ITS TICKET, which the
 * appending transaction has just extended and which no concurrent writer's
 * uncommitted entry is part of. The ledger is the selector's own and its
 * entries for one ticket come from decisions taken in turn, so the head under
 * the trigger is the entry the trigger fired for.
 *
 * THE COLUMN IS NAMED FOR ITS CONSUMER because the roster is the consumer's.
 * `allThreadWakeReasons` is what a woken thread is told, and a column named for
 * events in general would claim the log holds a kind this tree has not given
 * it.
 *
 * ROWS ALREADY APPENDED STAY UNREASONED, AND AN UNREASONED ROW WAKES NOBODY. A
 * backfill has only the present state to read, which writes the defect down
 * permanently rather than repairing it, and there is no history of the
 * projection to read instead. What an installation loses is the notices for
 * changes its pass had not reached yet; what it does not get is a mailbox
 * filled with rows all saying what happened last.
 */

import { threadWakesPerPassMax } from "../../../../contract/http.ts";
import {
  projectChangeChannel,
  projectChangePayload,
} from "../../../../interpreter/projectChange.ts";
import { allThreadWakeReasons } from "../../../../interpreter/thread.ts";
import {
  projectChangeAppendFunction,
  schemaTextSet,
  threadWakeCandidatesFunction,
  type Migration,
} from "../shared.ts";

/** The reason column and the roster a row may carry, generated from the roster itself. */
const reasonColumn = [
  `ALTER TABLE project_change ADD COLUMN wake_reason text`,
  `ALTER TABLE project_change
     ADD CONSTRAINT project_change_wake_reason_is_known CHECK (
       wake_reason IS NULL
       OR wake_reason IN (${schemaTextSet([...allThreadWakeReasons])}))`,
];

/**
 * 062's three arms, asked of the change being appended rather than of a row in
 * the log. A ticket is still matched as `ticket::text = resource`, so a kind
 * whose resource is no number at all records no reason instead of raising
 * inside the transaction that was appending.
 */
const reasonAtAppend = `CASE in_kind
    WHEN 'AgenticRefusal' THEN
      (SELECT CASE f.event WHEN 'Refused' THEN 'TicketRefused'
                           WHEN 'Lifted' THEN 'RefusalLifted' END
         FROM selector_agentic_refusal f
        WHERE f.tenant=in_tenant AND f.project=in_project
          AND f.ticket::text=in_resource
        ORDER BY f.ordinal DESC LIMIT 1)
    WHEN 'Draft' THEN
      (SELECT 'DraftDeleted' FROM draft d
        WHERE d.tenant=in_tenant AND d.project=in_project
          AND d.ticket::text=in_resource AND d.state='Deleted')
    WHEN 'Ticket' THEN
      (SELECT CASE p.phase WHEN 'Escalated' THEN 'TicketEscalated'
                           WHEN 'Done' THEN 'TicketCompleted'
                           WHEN 'Abandoned' THEN 'TicketAbandoned'
                           WHEN 'Revoked' THEN 'TicketAbandoned' END
         FROM ticket_projection p
        WHERE p.tenant=in_tenant AND p.project=in_project
          AND p.ticket::text=in_resource)
  END`;

/** 038's append, writing the reason as part of the row rather than leaving it to be re-read. */
const recordingAppend = [
  `CREATE OR REPLACE FUNCTION ${projectChangeAppendFunction}(
      in_tenant text,in_project text,in_kind text,in_resource text) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE appended bigint;
     BEGIN
       INSERT INTO project_change (tenant,project,kind,resource,wake_reason)
       VALUES (in_tenant,in_project,in_kind,in_resource,${reasonAtAppend})
       RETURNING sequence INTO appended;
       PERFORM pg_notify('${projectChangeChannel}','${projectChangePayload}');
       RETURN appended;
     END $$`,
];

/**
 * 067's candidate read with the derivation taken out of it. Everything that
 * decides WHICH rows are offered — the cursor, the thread's own opening
 * position and the authorship join — is unchanged; what a row is called is now
 * the row's to answer.
 */
const candidatesReadTheRecord = [
  `CREATE OR REPLACE FUNCTION ${threadWakeCandidatesFunction}(
     in_after bigint,in_max bigint)
     RETURNS TABLE(sequence bigint,tenant text,project text,kind text,
                   resource text,reason text,principal text,session text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT c.sequence,c.tenant,c.project,c.kind,c.resource,c.wake_reason,
              s.principal,s.session
         FROM project_change c
         JOIN agent_session s
           ON s.tenant=c.tenant AND s.project=c.project
          AND s.kind='Thread' AND s.state='Open'
          AND c.sequence>s.opened_after_sequence
        WHERE c.sequence>coalesce(in_after,0)
          AND c.wake_reason IS NOT NULL
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

/** A change says what happened when it happened, and a sequence means what it meant. */
export const migration072: Migration = {
  version: 72,
  name: "a change row records the reason it wakes a thread with",
  statements: [...reasonColumn, ...recordingAppend, ...candidatesReadTheRecord],
};
