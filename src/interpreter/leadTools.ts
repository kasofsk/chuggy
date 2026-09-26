/**
 * What a lead is opened holding and what it is told: the capabilities it holds,
 * the allowlist its decisions are judged by, and its objectives. The tools and
 * the capability that admits each are the contract's
 * (`../contract/sessionTools.ts`); which of them a lead holds is decided here.
 *
 * A ROSTER IS ALSO AN ALLOWLIST, AND THE TWO ARE ONE LIST. What the pod may
 * reach for is enforced inside the pod; what a finished decision may have used
 * is `toolAllowlist`, which the installation is seeded with and which admitted
 * everything until a lead held tools. The seeded list is therefore derived from
 * the roster a lead is opened with rather than written beside it, and the
 * runtime built-ins it also carries are held to the image's own.
 *
 * DERIVED WORK ONLY IS THE LEAD'S RULE. `DraftOriginate` is the one capability
 * that admits a bare create, and it is one a thread is opened with
 * (`./thread.ts`'s `threadCapabilitiesDefault`) and a lead is not. Which
 * capabilities any one session is opened with is the provisioning root's, and
 * nothing here can state it.
 */

import {
  sessionSystemPromptCharsMax,
  textCodePointsCount,
} from "../contract/http.ts";
import {
  allDependentRelations,
  chuggyToolNames,
  dependentRelationsAdmitted,
  type DependentRelation,
} from "../contract/sessionTools.ts";
import type { SessionCapability } from "./agentSession.ts";
import type { SelectorResolvedSettings } from "./selector.ts";

/**
 * What a lead is opened holding: not `RunCommands`, because a lead judges a
 * ticket from the view it is given and the tree it can read, and the gates
 * that decide a ticket are the fabric's to run; and not `RepositoryWrite`,
 * because a lead that edited its checkout would be writing to a copy nothing
 * reads.
 */
export const leadSessionCapabilities = [
  "RepositoryRead",
  "ProjectRead",
  "DraftAuthor",
  "LeadDecision",
] as const satisfies readonly SessionCapability[];

/**
 * The agent runtime's own tools a lead's roster admits, written here because the
 * image declares them and `images/worker/` is not reachable from `src/`; the
 * copies are held together by `test/contract/imageTools.test.mjs`.
 */
export const leadBuiltInTools = ["Glob", "Grep", "Read"] as const;

/**
 * Every tool name a lead's decision may report, in roster order, which is what
 * the installation narrows `toolAllowlist` to: a wildcard admits everything, so
 * a lead holding tools would be judged by a control that checked nothing.
 */
export const leadToolAllowlist: readonly string[] = [
  ...leadBuiltInTools,
  ...chuggyToolNames(leadSessionCapabilities),
];

/** The relations the schema names so that their refusal can name the reason. */
export const dependentRelationsRefused: readonly DependentRelation[] =
  allDependentRelations.filter(
    (relation) =>
      !(dependentRelationsAdmitted as readonly DependentRelation[]).includes(
        relation,
      ),
  );

/** One list of relations as a sentence holds them. */
function relationsSaid(relations: readonly DependentRelation[]): string {
  return relations.map((relation) => `\`${relation}\``).join(" and ");
}

/**
 * What a lead is told about its own tools, beside what the project tells it.
 * Which relation `file_dependent` admits is read off the roster rather than
 * written again here, so the prompt cannot say the opposite of the schema.
 */
const leadStandingInstructions = `# How you act on this project

- Two channels. A project tool is a command any member of this project has: it
  goes over the API under this project's membership and is recorded as yours.
  A decision tool writes nothing — it composes this turn's answer, and the
  selector runtime is what dispatches, refuses and lifts, under its own fence.
- Derived work only. \`file_dependent\` files a draft against a parent ticket
  that already exists; there is no bare create. It admits ${relationsSaid(
    dependentRelationsAdmitted,
  )} and refuses ${relationsSaid(dependentRelationsRefused)}. Its brief carries
  a title of one short line naming the work, which is what tickets are listed
  by.
- A released ticket cannot be re-authored. A follow-up points from the new
  draft at the ticket it derives from and rewrites nothing; a prerequisite
  would point from an existing ticket at the new one, which rewrites
  dependencies that are immutable once released. A prerequisite of a draft is
  a revision of that draft's own dependencies.
- \`release_draft\` answers an accepted operation rather than an outcome. Read
  the operation to learn what happened.`;

/** The objectives themselves, before the bound they are checked against is known. */
function leadObjectives(
  basePrompt: string,
  northStar: string | undefined,
): string {
  return [
    basePrompt,
    ...(northStar === undefined ? [] : [`# North Star\n\n${northStar}`]),
    leadStandingInstructions,
  ].join("\n\n");
}

/**
 * What this module itself contributes to a lead's objectives: the standing
 * instructions, the North Star's heading, and the joins between them. The
 * ceiling it is held to is the contract's, because the observation bound is
 * derived from it and the contract may not read this file.
 */
export const leadObjectivesFixedChars = leadObjectives("", "").length;

/** The longest set of objectives one session row holds, surfaced where it is composed. */
export { sessionSystemPromptCharsMax };

/**
 * The lead's objectives as one recorded prefix: what this installation asks of
 * a lead, then what this project wants, then what its own tools mean. The bound
 * is checked here rather than by the row, so text no project could have set is
 * refused where the prompt is composed.
 */
export function leadSystemPrompt(
  settings: Pick<SelectorResolvedSettings, "basePrompt" | "northStar">,
): string {
  const prompt = leadObjectives(settings.basePrompt, settings.northStar);
  if (textCodePointsCount(prompt) > sessionSystemPromptCharsMax)
    throw new RangeError(
      `lead system prompt must be at most ${String(sessionSystemPromptCharsMax)} characters`,
    );
  return prompt;
}
