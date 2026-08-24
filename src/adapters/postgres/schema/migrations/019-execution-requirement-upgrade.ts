import {
  apiRole,
  boundaryOwnerRole,
  schedulerRole,
  type Migration,
} from "../shared.ts";
import {
  executionMovesLegallyDefinition,
  executionRequirementColumnNames,
  executionRequirementColumns,
  materializeLegacyRequirementDefinition,
} from "./012-durable-execution-scheduler.ts";

const executionRequirementUpgrade = [
  `ALTER TABLE execution
     ${executionRequirementColumns
       .map(({ name, type }) => `ADD COLUMN IF NOT EXISTS ${name} ${type}`)
       .join(",\n     ")}`,
  `UPDATE execution e SET
     requirement_identity=e.execution,
     requirement_value=jsonb_build_object('mode','Container','operatingSystem','Linux',
       'architecture','Amd64','image',c.canonical::jsonb->>'image'),
     requirement_digest=encode(sha256(convert_to(format(
       '{"mode":"Container","operatingSystem":"Linux","architecture":"Amd64","image":%s}',
       to_json(c.canonical::jsonb->>'image')::text),'UTF8')),'hex'),
     requirement_source='PlatformDefault',
     platform_default_version=1
     FROM configuration_revision c
    WHERE c.tenant=e.tenant AND c.project=e.project
      AND c.revision=e.configuration_revision AND c.digest=e.configuration_digest
      AND e.requirement_identity IS NULL`,
  `ALTER TABLE execution
     ${executionRequirementColumns
       .map(({ name }) => `ALTER COLUMN ${name} SET NOT NULL`)
       .join(",\n     ")}`,
  `DO $upgrade$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid='execution'::regclass
                       AND conname='execution_requirement_identity_unique') THEN
       ALTER TABLE execution
         ADD CONSTRAINT execution_requirement_identity_unique UNIQUE (requirement_identity);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid='execution'::regclass
                       AND conname='execution_requirement_source_known') THEN
       ALTER TABLE execution
         ADD CONSTRAINT execution_requirement_source_known CHECK (requirement_source IN
           ('ExplicitTask','TaskKindDefault','TicketDefault','PlatformDefault'));
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid='execution'::regclass
                       AND conname='execution_platform_default_version_positive') THEN
       ALTER TABLE execution
         ADD CONSTRAINT execution_platform_default_version_positive CHECK (
           platform_default_version >= 1);
     END IF;
   END $upgrade$`,
  `DO $upgrade$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                     WHERE n.nspname='public'
                       AND p.proname='materialize_legacy_execution_requirement') THEN
       CREATE ${materializeLegacyRequirementDefinition};
       ALTER FUNCTION materialize_legacy_execution_requirement()
         OWNER TO ${boundaryOwnerRole};
       REVOKE ALL ON FUNCTION materialize_legacy_execution_requirement() FROM PUBLIC;
       CREATE TRIGGER execution_materializes_legacy_requirement
         BEFORE INSERT ON execution FOR EACH ROW
         EXECUTE FUNCTION materialize_legacy_execution_requirement();
     END IF;
   END $upgrade$`,
  `CREATE OR REPLACE ${executionMovesLegallyDefinition}`,
  `GRANT SELECT ON configuration_revision TO ${schedulerRole}`,
  `GRANT INSERT (${executionRequirementColumnNames})
     ON execution TO ${schedulerRole}`,
  `GRANT SELECT (${executionRequirementColumnNames})
     ON execution TO ${apiRole}`,
];

export const migration019: Migration = {
  version: 19,
  name: "the execution requirement a migrated database never got",
  statements: [...executionRequirementUpgrade],
};
