/**
 * A draft and a repository's default finalization may name the `Stacked`
 * policy beside `Direct` and `Serialized`.
 */

import type { Migration } from "../shared.ts";

export const migration134: Migration = {
  version: 134,
  name: "a finalization policy may be Stacked",
  statements: [
    `ALTER TABLE public.draft_brief
     DROP CONSTRAINT draft_brief_finalization_policy_is_known,
     ADD CONSTRAINT draft_brief_finalization_policy_is_known CHECK ((finalization_policy = ANY (ARRAY['Direct'::text, 'Serialized'::text, 'Stacked'::text])))`,
    `ALTER TABLE public.project_repository
     DROP CONSTRAINT project_repository_landing_policy_is_known,
     ADD CONSTRAINT project_repository_landing_policy_is_known CHECK ((landing_policy = ANY (ARRAY['Direct'::text, 'Serialized'::text, 'Stacked'::text])))`,
  ],
};
