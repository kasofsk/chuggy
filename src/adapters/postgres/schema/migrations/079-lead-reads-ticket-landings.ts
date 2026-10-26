/**
 * A lead reads a ticket's landings, so the tool allowlist its decisions are
 * judged by names `read_ticket_landings`, at the place the lead's roster
 * holds it.
 *
 * ONLY THE LIST 072 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 072'S AND ONE NAME, so what this installed stays what it says
 * whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";
import { toolAllowlistAt072 } from "./072-lead-reads-run-errors.ts";

/** The tool 072's allowlist is widened by, and the one it follows. */
const readTool = "mcp__chuggy__read_ticket_landings";
const readAfter = "mcp__chuggy__read_ticket_refusals";

/** 072's allowlist with `read_ticket_landings` in its roster place. */
function toolAllowlistAt079(): readonly string[] {
  return toolAllowlistNamed(toolAllowlistAt072(), readTool, readAfter);
}

export const migration079: Migration = {
  version: 79,
  name: "a lead reads a ticket's landings",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt072(),
      toolAllowlistAt079(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt072(),
      toolAllowlistAt079(),
    ),
  ],
};
