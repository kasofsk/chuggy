/**
 * A member names their own thread and hides it from their rail, and both thread
 * reads answer when a thread opened and when it last moved.
 *
 * A MEMBER TITLE IS AN OVERRIDE AND NOT A COPY. 077 cuts a title out of the
 * first message on every read, and that stays the title of every thread nobody
 * has renamed; `member_title` is what the reader typed instead, so the derived
 * one is still there when it is cleared.
 *
 * HIDING IS A COLUMN ON THE SESSION BECAUSE A THREAD HAS ONE MEMBER. The
 * partial index 058 declared keys an open thread by its principal, so hiding
 * one is per-member already and a second relation would key it by a principal
 * the session row already carries.
 *
 * THE TWO COLUMNS ARE OUTSIDE THE FROZEN TUPLE AND INSIDE ONE GRANT.
 * `agent_session_is_written_once` freezes what a session was opened as, and
 * neither of these is that; what keeps them to their doors is the column-level
 * `UPDATE` no runtime role holds, exactly as 061 kept `system_prompt` to the
 * door that writes it.
 *
 * NEITHER DOOR MOVES `state`, SO THE FRAME 075 RAISES WOULD NEVER FIRE. A rail
 * watching the listing re-reads on a `Session` frame, so the same trigger
 * function is hung on these two columns rather than each door appending a
 * change of its own — a door that forgot to is the failure that arrangement
 * cannot have.
 *
 * BOTH READS ARE DROPPED AND CREATED, for 077's reason: a column added to a
 * `RETURNS TABLE` is a new return type, and the drop takes the owner, the
 * revoke and the grant with it.
 */

