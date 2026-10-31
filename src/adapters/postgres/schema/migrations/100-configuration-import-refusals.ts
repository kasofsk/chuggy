/**
 * A refused configuration import keeps why it was refused: its first
 * refusals, each as the import found it, and how many there were.
 *
 * THE REFUSALS ARE THE ROW'S AND MOVE WITH IT. `refusals` is an array of at
 * most `repositoryConfigurationImportRefusalsKeptMax` as it stands here,
 * written out rather than read from it, and `refusal_count` is how many the
 * import was refused for. Both are present on a `DeclarationsRefused` the door
 * keeps and on no other result, so the attempt that replaces a refused one
 * clears them. A refused attempt kept before this holds neither, and is
 * replaced by the next import of its binding.
 *
 * THE DOOR IS DROPPED AND RECREATED, because a function's arguments cannot be
 * widened in place, and is owned, withheld from the public and granted to the
 * roles 067 gave it again.
 */

import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  repositoryConfigurationImportRecordFunction,
  type Migration,
} from "../shared.ts";

const signatureOld = `public.${repositoryConfigurationImportRecordFunction}(in_tenant text, in_project text, in_repository text, in_commit text, in_result text, in_absent text)`;
const signature = `public.${repositoryConfigurationImportRecordFunction}(in_tenant text, in_project text, in_repository text, in_commit text, in_result text, in_absent text, in_refusals jsonb, in_refusal_count integer)`;

export const migration100: Migration = {
  version: 100,
  name: "a refused configuration import keeps its first refusals",
  statements: [
    `ALTER TABLE public.repository_configuration_import
       ADD COLUMN refusals jsonb,
       ADD COLUMN refusal_count integer,
       ADD CONSTRAINT repository_configuration_import_refusals_are_a_refused_imports
         CHECK (refusals IS NULL OR result = 'DeclarationsRefused'),
       ADD CONSTRAINT repository_configuration_import_refusals_are_counted
         CHECK ((refusals IS NULL) = (refusal_count IS NULL)),
       ADD CONSTRAINT repository_configuration_import_refusals_are_bounded
         CHECK (refusals IS NULL OR CASE WHEN jsonb_typeof(refusals) = 'array'
                THEN jsonb_array_length(refusals) BETWEEN 1 AND 5
                     AND refusal_count >= jsonb_array_length(refusals)
                ELSE false END)`,
    `GRANT UPDATE(refusals,refusal_count) ON TABLE public.repository_configuration_import TO ${boundaryOwnerRole}`,
    `DROP FUNCTION ${signatureOld}`,
    `CREATE FUNCTION ${signature} RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
       INSERT INTO repository_configuration_import AS kept
         (tenant,project,repository,attempted_at,repository_commit,result,absent,
          refusals,refusal_count)
       VALUES(in_tenant,in_project,in_repository,now(),in_commit,in_result,
              in_absent,in_refusals,in_refusal_count)
       ON CONFLICT (tenant,project,repository) DO UPDATE
          SET attempted_at=EXCLUDED.attempted_at,
              repository_commit=EXCLUDED.repository_commit,
              result=EXCLUDED.result,
              absent=EXCLUDED.absent,
              refusals=EXCLUDED.refusals,
              refusal_count=EXCLUDED.refusal_count
        WHERE kept.attempted_at <= EXCLUDED.attempted_at
     $$`,
    `ALTER FUNCTION ${signature} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO ${apiRole}, ${configurationImporterRole}`,
  ],
};
