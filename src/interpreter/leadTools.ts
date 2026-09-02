/**
 * The roster of tools one chuggy MCP server offers a session, the capability
 * that admits each, the bound each answer is cut to, and the objectives a lead
 * is opened with. The tool input schemas are not here: they are the zod raw
 * shapes the agent runtime's own `tool()` takes, and they live in the image
 * beside the handlers, so what this module declares is what the control plane
 * and the image must agree on.
 *
 * TWO CHANNELS, TOLD APART BY WHAT THEY WRITE. A project tool is a command a
 * console user has: it goes over HTTP to the API presenting the pod's session
 * bearer, the API resolves that bearer to the session's principal and
 * authorizes it through the project membership exactly as it authorizes a
 * human's, and the operation row records which session issued it. A decision
 * tool writes nothing at all: it accumulates in the pod and becomes the turn's
 * answer, which the selector runtime still reads and acts on under its own
 * fence, so the runtime remains the single writer of a dispatch and of the
 * refusal ledger.
 *
 * A ROSTER IS NOT A CONTROL, AND SAYING SO IS THE POINT. A roster is enforced
 * by the agent runtime inside the pod, and the pod is the thing being
 * controlled. The two controls that are not the pod's are the membership,
 * enforced by the database when it authorizes a project access, and the
 * decision controls the selector applies to a finished turn — and the second is
 * post-hoc: the tool has already run and its command has already landed, and
 * what the selector refuses is the decision that used it. A control described
 * as stronger than it is, is worse than none.
 *
 * THE ROSTER NAMES ONE READ THE TREE DOES NOT YET HAVE. `list_drafts` reaches
 * `GET .../drafts`, whose page shapes are declared in `./authoring.ts` and whose
 * `AuthoringStore.drafts` and `NativeWeb.drafts` will be declared beside the
 * migration that gives them a definer to read through, because the tree's
 * production store is a postgres adapter that could not implement the method
 * before then, and the test double beside it is not what the port is for.
 *
 * DERIVED WORK ONLY, AND THE MODEL IS WHY. There is no bare create in the
 * roster: a dependent is filed against a parent that already exists. Nor is
 * there any tool that re-authors a released ticket — merge, split, supersede,
 * re-point a dependency — because a released ticket's dependencies are
 * immutable in `model/domain.qnt`, which names re-authoring machinery as
 * deliberately absent.
 */

import {
  nativeHttpBodyBytesMax,
  selectorSettingsTextCharsMax,
} from "../contract/http.ts";
import type { SessionCapability } from "./agentSession.ts";
import type { SelectorResolvedSettings } from "./selector.ts";

/** The one MCP server every session is given, and the prefix its tool names carry. */
export const chuggyToolServer = "chuggy";
export const chuggyToolPrefix = "mcp__chuggy__";

/** What one tool answer may weigh, which is what the API answered and never more. */
export const chuggyToolResponseBytesMax = nativeHttpBodyBytesMax;

/** A wall-clock bound per tool call, because the runtime's own default is effectively unbounded. */
export const chuggyToolTimeoutMs = 30_000;

/** How many pages one tool call may walk, so a tool answers a page and names its cursor. */
export const chuggyToolPagesMax = 1;

/**
 * Which capability admits which tool, written once and read both ways round. A
 * tool in no list would be a tool nothing gates, and a capability the roster
 * does not mention would be one nothing maps, so the keys are every capability
 * and the roster below is these lists rather than a second copy of them.
 */
const chuggyToolRoster = {
  RepositoryRead: [],
  RepositoryWrite: [],
  RunCommands: [],
  ProjectRead: [
    "list_tickets",
    "read_ticket",
    "read_draft",
    "list_drafts",
    "list_configurations",
    "read_configuration",
    "read_decision_log",
    "read_refusals",
    "read_ticket_refusals",
    "read_projects",
    "read_lead",
    "read_lead_transcript",
    "list_executions",
    "read_execution",
    "read_run_transcript",
    "read_operation",
  ],
  DraftAuthor: [
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
  ],
  LeadDecision: [
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ],
} as const satisfies Readonly<Record<SessionCapability, readonly string[]>>;

/**
 * Every tool the chuggy server offers, in the order a roster is read in: what a
 * session may see of the project, what it may author, and what it may decide.
 */
export const allChuggyTools = [
  ...chuggyToolRoster.ProjectRead,
  ...chuggyToolRoster.DraftAuthor,
  ...chuggyToolRoster.LeadDecision,
] as const;
export type ChuggyTool = (typeof allChuggyTools)[number];

/** The same roster as the map a capability is looked up in. */
export const chuggyToolCapabilities: Readonly<
  Record<SessionCapability, readonly ChuggyTool[]>
> = chuggyToolRoster;

/**
 * The qualified names a runtime reports and an allowlist must name, in roster
 * order. The roster is filtered rather than the capabilities walked, so a tool
 * two capabilities admitted would still be named once.
 */
export function chuggyToolNames(
  capabilities: readonly SessionCapability[],
): readonly string[] {
  const admitted = new Set<ChuggyTool>(
    capabilities.flatMap((capability) => [
      ...chuggyToolCapabilities[capability],
    ]),
  );
  return allChuggyTools
    .filter((tool) => admitted.has(tool))
    .map((tool) => `${chuggyToolPrefix}${tool}`);
}

/**
 * The relation a filed dependent may carry, and the one it may not. A follow-up
 * points from the new draft to the existing ticket and changes nothing already
 * released; a prerequisite points the other way, which would re-author a
 * released ticket's dependencies, so it is admitted by the schema only so that
 * its refusal can name the reason.
 */
export const allDependentRelations = ["FollowUp", "Prerequisite"] as const;
export type DependentRelation = (typeof allDependentRelations)[number];
export const dependentRelationsAdmitted = ["FollowUp"] as const;

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
  )} and refuses ${relationsSaid(dependentRelationsRefused)}.
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
 * instructions, the North Star's heading, and the joins between them.
 */
const leadObjectivesFixedChars = leadObjectives("", "").length;

/**
 * The longest set of objectives one session row holds, derived from the parts
 * rather than named, because the two texts a project may set are each bounded
 * by `selectorSettingsTextCharsMax` and a ceiling below their sum would refuse
 * a `basePrompt` the settings API had already accepted — on every pass, long
 * after the write that caused it.
 */
export const sessionSystemPromptCharsMax =
  selectorSettingsTextCharsMax * 2 + leadObjectivesFixedChars;

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
  if (prompt.length > sessionSystemPromptCharsMax)
    throw new RangeError(
      `lead system prompt must be at most ${String(sessionSystemPromptCharsMax)} characters`,
    );
  return prompt;
}
