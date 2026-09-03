/**
 * A batch row the plane answers says which session WROTE it.
 *
 * 063 widened `read_session_store` to the bearer's own session UNION the parent
 * of an `Inquiry`, and the route that pages it went on reading each object under
 * the CALLER'S session — where a fork's bytes have never stood, because the
 * store is keyed by the session that wrote them and 063's own trigger refuses an
 * inquiry a store of its own. Release 19 measured the consequence: every batch of
 * every inquiry read missing, the pod refused to resume over the hole, and no
 * inquiry answered (kasofsk/chuggy#551). A resume was unaffected, reader and
 * writer being one session there.
 *
 * THE ROW IS THE ONLY THING THAT CAN SAY WHOSE DIRECTORY TO READ. A fork's rows
 * are its parent's and a resume's are its own, and the caller's identity is the
 * fork's own session in both — so the read that resolved the sessions reports
 * which one each row came from and the plane reads under that. It is also the
 * fence: a session this read does not answer for is one the plane never
 * addresses an object under, so naming the writer widens nothing.
 *
 * THE READABLE SET IS WRITTEN OUT HERE AND NOT SHARED WITH 063, for the reason
 * 066 gives where it respells 061's body: a migration whose statements changed
 * when a later one was edited would not be history. 063 declares the same
 * predicate to the same effect, and the two are not one control kept in step —
 * they are what each migration did, and 063's is frozen because a database has
 * run it. The ledger records `(version, name)` alone
 * (`src/adapters/postgres/runtimeSchema.ts`), so an edit reaching an applied
 * body is invisible to every installation that already ran it; a rewrite of
 * 063's constant would silently move `list_session_streams` too, which is built
 * from it there and which nothing here re-creates.
 *
 * THE WRITE AND THE STREAM LISTING ARE UNTOUCHED. `record_session_store_batch`
 * still writes under the bearer's own session alone, which is the asymmetry 063
 * exists to state; `list_session_streams` names streams rather than objects, so
 * it has no writer to report and carries 063's predicate unchanged.
 */

import { sessionStorePageBatchesMax } from "../../../../contract/http.ts";
import {
  boundaryOwnerRole,
  sessionAttemptBindingFunction,
  sessionStoreReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The argument types the read is named by, unchanged: only what it answers moves. */
const storeReadSignature = "text,bigint,text,bigint,bigint";

/**
 * The sessions one bearer may read a store of: its own, and its parent's — the
 * parent arm carrying the ceiling the read is bounded by and the own arm none.
 * This is 063's set to the same effect, re-declared rather than imported, and
 * private so that no later migration can couple to it either.
 */
const writerNamedReadableSessions = `(
       SELECT k.session AS session,NULL::bigint AS ceiling
       UNION ALL
       SELECT s.parent_session,
              (SELECT coalesce(max(t.batch_last),0) FROM session_turn t
                WHERE t.tenant=s.tenant AND t.project=s.project
                  AND t.session=s.parent_session
                  AND t.state IN ('Answered','Failed'))
         FROM agent_session s
        WHERE s.tenant=k.tenant AND s.project=k.project AND s.session=k.session)`;

const writerNamingRead = [
  `DROP FUNCTION ${sessionStoreReadFunction}(${storeReadSignature})`,
  `CREATE FUNCTION ${sessionStoreReadFunction}(
     in_secret_digest text,in_generation bigint,in_stream text,
     in_after bigint,in_limit bigint)
     RETURNS TABLE(session text,batch bigint,digest text,bytes bigint)
     LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.session,b.batch,b.digest,b.bytes
         FROM ${sessionAttemptBindingFunction}(in_secret_digest,in_generation) k
         CROSS JOIN LATERAL ${writerNamedReadableSessions} readable
         JOIN session_store_batch b ON b.tenant=k.tenant AND b.project=k.project
                                   AND b.session=readable.session
        WHERE b.stream=in_stream AND b.batch>coalesce(in_after,0)
          AND (readable.ceiling IS NULL OR b.batch<=readable.ceiling)
        ORDER BY b.batch
        LIMIT least(coalesce(in_limit,${sessionStorePageBatchesMax}),
                    ${sessionStorePageBatchesMax})
     $$`,
  `ALTER FUNCTION ${sessionStoreReadFunction}(${storeReadSignature})
     OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sessionStoreReadFunction}(${storeReadSignature})
     FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${sessionStoreReadFunction}(${storeReadSignature})
     TO ${workerPlaneRole}`,
];

/** A batch row the plane answers says which session wrote it. */
export const migration069: Migration = {
  version: 69,
  name: "a store row says which session wrote the batch",
  statements: [...writerNamingRead],
};
