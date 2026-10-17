/**
 * A requirement stated as capabilities is written `Capability`, and one stored
 * as `ContainerCapability` before the rename still matches the pools that
 * declare it.
 *
 * NOTHING STORED IS REWRITTEN. A stored requirement is digested as it was
 * written, and `execution_moves_legally` holds its value and digest fixed, so
 * the old spelling stays where it was stored and every reader takes both.
 * `CREATE OR REPLACE` keeps the owner and grants 050 gave the function.
 */

import { workerPoolInventoryFunction, type Migration } from "../shared.ts";

const inventory = `public.${workerPoolInventoryFunction}(in_requirement jsonb, in_capabilities text[])`;

export const migration065: Migration = {
  version: 65,
  name: "a requirement stated as capabilities matches its pools under either name its mode has had",
  statements: [
    `CREATE OR REPLACE FUNCTION ${inventory} RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
       SELECT CASE
         WHEN in_requirement->>'mode' = 'Container' THEN
           'Platform:' || (in_requirement->>'operatingSystem') || ':' || (in_requirement->>'architecture')
             = ANY(in_capabilities)
         WHEN in_requirement->>'mode' IN ('Capability', 'ContainerCapability') THEN
           'Platform:' || (in_requirement->>'operatingSystem') || ':' || (in_requirement->>'architecture')
             = ANY(in_capabilities)
           AND ARRAY(SELECT jsonb_array_elements_text(in_requirement->'capabilities')) <@ in_capabilities
         ELSE false END
     $$`,
  ],
};
