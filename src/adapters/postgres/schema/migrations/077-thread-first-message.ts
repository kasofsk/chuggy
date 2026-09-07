/**
 * The two thread reads answer the head of the thread's first member message, so
 * a console can name a conversation by what is in it.
 *
 * THE TITLE IS DERIVED AND NOTHING STORES ONE. `src/interpreter/threadRead.ts`
 * cuts the title out of this column on every read; a title column would be a
 * stored duplicate of the mailbox, stale the moment a thread's first turn moved.
 *
 * THE SEEDING BLOCK IS SPLIT OFF HERE AND NOT IN THE READER. A first turn's
 * input is the project's North Star and standing rules with the member's
 * message after them, and either text alone can weigh many times what a title
 * does — so a prefix taken before the split would answer the heading of a
 * document nobody typed.
 *
 * IT IS `conversationSeedingSplit`'S TWO MARKERS, IN ITS ORDER, because the
 * turns already recorded are frozen text and most of them predate the heading:
 * `threadTurnBoundaryHeading` where the input carries it, else
 * `threadTurnRecordedLastLine` and the blank line after it, else the whole
 * input is the member's words. Both markers are the contract's own, so the
 * console and this definer split on the same text.
 *
 * BOTH READS ARE DROPPED AND CREATED. A column added to a `RETURNS TABLE` is a
 * new return type, which `CREATE OR REPLACE` refuses; the drop takes the owner,
 * the revoke and the grant with it, and all three are re-issued as 062 issued
 * them — 075 replaced the bodies in place and issued none.
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
  projectThreadsReadFunction,
  threadStandingReadFunction,
  type Migration,
} from "../shared.ts";

/** The two markers a seeded turn divides on, as the delimiters SQL splits on. */
const threadTurnBoundary = `chr(10)||chr(10)||'${threadTurnBoundaryHeading}'||chr(10)||chr(10)`;
const threadTurnRecordedBoundary = `'${threadTurnRecordedLastLine}'||chr(10)||chr(10)`;

/** The member's own words, split off whichever marker the turn carries. */
const threadSaid = `CASE WHEN strpos(t.input,${threadTurnBoundary})>0
                  THEN split_part(t.input,${threadTurnBoundary},-1)
                  ELSE split_part(t.input,${threadTurnRecordedBoundary},-1) END`;

/**
 * The head of the earliest message the member put in the thread, with the
 * seeding block taken off it. A wake is not a member's message, so the kind
 * filter is what keeps a notice out of a title.
 */
const threadFirstMessage = `(SELECT left(${threadSaid},${threadTitleCharsMax})
         FROM session_turn t
        WHERE t.tenant=s.tenant AND t.project=s.project AND t.session=s.session
          AND t.input_kind='UserMessage'
        ORDER BY t.ordinal
        LIMIT 1)`;

const threadListingNamesItsFirstMessage = [
  `DROP FUNCTION ${projectThreadsReadFunction}(text,text,bigint)`,
  `CREATE FUNCTION ${projectThreadsReadFunction}(
     in_tenant text,in_project text,in_max bigint)
     RETURNS TABLE(session text,principal text,owner text,state text,
                   agent_reference text,turns bigint,first_message text)
     LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT s.session,s.principal,m.authority_subject,s.state,s.agent_reference,
              (SELECT count(*) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.session),
              ${threadFirstMessage}
         FROM agent_session s
         LEFT JOIN project_membership m
                ON m.tenant=s.tenant AND m.project=s.project
               AND m.principal=s.principal
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.kind='Thread'
        ORDER BY (s.state='Open') DESC,s.opened_at DESC,s.session
        LIMIT least(coalesce(in_max,${threadsAnsweredMax}),${threadsAnsweredMax})
     $$`,
];

/**
 * The standing read carries it too, because a thread page holds the mailbox
 * TAIL: the turn a title comes from has fallen off the page long before a
 * conversation is worth naming.
 */
const threadStandingNamesItsFirstMessage = [
  `DROP FUNCTION ${threadStandingReadFunction}(text,text,text,bigint,bigint)`,
  `CREATE FUNCTION ${threadStandingReadFunction}(
     in_tenant text,in_project text,in_session text,
     in_before bigint,in_turns_max bigint)
     RETURNS TABLE(session text,principal text,owner text,session_state text,
                   agent_reference text,turns bigint,first_message text,
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
         LEFT JOIN page ON true
        WHERE s.tenant=in_tenant AND s.project=in_project
          AND s.session=in_session AND s.kind='Thread'
        ORDER BY page.ordinal
     $$`,
];

/** The two reads, owned and granted exactly as the migrations that declared them left them. */
const threadReadGrants = [
  [projectThreadsReadFunction, "text,text,bigint"],
  [threadStandingReadFunction, "text,text,text,bigint,bigint"],
].flatMap(([name, signature]) => [
  `ALTER FUNCTION ${name}(${signature}) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${name}(${signature}) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${name}(${signature}) TO ${apiRole}`,
]);

/** A thread is named by what was said in it. */
export const migration077: Migration = {
  version: 77,
  name: "the thread reads answer the first member message a title is cut from",
  statements: [
    ...threadListingNamesItsFirstMessage,
    ...threadStandingNamesItsFirstMessage,
    ...threadReadGrants,
  ],
};
