/**
 * The configuration importer moves a Pending ticket that follows its
 * configuration's newest revision onto the revision its repository's head
 * declares under the same name, through two doors granted to it alone.
 *
 * THE CANDIDATES ARE READ BY TICKET, FILTERED HERE. A candidate is Pending,
 * holds a revision imported from the repository named, and is not on the one
 * the head declares under that revision's name; it follows `Latest` by its
 * selection's `configuration`, else by its held catalog's
 * `defaults.configuration`; and its draft is at the revision it was released
 * from, or one ahead of it by the importer alone. Each row carries what its
 * last release or update froze, and the canonical of each distinct revision on
 * the first row naming it.
 *
 * A MOVE IS BUILT FROM WHAT THE TICKET WAS RELEASED WITH, never from the draft
 * head, whose brief is one row revised in place. Under the project lock the
 * door revises the draft to the head's revision, carrying the released brief,
 * overrides, selection and dependencies with the program it is handed, and
 * hands `UpdateTicket` to `accept_operation` under the `Service` authority, a
 * key per ticket, expected revision and head revision, and the mailbox's
 * bounds. A draft holding anyone else's unreleased revision is answered
 * `Stale` and not revised.
 *
 * AN ANSWER BUT ACCEPTANCE UNDOES THE REVISE. `accept_operation` answers its
 * refusals, `Original` among them, as rows, so the door raises its own
 * SQLSTATE on any of them inside one block, catches it outside and answers it,
 * leaving the draft where it was. `revise_draft`'s own refusals are answered
 * the same way.
 */

import {
  boundaryOwnerRole,
  configurationFollowingCandidatesFunction,
  configurationFollowingMoveFunction,
  configurationImporterRole,
  type Migration,
} from "../shared.ts";

const candidates = `public.${configurationFollowingCandidatesFunction}(in_tenant text, in_project text, in_repository text, in_commit text, in_authority_subject text, in_after bigint, in_max integer)`;

const move = `public.${configurationFollowingMoveFunction}(in_tenant text, in_project text, in_ticket bigint, in_expected_revision bigint, in_configuration text, in_program text, in_operation text, in_authority_subject text, in_ordinary_soft_limit bigint, in_hard_limit bigint)`;

/** The SQLSTATE the move door raises to undo its revise, and catches. */
const moveRefused = "CHF01";

/** One array of the released brief, in its order. */
function briefArray(field: string): string {
  return `ARRAY(SELECT x.value FROM jsonb_array_elements_text(COALESCE(brief->'${field}','[]'::jsonb)) WITH ORDINALITY AS x(value, ordinal) ORDER BY x.ordinal)`;
}

