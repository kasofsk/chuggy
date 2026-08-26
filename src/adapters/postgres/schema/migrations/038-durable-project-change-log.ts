/**
 * The durable per-installation change log every user-visible state change
 * appends to, and the doorbell an append rings.
 *
 * THE IDENTITY IS GLOBAL AND AN APPEND TAKES NO `project` ROW LOCK.
 * `publish_project_notification` allocates a per-project ordinal by updating
 * the project row, which serializes every publication behind it and puts
 * `project` inside any transaction that publishes. A generated identity needs
 * no allocation, and the relation carries no foreign key to `project` for the
 * same reason: the key check takes a `KEY SHARE` lock on that row, so an
 * attempt update that takes no project lock today would begin taking one
 * *after* `execution_attempt` — the reverse of the order
 * `src/adapters/postgres/scheduler.ts` declares. Every writer is a trigger on
 * a relation that carries the project key and its constraint already.
 *
 * `resource` IS THE IDENTITY THE PUBLIC GET ROUTE TAKES. A bridged row copies
 * the publication's own resource; an `Execution` row names the execution,
 * whichever of the four relations moved, because that is the resource a
 * consumer re-reads.
 *
 * AN UNCHANGED UPDATE IS SILENT. Each update trigger names the columns it
 * watches and repeats them in a `WHEN` predicate, so a statement assigning a
 * watched column its own value appends nothing — and a lease renewal, whose
 * columns no trigger names at all, never reaches one.
 *
 * ONE TRANSACTION MAY APPEND A RESOURCE MORE THAN ONCE, and that is left
 * alone: a consumer reads each named resource through its own GET and writes
 * the representation into its cache, so a repeat costs a read and changes
 * nothing. Collapsing them would need a per-transaction memory this relation
 * does not keep.
 *
 * RETENTION IS A COUNT PER PROJECT, swept inside the append function the way
 * `publish_project_notification` sweeps its own, so the log cannot grow
 * without bound and a consumer further behind than `projectChangeRetentionMax`
 * is reset rather than served a gap.
 */

import {
  allProjectChangeKinds,
  projectChangeChannel,
  projectChangeResourceCharsMax,
  projectChangeRetentionMax,
} from "../../../../interpreter/projectChange.ts";
import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  projectChangeAppendFunction,
  projectChangeArtifactFunction,
  projectChangeBridgeFunction,
  projectChangeExecutionFunction,
  schedulerRole,
  schemaTextSet,
  type Migration,
} from "../shared.ts";

const appendSignature = `${projectChangeAppendFunction}(text,text,text,text)`;

const durableProjectChangeLog = [
  `CREATE TABLE project_change (
     sequence   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     tenant     text NOT NULL,
     project    text NOT NULL,
     kind       text NOT NULL,
     resource   text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT project_change_kind_is_known CHECK
       (kind IN (${schemaTextSet([...allProjectChangeKinds])})),
     CONSTRAINT project_change_resource_is_bounded CHECK
       (length(resource) BETWEEN 1 AND ${projectChangeResourceCharsMax})
   )`,
  `CREATE INDEX project_change_by_project ON project_change (tenant,project,sequence)`,
  `CREATE FUNCTION ${projectChangeAppendFunction}(
      in_tenant text,in_project text,in_kind text,in_resource text) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE appended bigint; retention_max constant bigint := ${projectChangeRetentionMax};
     BEGIN
       INSERT INTO project_change (tenant,project,kind,resource)
       VALUES (in_tenant,in_project,in_kind,in_resource)
       RETURNING sequence INTO appended;
       PERFORM pg_notify('${projectChangeChannel}',appended::text);
       DELETE FROM project_change
        WHERE tenant=in_tenant AND project=in_project
          AND sequence <= (SELECT retained.sequence FROM project_change AS retained
                            WHERE retained.tenant=in_tenant AND retained.project=in_project
                            ORDER BY retained.sequence DESC OFFSET retention_max LIMIT 1);
       RETURN appended;
     END $$`,
  `ALTER FUNCTION ${appendSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${appendSignature} FROM PUBLIC`,
  `GRANT SELECT,INSERT,DELETE ON project_change TO ${boundaryOwnerRole}`,
];

const projectChangeWriters = [
  `CREATE FUNCTION ${projectChangeBridgeFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(NEW.tenant,NEW.project,NEW.kind,NEW.resource);
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION ${projectChangeBridgeFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectChangeBridgeFunction}() FROM PUBLIC`,
  `CREATE TRIGGER ${projectChangeBridgeFunction}
     AFTER INSERT ON project_notification
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeBridgeFunction}()`,

  `CREATE FUNCTION ${projectChangeExecutionFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(
         NEW.tenant,NEW.project,'Execution',NEW.execution);
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION ${projectChangeExecutionFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectChangeExecutionFunction}() FROM PUBLIC`,
  `CREATE TRIGGER execution_registration_appends_a_change
     AFTER INSERT ON execution
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,
  `CREATE TRIGGER execution_move_appends_a_change
     AFTER UPDATE OF status,outcome,result_manifest,terminal_at ON execution
     FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
       OR OLD.outcome IS DISTINCT FROM NEW.outcome
       OR OLD.result_manifest IS DISTINCT FROM NEW.result_manifest
       OR OLD.terminal_at IS DISTINCT FROM NEW.terminal_at)
     EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,
  `CREATE TRIGGER execution_attempt_opening_appends_a_change
     AFTER INSERT ON execution_attempt
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,
  `CREATE TRIGGER execution_attempt_move_appends_a_change
     AFTER UPDATE OF state,ended_at ON execution_attempt
     FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state
       OR OLD.ended_at IS DISTINCT FROM NEW.ended_at)
     EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,
  `CREATE TRIGGER execution_result_appends_a_change
     AFTER INSERT ON execution_result
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeExecutionFunction}()`,

  `CREATE FUNCTION ${projectChangeArtifactFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(NEW.tenant,NEW.project,'Execution',
         (SELECT named.execution FROM execution_result AS named
           WHERE named.tenant=NEW.tenant AND named.project=NEW.project
             AND named.manifest=NEW.manifest));
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION ${projectChangeArtifactFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectChangeArtifactFunction}() FROM PUBLIC`,
  `CREATE TRIGGER execution_artifact_appends_a_change
     AFTER INSERT ON execution_result_artifact
     FOR EACH ROW EXECUTE FUNCTION ${projectChangeArtifactFunction}()`,

  `GRANT EXECUTE ON FUNCTION ${appendSignature} TO ${schedulerRole},${finalizerRole}`,
  `GRANT SELECT ON project_change TO ${apiRole}`,
];

export const migration038: Migration = {
  version: 38,
  name: "the durable project change log",
  statements: [...durableProjectChangeLog, ...projectChangeWriters],
};
