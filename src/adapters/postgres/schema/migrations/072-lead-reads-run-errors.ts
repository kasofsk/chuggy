/**
 * A lead reads the error text an attempt's worker kept, so the tool allowlist
 * its decisions are judged by names `read_run_error`, at the place the lead's
 * roster holds it.
 *
 * ONLY THE LIST 068 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 068'S AND ONE NAME, so what this installed stays what it says
 * whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";
import { toolAllowlistAt068 } from "./068-lead-fetches-images.ts";

/** The tool 068's allowlist is widened by, and the one it follows. */
const readTool = "mcp__chuggy__read_run_error";
const readAfter = "mcp__chuggy__read_run_transcript";

/** 068's allowlist with `read_run_error` in its roster place. */
export function toolAllowlistAt072(): readonly string[] {
  return toolAllowlistNamed(toolAllowlistAt068(), readTool, readAfter);
}

export const migration072: Migration = {
  version: 72,
  name: "a lead reads a run's error text",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt068(),
      toolAllowlistAt072(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt068(),
      toolAllowlistAt072(),
    ),
  ],
};
