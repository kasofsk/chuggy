import { priorWorkReportsMax } from "../../../../interpreter/taskBriefing.ts";
import {
  boundaryOwnerRole,
  schedulerRole,
  schedulerWorkReportsFunction,
  type Migration,
} from "../shared.ts";

/** Lets briefing composition follow the immutable result references pinned into an execution. */
export const migration044: Migration = {
  version: 44,
  name: "scheduler evaluation report inputs",
  statements: [
    `CREATE FUNCTION ${schedulerWorkReportsFunction}(
       in_tenant text,in_project text,in_execution text) RETURNS TABLE(report text)
       LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT r.report
         FROM execution e
         JOIN execution_request q
           ON q.tenant=e.tenant AND q.project=e.project
          AND q.request=e.source_request
         JOIN input_bundle_reference b
           ON b.tenant=q.tenant AND b.project=q.project
          AND b.bundle=q.input_bundle AND b.reference_kind='ResultManifest'
         JOIN execution_result_report r
           ON r.tenant=b.tenant AND r.project=b.project
          AND r.manifest=b.reference_id
        WHERE e.tenant=in_tenant AND e.project=in_project
          AND e.execution=in_execution
        ORDER BY b.ordinal
        LIMIT ${priorWorkReportsMax + 1}
     $$`,
    `ALTER FUNCTION ${schedulerWorkReportsFunction}(text,text,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${schedulerWorkReportsFunction}(text,text,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${schedulerWorkReportsFunction}(text,text,text)
       TO ${schedulerRole}`,
  ],
};
