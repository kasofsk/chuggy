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
 * THE ROW IS THE ONLY THING THAT CAN SAY WHOSE DIRECTORY TO READ. The page spans
 * two sessions and the caller's identity names one of them, so the read that
 * resolved the fork reports the session each row came from and the plane reads
 * under that. It is also the fence: a session this read does not answer for is
 * one the plane never addresses an object under, so naming the writer widens
 * nothing.
 *
 * THE BODY IS 063'S OWN, SHARED RATHER THAN RESPELLED, because the predicate
 * that decides which sessions a bearer may read is the whole control and a copy
 * of it here is a second control to keep in step. Only the column list moves.
 *
 * THE WRITE AND THE STREAM LISTING ARE UNTOUCHED. `record_session_store_batch`
 * still writes under the bearer's own session alone, which is the asymmetry 063
 * exists to state; `list_session_streams` names streams rather than objects, so
 * it has no writer to report.
 */

import { sessionStorePageBatchesMax } from "../../../../contract/http.ts";
import { readableSessions } from "./063-lead-inquiries.ts";
import {
  boundaryOwnerRole,
  sessionAttemptBindingFunction,
  sessionStoreReadFunction,
  workerPlaneRole,
  type Migration,
} from "../shared.ts";

/** The argument types the read is named by, unchanged: only what it answers moves. */
const storeReadSignature = "text,bigint,text,bigint,bigint";

const writerNamingRead = [
  `DROP FUNCTION ${sessionStoreReadFunction}(${storeReadSignature})`,
  `CREATE FUNCTION ${sessionStoreReadFunction}(
     in_secret_digest text,in_generation bigint,in_stream text,
     in_after bigint,in_limit bigint)
     RETURNS TABLE(session text,batch bigint,digest text,bytes bigint)
     LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT b.session,b.batch,b.digest,b.bytes
         FROM ${sessionAttemptBindingFunction}(in_secret_digest,in_generation) k
         CROSS JOIN LATERAL ${readableSessions} readable
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
