import { apiRole, type Migration } from "../shared.ts";

export const migration025: Migration = {
  version: 25,
  name: "the installation authority",
  statements: [
    `DO $$
     BEGIN
       IF current_setting('chuggy.initializing_journal', true) = 'on' AND
          NULLIF(current_setting('chuggy.adopting_installation_id', true), '') IS NOT NULL THEN
         RAISE EXCEPTION 'a fresh journal generates its installation authority';
       ELSIF current_setting('chuggy.initializing_journal', true) IS DISTINCT FROM 'on' AND
             NULLIF(current_setting('chuggy.adopting_installation_id', true), '') IS NULL THEN
         RAISE EXCEPTION 'an existing journal has no installation authority';
       END IF;
     END
     $$`,
    `CREATE TABLE installation_authority (
       singleton       boolean PRIMARY KEY DEFAULT true CHECK (singleton),
       installation_id text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
       established_at  timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT installation_authority_id_is_canonical CHECK (
         installation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
     )`,
    `INSERT INTO installation_authority (installation_id)
     VALUES (COALESCE(
       NULLIF(current_setting('chuggy.adopting_installation_id', true), ''),
       gen_random_uuid()::text
     ))`,
    `GRANT SELECT ON installation_authority TO ${apiRole}`,
  ],
};
