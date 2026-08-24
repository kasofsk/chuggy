import type { Migration } from "../shared.ts";

const tenureFence = [
  `CREATE FUNCTION project_tenure_is_fenced() RETURNS trigger
     LANGUAGE plpgsql AS $$
     DECLARE
       was_live boolean;
       is_live  boolean;
     BEGIN
       IF NEW.fencing_epoch < OLD.fencing_epoch THEN
         RAISE EXCEPTION
           'project %/% would move its fencing epoch backwards, and a fence only advances',
           OLD.tenant, OLD.project
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       was_live := OLD.owner IS NOT NULL AND OLD.lease_expires_at > now();
       is_live  := NEW.owner IS NOT NULL AND NEW.lease_expires_at > now();
       IF is_live AND NEW.fencing_epoch = OLD.fencing_epoch
          AND NOT (was_live
                   AND NEW.owner = OLD.owner
                   AND NEW.recovery_epoch IS NOT DISTINCT FROM OLD.recovery_epoch)
       THEN
         RAISE EXCEPTION
           'project %/% would take a tenure without advancing its fencing epoch',
           OLD.tenant, OLD.project
           USING ERRCODE = 'integrity_constraint_violation';
       END IF;
       RETURN NEW;
     END
     $$`,
  `CREATE TRIGGER project_tenure_is_fenced
     BEFORE UPDATE ON project
     FOR EACH ROW EXECUTE FUNCTION project_tenure_is_fenced()`,
];

export const migration004: Migration = {
  version: 4,
  name: "the tenure fence",
  statements: [...tenureFence],
};
