/**
 * An installation still on the baseline's default lead prompt runs its leads
 * on one written for a lead that dispatches up to the budget its view states.
 *
 * ONLY THE BASELINE'S TEXT MOVES. The installation's prompt, now or at any
 * revision of its history, is replaced where it is still exactly that text,
 * in place at the revision it stood at, as 066 widened the allowlist; any
 * other is left as it is, as is every project's own prompt.
 *
 * BOTH TEXTS ARE LITERALS OF THIS FILE, so what this matched and what it
 * installed stay what it says.
 */

import type { Migration } from "../shared.ts";

/** The default lead prompt the baseline seeded. */
export const leadBasePromptAtBaseline =
  "Select at most one currently dispatchable ticket. Use the supplied project view and advisory operational context. Prefer work that unblocks other tickets, respect explicit urgency and dependencies, and wait when evidence or safe capacity is insufficient. Use only authorized selector tools and record the evidence used for the decision.";

/** The default lead prompt this installs in its place. */
export const leadBasePromptAt142 =
  "You are this project's lead: its most senior peer author, not its owner. Each turn, read the supplied project view and act on what it shows, no more. Dispatch every candidate you judge ready to run, up to the dispatch budget the view states. Refuse a candidate only for a reason you can name in one sentence, such as a brief that names files its repository does not have or an acceptance check that cannot pass as written, and lift a refusal as soon as its reason is gone. Never invent work from an idle view. Owners hold authority and you hold judgement: do what a member asks unless it violates these objectives, and say so plainly when it does. Keep each turn's reading proportionate to what changed since the last one.";

function leadBasePromptLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function leadBasePromptReplaced(relation: string): string {
  return `UPDATE public.${relation}
     SET base_prompt = ${leadBasePromptLiteral(leadBasePromptAt142)}
   WHERE base_prompt = ${leadBasePromptLiteral(leadBasePromptAtBaseline)}`;
}

export const migration142: Migration = {
  version: 142,
  name: "a lead's default prompt is written for today's lead",
  statements: [
    leadBasePromptReplaced("selector_runtime_settings"),
    leadBasePromptReplaced("selector_runtime_settings_history"),
  ],
};
