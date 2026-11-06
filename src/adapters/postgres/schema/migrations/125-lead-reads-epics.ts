/**
 * A lead reads a project's epics, so the tool allowlist its decisions are
 * judged by names the four epic reads, at the place the lead's roster holds
 * them.
 *
 * ONLY THE LIST 089 LEFT MOVES, and it moves the way 066 moved the baseline's:
 * in place, history included, at the revision it stood at, an owner's list and
 * a project's own left as they are.
 *
 * THE LISTS ARE 089'S AND FOUR NAMES, so what this installed stays what it says
 * whatever the roster becomes. The epic writes are not widened: a lead
 * originates no work.
 */

import type { Migration } from "../shared.ts";
import {
  toolAllowlistNamed,
  toolAllowlistWidened,
} from "./066-lead-lists-repositories.ts";
import { toolAllowlistAt089 } from "./089-lead-reads-abilities.ts";

/** The tools 089's allowlist is widened by, each after the one before it. */
const readTools = [
  "mcp__chuggy__list_epics",
  "mcp__chuggy__read_epic",
  "mcp__chuggy__read_epic_history",
  "mcp__chuggy__read_epic_graph",
] as const;
const readAfter = "mcp__chuggy__read_abilities";

/** 089's allowlist with the epic reads in their roster place. */
export function toolAllowlistAt125(): readonly string[] {
  return readTools.reduce(
    (allowlist, tool, at) =>
      toolAllowlistNamed(allowlist, tool, readTools[at - 1] ?? readAfter),
    toolAllowlistAt089(),
  );
}

export const migration125: Migration = {
  version: 125,
  name: "a lead reads a project's epics",
  statements: [
    toolAllowlistWidened(
      "selector_runtime_settings",
      toolAllowlistAt089(),
      toolAllowlistAt125(),
    ),
    toolAllowlistWidened(
      "selector_runtime_settings_history",
      toolAllowlistAt089(),
      toolAllowlistAt125(),
    ),
  ],
};
