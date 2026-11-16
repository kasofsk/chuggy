/**
 * A theme put on the document: its assignments set on the root through the
 * object model, which the served policy leaves to script, and kept for the
 * next load's first paint.
 *
 * What the first paint wears can only be what this browser kept from the last
 * time the same scope was drawn, since the server's answer comes after it; the
 * answer then corrects it. A theme refused for its contrast is said once to
 * the developer tools, however often it is answered.
 */

import { logWarned } from "./ports.ts";
import type { consoleRouter } from "./routes.tsx";
import type { ThemeDocument } from "../../../../src/contract/appearance.ts";
import type { KeyValuePort } from "../core/sessionHolder.ts";
import {
  themeAssignmentsOf,
  themeCacheRead,
  themeCacheWrite,
  themeScopeOf,
  themeTokens,
  themeWorn,
} from "../core/themeTokens.ts";
import type { ThemeAssignment, ThemeScope } from "../core/themeTokens.ts";

/** Every token a theme may set taken off the root, then `assignments` set. */
export function themeAssignmentsPut(
  root: HTMLElement,
  assignments: readonly ThemeAssignment[],
): void {
  for (const property of themeTokens) root.style.removeProperty(property);
  for (const { property, value } of assignments)
    root.style.setProperty(property, value);
}

/** The scope an address is drawn in, as the console's router reads it. */
export function themeScopeAt(
  router: typeof consoleRouter,
  pathname: string,
): ThemeScope {
  const partition = router
    .matchRoutes(pathname)
    .find((match) => match.routeId === "/$tenant/$project");
  return partition === undefined ? undefined : themeScopeOf(partition.params);
}

let themeRefusedSaid: string | undefined;

/** Wears `theme` in `scope` and keeps it; with no theme answered yet, wears
 * what was kept for the scope. */
export function themeWear(
  root: HTMLElement,
  store: KeyValuePort,
  scope: ThemeScope,
  theme: ThemeDocument | undefined,
): void {
  if (theme === undefined) {
    themeAssignmentsPut(root, themeCacheRead(store, scope));
    return;
  }
  const worn = themeWorn(theme);
  const refused = JSON.stringify(theme);
  if (worn.refused && themeRefusedSaid !== refused) {
    themeRefusedSaid = refused;
    logWarned(
      `the theme "${theme.name}" draws below the contrast rule, so the default is worn`,
    );
  }
  const assignments = themeAssignmentsOf(worn.theme);
  themeAssignmentsPut(root, assignments);
  themeCacheWrite(store, scope, assignments);
}
