/**
 * A lead lists its project's repositories, so the tool allowlist its decisions
 * are judged by names `list_repositories`, at the place the lead's roster
 * holds it.
 *
 * ONLY THE LIST THE BASELINE SEEDED MOVES. The installation's allowlist, now
 * or at any revision of its history, is widened where it is still exactly that
 * list, whoever stored it; any other is left as it is, as is every project's
 * own allowlist.
 *
 * IT IS REWRITTEN IN PLACE, HISTORY INCLUDED, at the revision it stood at, as
 * 004 rewrote the observation budget, so a migrated installation and a fresh
 * one hold the same settings and the same history, and a revision restored
 * from that history judges the lead by its own roster.
 *
 * THE LISTS ARE THE BASELINE'S LITERAL AND ONE NAME, so what this installed
 * stays what it says whatever the roster becomes.
 */

import type { Migration } from "../shared.ts";
import { baselineToolAllowlist } from "./baseline/seed.ts";

/** The tool the baseline's allowlist is widened by, and the one it follows. */
const listedTool = "mcp__chuggy__list_repositories";
const listedAfter = "mcp__chuggy__read_thread_transcript";

/** The baseline's allowlist with `list_repositories` in its roster place. */
function toolAllowlistAt066(): readonly string[] {
  const at = baselineToolAllowlist.indexOf(listedAfter);
  if (at < 0 || baselineToolAllowlist.includes(listedTool))
    throw new Error("the baseline's allowlist is not the one 066 widens");
  return [
    ...baselineToolAllowlist.slice(0, at + 1),
    listedTool,
    ...baselineToolAllowlist.slice(at + 1),
  ];
}

/**
 * The statement that widens one relation's rows still holding the seeded list.
 * A row holding it as the seed wrote it keeps its text, the list alone replaced
 * as 004 replaced the budget, and any other is written as `jsonb` renders it.
 */
function toolAllowlistWidened(relation: string): string {
  const seeded = JSON.stringify(baselineToolAllowlist);
  const widened = JSON.stringify(toolAllowlistAt066());
  return `UPDATE public.${relation}
     SET controls = CASE
           WHEN strpos(controls, '"toolAllowlist":${seeded}') > 0
             THEN replace(controls, '"toolAllowlist":${seeded}',
                                    '"toolAllowlist":${widened}')
           ELSE jsonb_set(controls::jsonb, '{toolAllowlist}',
                          '${widened}'::jsonb)::text
         END
   WHERE controls::jsonb->'toolAllowlist' = '${seeded}'::jsonb`;
}

export const migration066: Migration = {
  version: 66,
  name: "a lead lists its project's repositories",
  statements: [
    toolAllowlistWidened("selector_runtime_settings"),
    toolAllowlistWidened("selector_runtime_settings_history"),
  ],
};
