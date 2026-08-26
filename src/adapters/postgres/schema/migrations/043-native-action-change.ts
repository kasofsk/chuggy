/**
 * Puts a ticket's open questions on the change log, so a person watching learns
 * that one is waiting on them without refetching.
 *
 * THE WRITER IS A TRIGGER ON THE ROW AND NOT A CALL AT EACH DOOR. Three
 * transactions move `native_action` — the project writer opens and withdraws an
 * escalation or a blocked handoff, the same writer records an answer, and
 * `request_finalization_approval` opens an approval from the finalizer's own
 * boundary — and a kind published at two of the three is a kind a console
 * cannot trust. The trigger is the whole of it, the way `execution`'s is, and a
 * writer added later reaches it without being told to.
 *
 * IT APPENDS DIRECTLY RATHER THAN PUBLISHING. `publish_project_notification`
 * numbers a publication by updating the project row, which
 * `request_finalization_approval` does not take today; the append takes no row
 * lock at all, so this relation adds nothing to the order
 * `src/adapters/postgres/scheduler.ts` declares. Polled notifications are an
 * agent's feed and gain nothing from a question addressed to a person, so
 * `notificationKinds` is unchanged and `NativeAction` joins `Execution` as a
 * kind the durable log carries and the publication log does not.
 *
 * THE KIND CHECK IS REPLACED RATHER THAN LEFT TO MIGRATION 038. That
 * constraint is generated from `allProjectChangeKinds`, so a fresh install
 * already writes the wider one; an installation that ran 038 before this kind
 * existed holds the narrower one and its ledger will never run 038 again.
 */

import { allProjectChangeKinds } from "../../../../interpreter/projectChange.ts";
import {
  boundaryOwnerRole,
  projectChangeAppendFunction,
  projectChangeNativeActionFunction,
  schemaTextSet,
  ticketServiceRole,
  type Migration,
} from "../shared.ts";

const appendSignature = `${projectChangeAppendFunction}(text,text,text,text)`;

export const migration043: Migration = {
  version: 43,
  name: "a ticket's open actions on the change log",
  statements: [
    `ALTER TABLE project_change
       DROP CONSTRAINT project_change_kind_is_known,
       ADD CONSTRAINT project_change_kind_is_known CHECK
         (kind IN (${schemaTextSet([...allProjectChangeKinds])}))`,
    `CREATE FUNCTION ${projectChangeNativeActionFunction}() RETURNS trigger
       LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
       BEGIN
         PERFORM ${projectChangeAppendFunction}(
           NEW.tenant,NEW.project,'NativeAction',NEW.ticket::text);
         RETURN NULL;
       END $$`,
    `ALTER FUNCTION ${projectChangeNativeActionFunction}() OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${projectChangeNativeActionFunction}() FROM PUBLIC`,
    `CREATE TRIGGER native_action_opening_appends_a_change
       AFTER INSERT ON native_action
       FOR EACH ROW EXECUTE FUNCTION ${projectChangeNativeActionFunction}()`,
    `CREATE TRIGGER native_action_settlement_appends_a_change
       AFTER UPDATE OF state ON native_action
       FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
       EXECUTE FUNCTION ${projectChangeNativeActionFunction}()`,
    `GRANT EXECUTE ON FUNCTION ${appendSignature} TO ${ticketServiceRole}`,
  ],
};
