/**
 * The durable per-installation change log every user-visible state change
 * appends to, the doorbell an append rings, and the sweep that keeps it
 * bounded.
 *
 * AN APPEND TAKES NO ROW LOCK AT ALL. It is one insert of a row nothing else
 * has seen, so no other transaction can wait on it, and there is no allocation
 * behind it: `publish_project_notification` numbers a publication by updating
 * the project row, which serializes every publication behind that row, and a
 * generated identity replaces that with nothing. The relation carries no
 * foreign key to `project` for the same reason — the key check would take that
 * row under `KEY SHARE`, so an attempt update that takes no project lock today
 * would begin taking one *after* `execution_attempt`, which is the reverse of
 * the order `src/adapters/postgres/scheduler.ts` declares. So this relation
 * adds nothing to that order and appears nowhere in it, and every writer is a
 * trigger on a relation that carries the project key and its own constraint
 * already.
 *
 * RETENTION IS SWEPT BY A CALLER AND NOT BY AN APPENDER, which is why
 * `sweep_project_change` is its own function. Sweeping inside the
 * append would put back exactly what the generated identity removed: past the
 * bound every append would delete the same oldest rows, so two appenders on
 * one installation would wait on each other for the length of a transaction
 * that is otherwise moving an execution. The sweep instead runs on its own
 * connection and its own clock, deletes in ascending sequence so two of them
 * cannot hold each other's next row, and removes at most the bound its caller
 * declares — the same shape `src/adapters/postgres/scheduler.ts` gives its own
 * installation-wide sweeps.
 *
 * THE BOUND IS OVER THE INSTALLATION AND NOT OVER A PROJECT, so that a cursor
 * can be told from a gap. `project_change_retains` answers whether
 * the log still holds everything after a cursor, and it can only answer that
 * against one `min(sequence)`: a per-project bound over a global identity
 * leaves a quiet project's low sequence alive while a busy project's rows are
 * swept, and a consumer comparing against it is told there is no gap when
 * there is one.
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
 * nothing. It rings once whatever it appended, because the payload is
 * constant and the server collapses identical notifications in a transaction.
 *
 * THE FINALIZER IS GRANTED NOTHING HERE, and that is a reading of the tree
 * rather than an omission. It holds SELECT and no more on all four execution
 * relations and no INSERT on `project_notification`, so no path reaches the
 * append function as that role; a privilege nothing can exercise is one nobody
 * re-examines. It gets the grant on the day it writes something a trigger
 * watches.
 */

import {
  allProjectChangeKinds,
  projectChangeChannel,
  projectChangePayload,
  projectChangeResourceCharsMax,
  projectChangeRetentionMax,
} from "../../../../interpreter/projectChange.ts";
import {
  apiRole,
  boundaryOwnerRole,
  projectChangeAppendFunction,
  projectChangeArtifactFunction,
  projectChangeBridgeFunction,
  projectChangeExecutionFunction,
  projectChangeRetainedFunction,
  projectChangeSweepFunction,
  schedulerRole,
  schemaTextSet,
  type Migration,
} from "../shared.ts";

const appendSignature = `${projectChangeAppendFunction}(text,text,text,text)`;
const sweepSignature = `${projectChangeSweepFunction}(bigint)`;
const retainedSignature = `${projectChangeRetainedFunction}(bigint)`;

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
     DECLARE appended bigint;
     BEGIN
       INSERT INTO project_change (tenant,project,kind,resource)
       VALUES (in_tenant,in_project,in_kind,in_resource)
       RETURNING sequence INTO appended;
       PERFORM pg_notify('${projectChangeChannel}','${projectChangePayload}');
       RETURN appended;
     END $$`,
  `ALTER FUNCTION ${appendSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${appendSignature} FROM PUBLIC`,
  `CREATE FUNCTION ${projectChangeSweepFunction}(in_limit bigint) RETURNS bigint
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE removed bigint; cutoff bigint;
       retention_max constant bigint := ${projectChangeRetentionMax};
     BEGIN
       IF in_limit IS NULL OR in_limit < 1 THEN
         RAISE EXCEPTION 'a change sweep removes at least one row or is not a sweep'
           USING ERRCODE = 'invalid_parameter_value';
       END IF;
       SELECT sequence INTO cutoff FROM project_change
        ORDER BY sequence DESC OFFSET retention_max LIMIT 1;
       IF cutoff IS NULL THEN RETURN 0; END IF;
       DELETE FROM project_change
        WHERE sequence IN (SELECT stale.sequence FROM project_change AS stale
                            WHERE stale.sequence <= cutoff
                            ORDER BY stale.sequence LIMIT in_limit);
       GET DIAGNOSTICS removed = ROW_COUNT;
       RETURN removed;
     END $$`,
  `ALTER FUNCTION ${sweepSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${sweepSignature} FROM PUBLIC`,
  `CREATE FUNCTION ${projectChangeRetainedFunction}(in_cursor bigint) RETURNS boolean
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
       SELECT in_cursor >= coalesce(min(sequence),in_cursor + 1) - 1 FROM project_change
     $$`,
  `ALTER FUNCTION ${retainedSignature} OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${retainedSignature} FROM PUBLIC`,
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

  `GRANT EXECUTE ON FUNCTION ${appendSignature} TO ${schedulerRole}`,
  `GRANT EXECUTE ON FUNCTION ${sweepSignature}, ${retainedSignature} TO ${apiRole}`,
  `GRANT SELECT ON project_change TO ${apiRole}`,
];

export const migration038: Migration = {
  version: 38,
  name: "the durable project change log",
  statements: [...durableProjectChangeLog, ...projectChangeWriters],
};
