/**
 * A lead reads a project's landing queues, so the tool allowlist its decisions
 * are judged by names `read_landing_queues`, at the place the lead's roster
 * holds it.
 *
 * ONLY THE LIST 125 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 125'S AND ONE NAME, so what this installed stays what it says
 * whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";
import { toolAllowlistAt125 } from "./125-lead-reads-epics.ts";

/** The tool 125's allowlist is widened by, and the one it follows. */
const readTool = "mcp__chuggy__read_landing_queues";
const readAfter = "mcp__chuggy__read_ticket_landings";

/** 125's allowlist with `read_landing_queues` in its roster place. */
function toolAllowlistAt159(): readonly string[] {
  return toolAllowlistNamed(toolAllowlistAt125(), readTool, readAfter);
}

export const migration159: Migration = {
  version: 159,
  name: "a lead reads a project's landing queues",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt125(),
      toolAllowlistAt159(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt125(),
      toolAllowlistAt159(),
    ),
  ],
};
