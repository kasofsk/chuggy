import { apiRole, type Migration } from "../shared.ts";

/**
 * What the API needs to date a ticket, which is the journal and nothing beside
 * it. A projection row already names the sequence that wrote it, and a release
 * is an entry like any other, so both instants are a read of `committed_at` —
 * there is no column here for either, and no way for the projection to carry a
 * time the journal disagrees with.
 *
 * `entry` IS GRANTED BECAUSE THE RELEASE HAS NO OTHER KEY. Which entry released
 * a ticket is written only inside the encoded event, so the read has to look
 * there; `committed_at` is what it selects, `tenant` and `project` are what it
 * filters on, and `seq` is the key one join matches and the other orders by.
 * The grant is column-level and read-only, and the API role's writes to this
 * table remain the ones it never had.
 *
 * THE INDEX IS WHAT MAKES THE DERIVATION AFFORDABLE. Without it a ticket's
 * release instant costs a scan of its project's whole journal, and a page of
 * tickets costs one per row — which is the pressure that would otherwise buy a
 * stored copy of a fact the journal already holds. It is partial on the release
 * event and keyed on the ticket that event names, so the read is a lookup.
 *
 * THE COLUMN IS TEXT AND MAY NOT BE JSON. `../../journal.ts` returns a refusal
 * for a stored row it cannot parse rather than raising, so a row that is not
 * JSON is a state this table admits — and an index or a read casting one
 * unguarded would turn that row into a write the server rejects and a page
 * nobody can load. `entry::jsonb` is the only cast either of them makes and the
 * `CASE` is what keeps it off such a row; the ticket is compared as the JSON
 * value it is, so an entry carrying a release-shaped event with anything at all
 * where its ticket goes matches nothing rather than raising.
 *
 * THE READ REPEATS THESE EXPRESSIONS because that is what lets this index
 * answer it, and `test/postgres/migration.test.ts` is where that is asserted of
 * the index by name. Its scan count fails for any of the three reads whose
 * predicate stops implying this index's, and its tuple count fails for the
 * ticket's own read whose key stops matching this index's — a page read whose
 * key alone drifts is not covered, and kasofsk/chuggy#463 carries what it would
 * take to see one.
 */
export const migration056: Migration = {
  version: 56,
  name: "api journal instants",
  statements: [
    `GRANT SELECT (tenant, project, seq, entry, committed_at)
       ON journal_entry TO ${apiRole}`,
    `CREATE INDEX journal_entry_release_ticket ON journal_entry
       (tenant, project,
        ((CASE WHEN entry IS JSON OBJECT
               THEN entry::jsonb->'event'->'value'->'ticket' END)))
       WHERE (CASE WHEN entry IS JSON OBJECT
                   THEN entry::jsonb->'event'->>'type' END) = 'ReleaseTicket'`,
  ],
};