/** The owner and the one grant each door ends with, the importer the only caller. */
function owned(signature: string): readonly string[] {
  return [
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${configurationImporterRole}`,
  ];
}

export const migration102: Migration = {
  version: 102,
  name: "the importer moves a ticket following its newest configuration revision",
  statements: [
    `CREATE FUNCTION ${candidates}
       RETURNS TABLE(ticket bigint, revision bigint, held text, held_canonical text,
         head text, head_canonical text, brief text, overrides text, selection text,
         authoring text)
       LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       WITH found AS (
         SELECT t.ticket, t.revision, t.configuration_revision AS held,
                c.canonical AS held_canonical, h.revision AS head,
                k.canonical AS head_canonical, d.brief::text AS brief,
                d.overrides::text AS overrides, d.selection::text AS selection,
                r.authoring
           FROM ticket_projection t
           JOIN repository_configuration_provenance p
             ON p.tenant = t.tenant AND p.project = t.project
            AND p.revision = t.configuration_revision
            AND p.repository = in_repository
           JOIN repository_configuration_provenance h
             ON h.tenant = t.tenant AND h.project = t.project
            AND h.repository = in_repository AND h.repository_commit = in_commit
            AND h.name = p.name
           JOIN configuration_revision c
             ON c.tenant = t.tenant AND c.project = t.project
            AND c.revision = t.configuration_revision
           JOIN configuration_revision k
             ON k.tenant = t.tenant AND k.project = t.project
            AND k.revision = h.revision
           JOIN ticket_definition d
             ON d.tenant = t.tenant AND d.project = t.project AND d.ticket = t.ticket
           JOIN draft e
             ON e.tenant = t.tenant AND e.project = t.project AND e.ticket = t.ticket
            AND e.state = 'Released'
           JOIN draft_revision r
             ON r.tenant = e.tenant AND r.project = e.project AND r.ticket = e.ticket
            AND r.authoring_version = e.released_authoring_version
           JOIN draft_revision n
             ON n.tenant = e.tenant AND n.project = e.project AND n.ticket = e.ticket
            AND n.authoring_version = e.authoring_version
          WHERE t.tenant = in_tenant AND t.project = in_project
            AND t.phase = 'Pending' AND t.ticket > in_after
            AND t.configuration_revision <> h.revision
            AND d.brief IS NOT NULL
            AND (e.authoring_version = e.released_authoring_version
                 OR (n.authority_kind = 'Service'
                     AND n.authority_subject = in_authority_subject))
            AND COALESCE(d.selection->>'configuration',
                  (c.canonical::jsonb)->'defaults'->>'configuration',
                  'Pinned') = 'Latest'
          ORDER BY t.ticket
          LIMIT in_max
       )
       SELECT f.ticket, f.revision, f.held,
              CASE WHEN row_number() OVER (PARTITION BY f.held ORDER BY f.ticket) = 1
                   THEN f.held_canonical END,
              f.head,
              CASE WHEN row_number() OVER (PARTITION BY f.head ORDER BY f.ticket) = 1
                   THEN f.head_canonical END,
              f.brief, f.overrides, f.selection, f.authoring
         FROM found f
        ORDER BY f.ticket
     $$`,
    ...owned(candidates),
    `CREATE FUNCTION ${move}
       RETURNS TABLE(result text, operation text)
       LANGUAGE plpgsql SECURITY DEFINER
       SET search_path TO 'pg_catalog', 'public', 'pg_temp'
     AS $$
       DECLARE held record; revised record; accepted record; answer text;
         brief jsonb; command_text text; move_key text; payload text;
       BEGIN
         PERFORM 1 FROM project p
          WHERE p.tenant = in_tenant AND p.project = in_project FOR UPDATE;
         SELECT e.authoring_version, e.released_authoring_version, d.brief,
                d.overrides::text AS overrides, d.selection::text AS selection,
                r.authoring, n.authority_kind, n.authority_subject
           INTO held
           FROM draft e
           JOIN ticket_definition d
             ON d.tenant = e.tenant AND d.project = e.project AND d.ticket = e.ticket
           JOIN draft_revision r
             ON r.tenant = e.tenant AND r.project = e.project AND r.ticket = e.ticket
            AND r.authoring_version = e.released_authoring_version
           JOIN draft_revision n
             ON n.tenant = e.tenant AND n.project = e.project AND n.ticket = e.ticket
            AND n.authoring_version = e.authoring_version
          WHERE e.tenant = in_tenant AND e.project = in_project
            AND e.ticket = in_ticket AND e.state = 'Released'
            AND d.brief IS NOT NULL
            FOR UPDATE OF e;
         IF NOT FOUND THEN
           RETURN QUERY SELECT 'NotFound'::text, NULL::text;
           RETURN;
         END IF;
         IF held.authoring_version <> held.released_authoring_version
            AND NOT (held.authority_kind = 'Service'
                     AND held.authority_subject = in_authority_subject) THEN
           RETURN QUERY SELECT 'Stale'::text, NULL::text;
           RETURN;
         END IF;
         brief := held.brief;
         BEGIN
           SELECT * INTO revised FROM revise_draft(
             in_tenant, in_project, in_ticket, held.authoring_version,
             in_configuration,
             jsonb_set(held.authoring::jsonb, '{program}', in_program::jsonb)::text,
             brief->>'title', brief->>'intent', ${briefArray("links")},
             ${briefArray("images")}, ${briefArray("checks")}, brief->>'branch',
             brief->'finalization'->>'mode', brief->'finalization'->>'target',
             brief->>'repository', held.overrides, held.selection, 'Service',
             in_authority_subject);
           IF revised.result IS DISTINCT FROM 'Revised' THEN
             answer := revised.result;
             RAISE EXCEPTION USING ERRCODE = '${moveRefused}';
           END IF;
           command_text := jsonb_build_object('version', 1,
             'command', 'UpdateTicket', 'ticket', in_ticket,
             'expectedRevision', in_expected_revision,
             'authoringVersion', revised.authoring_version,
             'configurationRevision', in_configuration)::text;
           move_key := encode(sha256(convert_to('configuration-following:'
             || in_ticket::text || ':' || in_expected_revision::text || ':'
             || in_configuration, 'UTF8')), 'hex');
           payload := encode(sha256(convert_to(command_text, 'UTF8')), 'hex');
           SELECT * INTO accepted FROM accept_operation(
             in_tenant, in_project, in_operation, 'Service', in_authority_subject,
             'configuration-following-v1', move_key, payload, ARRAY[move_key],
             ARRAY[payload], command_text, in_ordinary_soft_limit, in_hard_limit,
             NULL);
           IF accepted.result IS DISTINCT FROM 'Accepted' THEN
             answer := accepted.result;
             RAISE EXCEPTION USING ERRCODE = '${moveRefused}';
           END IF;
         EXCEPTION WHEN SQLSTATE '${moveRefused}' THEN
           RETURN QUERY SELECT answer, NULL::text;
           RETURN;
         END;
         RETURN QUERY SELECT 'Accepted'::text, accepted.operation::text;
       END
     $$`,
    ...owned(move),
  ],
};
