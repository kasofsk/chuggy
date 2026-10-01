import type { Migration } from "../shared.ts";

/**
 * A repository bound from here on lands by pull request, because a binding is
 * now a stranger's to make and their default branch should not take an agent's
 * push unasked. A binding that stands keeps the landing it has.
 */
export const migration028: Migration = {
  version: 28,
  name: "a repository bound from here on lands by pull request",
  statements: [
    `ALTER TABLE public.project_repository ALTER COLUMN landing_mode SET DEFAULT 'PullRequest'::text`,
  ],
};
