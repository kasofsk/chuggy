/**
 * The door that closes a member's thread, and the frame a session's own state
 * move writes.
 *
 * ANY MEMBER WHO MAY MUTATE THE PROJECT MAY CLOSE ANY OF ITS THREADS. A thread
 * files drafts and does nothing else, so closing one takes nothing away that
 * its owner cannot file again from a new one; the door therefore takes a
 * session and no principal, and the boundary's `Mutate` authorization is the
 * whole of the control (kasofsk/chuggy#585). It admits `kind='Thread'` alone,
 * so the API's grant reaches no lead and no inquiry through it.
 *
 * CLOSING IS 058's OWN CLOSE, REACHED THROUGH A NARROWER DOOR.
 * `close_agent_session` is granted to no runtime role because a role that could
 * close any session could end the project's lead; this definer is what the API
 * is granted instead, and it PERFORMs 058's as the boundary owner after it has
 * decided the row is a thread. The turns the thread still held are abandoned as
 * `SessionClosed`, which is the failure 058 reserved for a close.
 *
 * A CLOSE IS TERMINAL. `agent_session_is_written_once` refuses a closed session
 * moving off `Closed`, and `agent_session_one_thread_per_member` is partial on
 * `state='Open'` and so admits a new thread for the same member, so a member
 * whose thread was closed opens another rather than reopening this one — a
 * closed thread stays readable as what it was.
 *
 * THE STATE MOVE IS A `Session` FRAME LIKE A TURN'S. 059 writes a frame when a
 * turn lands or moves and when a batch is stored, and a page watching a session
 * re-reads on those; a close with no turn waiting moved none of them, so a
 * page would go on drawing the thread as open. The trigger fires on the state
 * column alone, for every kind of session, because a lead's page is owed the
 * same fact.
 */

import {
  apiRole,
  boundaryOwnerRole,
  projectChangeAppendFunction,
  projectChangeSessionStateFunction,
  sessionCloseFunction,
  threadCloseFunction,
  type Migration,
} from "../shared.ts";

const memberThreadClose = [
  `CREATE FUNCTION ${threadCloseFunction}(
     in_tenant text,in_project text,in_session text) RETURNS text
     LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
     DECLARE held record;
     BEGIN
       SELECT s.kind,s.state INTO held FROM agent_session s
        WHERE s.tenant=in_tenant AND s.project=in_project AND s.session=in_session
        FOR UPDATE;
       IF NOT FOUND OR held.kind<>'Thread' THEN RETURN 'NoThread'; END IF;
       IF held.state<>'Open' THEN RETURN 'AlreadyClosed'; END IF;
       PERFORM ${sessionCloseFunction}(in_tenant,in_project,in_session);
       RETURN 'Closed';
     END $$`,
  `ALTER FUNCTION ${threadCloseFunction}(text,text,text) OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${threadCloseFunction}(text,text,text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION ${threadCloseFunction}(text,text,text) TO ${apiRole}`,
];

const sessionStateChange = [
  `CREATE FUNCTION ${projectChangeSessionStateFunction}() RETURNS trigger
     LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
     BEGIN
       PERFORM ${projectChangeAppendFunction}(NEW.tenant,NEW.project,'Session',
         jsonb_build_object('session',NEW.session,'kind',NEW.kind,
                           'state',NEW.state)::text);
       RETURN NULL;
     END $$`,
  `ALTER FUNCTION ${projectChangeSessionStateFunction}() OWNER TO ${boundaryOwnerRole}`,
  `REVOKE ALL ON FUNCTION ${projectChangeSessionStateFunction}() FROM PUBLIC`,
  `CREATE TRIGGER agent_session_move_appends_a_change
     AFTER UPDATE OF state ON agent_session
     FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
     EXECUTE FUNCTION ${projectChangeSessionStateFunction}()`,
];

/** A member's thread closed through the API, and the frame that says so. */
export const migration075: Migration = {
  version: 75,
  name: "a member thread is closed through the API, and a state move is a frame",
  statements: [...memberThreadClose, ...sessionStateChange],
};
