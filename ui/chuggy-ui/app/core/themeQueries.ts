/**
 * The reads a worn theme is resolved from: a project's, which the server has
 * already resolved through its layers, and outside every project the reader's
 * global choice and the theme of theirs it names. A write to any of them
 * invalidates its query by the query's own key, and the theme worn follows the
 * answer.
 */

import { endpointPath } from "../../../../src/contract/endpoints.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  ownedThemeSchema,
  projectAppearanceResponseSchema,
  themeChoiceResponseSchema,
} from "../../../../src/contract/responses.ts";

import { apiGet } from "./apiRoutes.ts";
import { consoleCallerQuery, consolePartitionQuery } from "./consoleQuery.ts";

/** The theme the project wears for the reader, and the layer it came from. */
export function projectAppearanceQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "appearance", (ports, signal) =>
    apiGet(
      ports,
      endpointPath(nativeHttpRoutes.projectAppearance, partition),
      (value) => projectAppearanceResponseSchema.parse(value),
      signal,
    ),
  );
}

/** The reader's own global choice, absent where they hold none. */
export function themeChoiceQuery() {
  return consoleCallerQuery("theme-choice", (ports, signal) =>
    apiGet(
      ports,
      nativeHttpRoutes.themeChoice,
      (value) => themeChoiceResponseSchema.parse(value),
      signal,
    ),
  );
}

/** One theme of the reader's own, by its number. */
export function ownedThemeQuery(theme: number) {
  return consoleCallerQuery(`theme-${String(theme)}`, (ports, signal) =>
    apiGet(
      ports,
      endpointPath(nativeHttpRoutes.ownTheme, { theme }),
      (value) => ownedThemeSchema.parse(value),
      signal,
    ),
  );
}