import {
  threadTitleCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "../../../../contract/http.ts";
import {
  threadTurnBoundaryHeading,
  threadTurnRecordedLastLine,
} from "../../../../contract/threadSeeding.ts";
import {
  apiRole,
  boundaryOwnerRole,
  projectChangeSessionStateFunction,
  projectThreadsReadFunction,
  threadHideFunction,
  threadRenameFunction,
  threadStandingReadFunction,
  type Migration,
} from "../shared.ts";

const memberViewColumns = [
  `ALTER TABLE agent_session ADD COLUMN member_title text`,
  `ALTER TABLE agent_session ADD COLUMN hidden_at timestamptz`,
  `ALTER TABLE agent_session ADD CONSTRAINT agent_session_member_title_is_bounded
     CHECK (member_title IS NULL
            OR length(member_title) BETWEEN 1 AND ${threadTitleCharsMax})`,
  `GRANT UPDATE (member_title,hidden_at) ON agent_session TO ${boundaryOwnerRole}`,
  `CREATE TRIGGER agent_session_member_view_appends_a_change
     AFTER UPDATE OF member_title,hidden_at ON agent_session
     FOR EACH ROW WHEN (OLD.member_title IS DISTINCT FROM NEW.member_title
                        OR OLD.hidden_at IS DISTINCT FROM NEW.hidden_at)
     EXECUTE FUNCTION ${projectChangeSessionStateFunction}()`,
];

/**
 * The two doors, each admitting a thread alone in the predicate its lock is
 * taken under, as 075's close door does. A blank title clears the override
 * rather than storing a label with nothing in it, and hiding a thread already
 * hidden writes nothing, so the instant it went off the rail is the first one.
 */
const memberViewDoors = [
  `CREATE FUNCTION ${threadRenameFunction}(
     in_tenant text,in_project text,in_session text,in_title text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM 1 FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoThread'; END IF;
       UPDATE agent_session s
          SET member_title=nullif(btrim(coalesce(in_title,'')),'')
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session;
       RETURN 'Renamed';
     END $$`,
  `CREATE FUNCTION ${threadHideFunction}(
     in_tenant text,in_project text,in_session text,in_hidden boolean) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held timestamptz;
     BEGIN
       SELECT s.hidden_at INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
          AND s.kind='Thread'
        FOR UPDATE;
       IF NOT FOUND THEN RETURN 'NoThread'; END IF;
       IF in_hidden AND held IS NULL THEN
         UPDATE agent_session s SET hidden_at=now()
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.session=in_session;
       ELSIF NOT in_hidden AND held IS NOT NULL THEN
         UPDATE agent_session s SET hidden_at=NULL
          WHERE s.tenant=in_tenant AND s.project=in_project
            AND s.session=in_session;
       END IF;
       RETURN CASE WHEN in_hidden THEN 'Hidden' ELSE 'Shown' END;
     END $$`,
];

const memberViewDoorSignatures = [
  [threadRenameFunction, "text,text,text,text"],
  [threadHideFunction, "text,text,text,boolean"],
] as const;

const memberViewDoorGrants = memberViewDoorSignatures.flatMap(
  ([name, signature]) => [
    `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${apiRole}`,
  ],
);

/** The two markers a seeded turn divides on, as 077's definers split on them. */
const threadTurnBoundary = `chr(10)||chr(10)||'${threadTurnBoundaryHeading}'||chr(10)||chr(10)`;
const threadTurnRecordedBoundary = `'${threadTurnRecordedLastLine}'||chr(10)||chr(10)`;

const threadSaid = `CASE WHEN strpos(t.input,${threadTurnBoundary})>0
                  THEN split_part(t.input,${threadTurnBoundary},-1)
                  ELSE split_part(t.input,${threadTurnRecordedBoundary},-1) END`;

const threadFirstMessage = `(SELECT left(${threadSaid},${threadTitleCharsMax})
         FROM session_turn t
        WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
          AND t.input_kind='UserMessage'
        ORDER BY t.ordinal
        LIMIT 1)`;

/**
 * When the thread last moved: it opened, a turn was enqueued or ended, or it
 * closed. It is a lateral rather than an expression written twice because the
 * listing both answers it and orders on it.
 */
const threadMoved = `CROSS JOIN LATERAL (
           SELECT greatest(s.opened_at,s.closed_at,
                    (SELECT max(greatest(t.enqueued_at,t.ended_at))
                       FROM session_turn t
                      WHERE t.tenant=s.tenant AND t.project=s.project
                        AND t.session=s.session)) AS at) moved`;

const threadListingCarriesTheRail = [
  `DROP FUNCTION ${projectThreadsReadFunction}(text,text,bigint)`,
  `CREATE FUNCTION ${projectThreadsReadFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(session text,principal text,owner text,state text,
                   agent_reference text,turns bigint,first_message text,
                   member_title text,opened_at timestamptz,
                   last_activity_at timestamptz,hidden_at timestamptz)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.session,s.principal,m.authority_subject,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              ${threadFirstMessage},
              s.member_title,s.opened_at,moved.at,s.hidden_at
         FROM agent_session s
         LEFT JOIN project_membership m
                ON m.tenant=s.tenant AND m.project=s.project
               AND m.principal=s.principal
         ${threadMoved}
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
        ORDER BY (s.state='Open') DESC,moved.at DESC,s.session
        LIMIT least(coalesce(in_max,${threadsAnsweredMax}),${threadsAnsweredMax})
     $$`,
];

const threadStandingCarriesTheRail = [
  `DROP FUNCTION ${threadStandingReadFunction}(text,text,text,bigint,bigint)`,
  `CREATE FUNCTION ${threadStandingReadFunction}(
     in_tenant text,in_project text,in_session text,
     in_before bigint,in_turns_max bigint)
     RETURNS TABLE(session text,principal text,owner text,session_state text,
                   agent_reference text,turns bigint,first_message text,
                   member_title text,opened_at timestamptz,
                   last_activity_at timestamptz,hidden_at timestamptz,
                   next_before bigint,
                   turn text,turn_ordinal bigint,input_kind text,turn_state text,
                   input text,result text,failure text,model text,tokens bigint,
                   cost_micros bigint,duration_ms bigint,tools text[],
                   batch_first bigint,batch_last bigint)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       WITH page AS (
         SELECT t.turn,t.ordinal,t.input_kind,t.state,t.input,t.result,t.failure,
                t.model,t.tokens,t.cost_micros,t.duration_ms,t.tools,
                t.batch_first,t.batch_last
           FROM session_turn t
          WHERE t.tenant=in_tenant AND t.project=in_project AND t.session=in_session
            AND (in_before IS NULL OR t.ordinal<in_before)
          ORDER BY t.ordinal DESC
          LIMIT least(coalesce(in_turns_max,${threadTurnsAnsweredMax}),
                      ${threadTurnsAnsweredMax}))
       SELECT s.session,s.principal,m.authority_subject,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              ${threadFirstMessage},
              s.member_title,s.opened_at,moved.at,s.hidden_at,
              CASE WHEN EXISTS(SELECT 1 FROM session_turn older
                                WHERE older.tenant=s.tenant
                                  AND older.project=s.project
                                  AND older.session=s.session
                                  AND older.ordinal<(SELECT min(q.ordinal) FROM page q))
                   THEN (SELECT min(q.ordinal) FROM page q) END,
              page.turn,page.ordinal,page.input_kind,page.state,page.input,
              page.result,page.failure,page.model,page.tokens,page.cost_micros,
              page.duration_ms,page.tools,page.batch_first,page.batch_last
         FROM agent_session s
         LEFT JOIN project_membership m
                ON m.tenant=s.tenant AND m.project=s.project
               AND m.principal=s.principal
         ${threadMoved}
         LEFT JOIN page ON true
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        ORDER BY page.ordinal
     $$`,
];

/** The two reads, owned and granted exactly as 062 declared them. */
const threadReadGrants = [
  [projectThreadsReadFunction, "text,text,bigint"],
  [threadStandingReadFunction, "text,text,text,bigint,bigint"],
].flatMap(([name, signature]) => [
  `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${apiRole}`,
]);

/** A member's own name for a thread, their own way of putting it away, and when it moved. */
export const migration079: Migration = {
  version: 79,
  name: "a member names and hides their own thread, and a listing orders by activity",
  statements: [
    ...memberViewColumns,
    ...memberViewDoors,
    ...memberViewDoorGrants,
    ...threadListingCarriesTheRail,
    ...threadStandingCarriesTheRail,
    ...threadReadGrants,
  ],
};
