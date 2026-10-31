/**
 * A configuration revision may hold a canonical twice as long as it could.
 *
 * `configuration_revision_content_is_bounded` IS REPLACED at the length
 * `configurationCanonicalCharsMax` names here. It only widens, so no stored
 * row is refused by it.
 */

import type { Migration } from "../shared.ts";

const canonicalCharsMax = 131_072;

export const migration101: Migration = {
  version: 101,
  name: "a configuration revision holds a longer canonical",
  statements: [
    `ALTER TABLE public.configuration_revision
       DROP CONSTRAINT configuration_revision_content_is_bounded,
       ADD CONSTRAINT configuration_revision_content_is_bounded CHECK (((length(canonical) >= 1) AND (length(canonical) <= ${String(canonicalCharsMax)})))`,
  ],
};
