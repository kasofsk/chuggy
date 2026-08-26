import { resultReportCharsMax } from "../../../../interpreter/resultManifest.ts";
import {
  boundaryOwnerRole,
  schedulerRole,
  workerPlaneRole,
  workerResultReportFunction,
  type Migration,
} from "../shared.ts";

/** Retains a bounded worker summary so later evaluation tasks can review the same work evidence. */
export const migration037: Migration = {
  version: 37,
  name: "evaluation work reports",
  statements: [
    `CREATE TABLE execution_result_report (
       tenant text NOT NULL,
       project text NOT NULL,
       manifest text NOT NULL,
       report text NOT NULL,
       PRIMARY KEY (tenant,project,manifest),
       FOREIGN KEY (tenant,project,manifest)
         REFERENCES execution_result(tenant,project,manifest),
       CHECK (length(report) BETWEEN 1 AND ${resultReportCharsMax}),
       CHECK (report !~ '[[:cntrl:]]'))`,
    `CREATE TRIGGER execution_result_report_is_written_once
       BEFORE UPDATE OR DELETE ON execution_result_report
       FOR EACH ROW EXECUTE FUNCTION execution_result_is_immutable()`,
    `CREATE FUNCTION ${workerResultReportFunction}(
       in_secret_digest text,in_manifest text,in_report text) RETURNS boolean
       LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       BEGIN
         INSERT INTO execution_result_report(tenant,project,manifest,report)
           SELECT r.tenant,r.project,r.manifest,in_report
             FROM execution_attempt a
             JOIN execution_result r
               ON r.tenant=a.tenant AND r.project=a.project
              AND r.attempt=a.attempt AND r.manifest=in_manifest
            WHERE a.capability_secret_digest=in_secret_digest
              AND r.schema_version>=3
           ON CONFLICT DO NOTHING;
         IF FOUND THEN RETURN true; END IF;
         RETURN EXISTS(
           SELECT 1 FROM execution_attempt a
           JOIN execution_result_report r
             ON r.tenant=a.tenant AND r.project=a.project
            AND r.manifest=in_manifest AND r.report=in_report
           WHERE a.capability_secret_digest=in_secret_digest);
       END $$`,
    `ALTER FUNCTION ${workerResultReportFunction}(text,text,text)
       OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${workerResultReportFunction}(text,text,text) FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${workerResultReportFunction}(text,text,text)
       TO ${workerPlaneRole}`,
    `GRANT SELECT ON execution_attempt,execution_result TO ${boundaryOwnerRole}`,
    `GRANT INSERT,SELECT ON execution_result_report TO ${boundaryOwnerRole}`,
    `GRANT INSERT,SELECT ON execution_result_report TO ${schedulerRole}`,
  ],
};
