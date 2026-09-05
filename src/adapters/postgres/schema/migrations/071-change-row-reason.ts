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
 * THERE ARE TWO APPEND DOORS BECAUSE THERE ARE TWO KINDS OF APPENDER. A
 * publication says only that a resource moved — `project_notification` carries
 * a kind and a resource and no phase — so the bridge's door reads what the
 * resource moved TO, and its arms are exactly the two publication kinds a
 * thread is woken by. Every other appender knows what happened without a read,
 * so the second door records what it is told: 059's refusal trigger says its
 * own row's event, and 049's run-evidence trigger says nothing.
 *
 * THE READING DOOR DEPENDS ON THE ORDER ITS PUBLISHERS PUBLISH IN, and that is
 * load-bearing rather than incidental. The draft doors update `draft` and then
 * publish inside one body; `decisionApplyJournaled` in
 * `src/adapters/postgres/decision.ts` runs `decisionProject` before
 * `notifyDecision`, and that is a call order across two modules. It is held by
 * `test/postgres/ticketProjection.test.ts`'s case that drives a ticket to the
 * rework wall through the real writer and reads the reason off the row that
 * decision appended.
 *
 * A RUN-EVIDENCE `Ticket` CHANGE IS NOT A PHASE MOVE. 049 appends one so a
 * consumer re-reads the ticket when its run totals land, from a transaction
 * that writes no ticket state at all — so a door that read the projection would
 * give that row the ticket's standing phase, which is the reading this
 * migration exists to remove. Its trigger is re-rendered to record no reason,
 * and a thread is not woken because a worker reported what a run cost.
 *
 * THE REFUSAL TRIGGER SAYS ITS OWN ROW'S EVENT rather than the ledger's head
 * for that ticket, so the reason cannot be a fact about which entry committed
 * last. That is why the derivation below has no `AgenticRefusal` arm: no
 * publication carries that kind, and the one writer that appends it names its
 * reason.
 *
 * THE READS TAKE NO LOCK, which is what 038's header rests on. They are plain
 * selects over relations the boundary owner already reads to answer the wake
 * join, so an append still waits on nothing and still names no relation in the
 * lock order `src/adapters/postgres/scheduler.ts` declares.
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
  boundaryOwnerRole,
  projectChangeAgenticRefusalFunction,
  projectChangeAppendFunction,
  projectChangeRunFunction,
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

/** The reasoned door, by the argument types it is named by. */
const reasonedSignature = `${projectChangeAppendFunction}(text,text,text,text,text)`;

/**
 * The door an appender that knows what happened writes through. It is granted
 * to no runtime role: a role that could name a reason could tell a member's
 * thread anything, and every caller is a trigger the boundary owner owns.
 */
const reasonedAppend = [
  `CREATE FUNCTION ${projectChangeAppendFunction}(
      in_tenant text,in_project text,in_kind text,in_resource text,
      in_wake_reason text) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE appended bigint;
     BEGIN
       INSERT INTO project_change (tenant,project,kind,resource,wake_reason)
       VALUES (in_tenant,in_project,in_kind,in_resource,in_wake_reason)
       RETURNING sequence INTO appended;
       PERFORM pg_notify('${projectChangeChannel}','${projectChangePayload}');
       RETURN appended;
     END $$`,
  `ALTER FUNCTION ${reasonedSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${reasonedSignature} FROM PUBLIC`,
];

/**
 * What a publication's change row is called, read from the resource the
 * publication names. A ticket is matched as `ticket::text = resource`, so a
 * kind whose resource is no number at all records no reason instead of raising
 * inside the transaction that was appending.
 */
const reasonAtAppend = `CASE in_kind
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

/**
 * 038's append, which every publication still reaches unchanged, reading the
 * reason and handing it to the door above. Its grants and its callers are
 * exactly what they were.
 */
const readingAppend = [
  `CREATE OR REPLACE FUNCTION ${projectChangeAppendFunction}(
      in_tenant text,in_project text,in_kind text,in_resource text) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       RETURN ${projectChangeAppendFunction}(
         in_tenant,in_project,in_kind,in_resource,(${reasonAtAppend})::text);
     END $$`,
];

/**
 * 059's trigger, naming the event of the row it fired for. Its body is
 * otherwise 059's, because a migration is a snapshot rather than a shared
 * fragment.
 */
const refusalNamesItsEvent = [
  `CREATE OR REPLACE FUNCTION ${projectChangeAgenticRefusalFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(
         NEW.tenant,NEW.project,'AgenticRefusal',NEW.ticket::text,
         CASE NEW.event WHEN 'Refused' THEN 'TicketRefused'
                        WHEN 'Lifted' THEN 'RefusalLifted' END);
       RETURN NULL;
     END $$`,
];

/**
 * 049's trigger, whose `Ticket` row now records nothing. Its `Execution` row is
 * left on the reading door, where no arm names that kind and the row is
 * unreasoned either way.
 */
const runEvidenceNamesNothing = [
  `CREATE OR REPLACE FUNCTION ${projectChangeRunFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(
         NEW.tenant,NEW.project,'Execution',NEW.execution);
       PERFORM ${projectChangeAppendFunction}(NEW.tenant,NEW.project,'Ticket',
         (SELECT named.ticket::text FROM execution AS named
           WHERE named.tenant=NEW.tenant AND named.project=NEW.project
             AND named.execution=NEW.execution),
         NULL::text);
       RETURN NULL;
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
export const migration071: Migration = {
  version: 71,
  name: "a change row records the reason it wakes a thread with",
  statements: [
    ...reasonColumn,
    ...reasonedAppend,
    ...readingAppend,
    ...refusalNamesItsEvent,
    ...runEvidenceNamesNothing,
    ...candidatesReadTheRecord,
  ],
};
