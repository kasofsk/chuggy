/**
 * What a double of `ProjectAccess` answers for a question its case is not
 * about, so each double states only the answers its case turns on.
 */

import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";

/** The site question, refused: nobody holds anything on the site here. */
export const projectAccessSiteRefused: ProjectAccess["authorizeSite"] = () =>
  Promise.resolve(undefined);
