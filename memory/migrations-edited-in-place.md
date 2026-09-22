---
name: migrations-edited-in-place
description: "chuggy has had already-applied migrations edited in place; the ledger cannot detect it, and dump-and-diff against a freshly migrated database is how to find it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 42e009a8-f9b5-42de-b3e9-598eb72ef817
  modified: 2026-08-24T05:46:20.319Z
---

chuggy's migration ledger records only `(version, name)`, and
`schemaContractAccepts` compares only those. **A migration whose body is edited
after it has been applied is therefore invisible**: a database that ran the old
body reports `schema-compatible` forever while lacking whatever the new body
adds, and the only symptom is a runtime `column ... does not exist` — which then
dies silently, see [[chuggy-rig]].

This has actually happened: `6a67f0f` (2026-08-23) added five requirement
columns, three constraints, a trigger and four grants to the bodies of
migrations 12 and 15, which the rig had already applied. Fixed forward by
migration 19 in kasofsk/chuggy#255.

**How to detect it:** stand up a scratch PostgreSQL, run `postgresMigrate`
against an empty database, `pg_dump --schema-only` both it and the suspect
database, strip `ALTER ... OWNER TO` / `Owner:` / version-banner noise, and
diff — then `sort` both and diff again to separate real set differences from mere
column and grant ordering. That is what located this in minutes after hours of
guessing.

**How to apply:** fix forward with a new migration, never by reverting the edited
body — every database provisioned from current `main` has already applied the
edited version, so reverting puts *those* in the same trap. Make the new
migration idempotent (`ADD COLUMN IF NOT EXISTS`, `pg_constraint` lookups before
`ADD CONSTRAINT`) so it no-ops on a fresh database, and remember that migration
12 ends by revoking the migrating role's `chuggy_boundary_owner` membership — so
a later migration cannot `CREATE OR REPLACE` a function that role owns, only
create it when absent. Prove it by convergence: a stripped database given the new
migration must dump identical *as a set* to a freshly migrated one.
