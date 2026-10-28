/**
 * A lead reads chuggy's docs, so the tool allowlist its decisions are judged
 * by names `read_docs`, at the place the lead's roster holds it.
 *
 * ONLY THE LIST 079 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 079'S AND ONE NAME, so what this installed stays what it says
 * whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";
import { toolAllowlistAt079 } from "./079-lead-reads-ticket-landings.ts";

/** The tool 079's allowlist is widened by, and the one it follows. */
const readTool = "mcp__chuggy__read_docs";
const readAfter = "mcp__chuggy__fetch_image";

/** 079's allowlist with `read_docs` in its roster place. */
export function toolAllowlistAt088(): readonly string[] {
  return toolAllowlistNamed(toolAllowlistAt079(), readTool, readAfter);
}

export const migration088: Migration = {
  version: 88,
  name: "a lead reads chuggy's docs",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt079(),
      toolAllowlistAt088(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt079(),
      toolAllowlistAt088(),
    ),
  ],
};
