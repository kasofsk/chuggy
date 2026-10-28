/**
 * A lead reads who it acts as and what it may do, so the tool allowlist its
 * decisions are judged by names `read_abilities`, at the place the lead's
 * roster holds it.
 *
 * ONLY THE LIST 088 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 088'S AND ONE NAME, so what this installed stays what it says
 * whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";
import { toolAllowlistAt088 } from "./088-lead-reads-docs.ts";

/** The tool 088's allowlist is widened by, and the one it follows. */
const readTool = "mcp__chuggy__read_abilities";
const readAfter = "mcp__chuggy__read_docs";

/** 088's allowlist with `read_abilities` in its roster place. */
function toolAllowlistAt089(): readonly string[] {
  return toolAllowlistNamed(toolAllowlistAt088(), readTool, readAfter);
}

export const migration089: Migration = {
  version: 89,
  name: "a lead reads its own abilities",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt088(),
      toolAllowlistAt089(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt088(),
      toolAllowlistAt089(),
    ),
  ],
};
