/**
 * A lead reads its project's images, so the tool allowlist its decisions are
 * judged by names `fetch_image`, at the place the lead's roster holds it.
 *
 * ONLY THE LIST 066 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 066'S AND ONE NAME, so what this installed stays what it says
 * whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistAt066,
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";

/** The tool 066's allowlist is widened by, and the one it follows. */
const fetchedTool = "mcp__chuggy__fetch_image";
const fetchedAfter = "mcp__chuggy__list_repositories";

/** 066's allowlist with `fetch_image` in its roster place. */
export function toolAllowlistAt068(): readonly string[] {
  return toolAllowlistNamed(toolAllowlistAt066(), fetchedTool, fetchedAfter);
}

export const migration068: Migration = {
  version: 68,
  name: "a lead reads its project's images",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt066(),
      toolAllowlistAt068(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt066(),
      toolAllowlistAt068(),
    ),
  ],
};
