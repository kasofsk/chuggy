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
 * THE ROSTER NAMES READS THE TREE DOES NOT YET SERVE, because a roster is what
 * a session may ask for and a route is what answers. The image's
 * `chuggyToolsNotYetServed` is where each says so to a caller, and an entry
 * there is deleted by the change that registers its route.
 *
 * A ROSTER IS ALSO AN ALLOWLIST, AND THE TWO ARE ONE LIST. What the pod may
 * reach for is enforced inside the pod; what a finished decision may have used
 * is `toolAllowlist`, which the installation is seeded with and which admitted
 * everything until a lead held tools. The seeded list is therefore derived from
 * the roster a lead is opened with rather than written beside it, and the
 * runtime built-ins it also carries are held to the image's own.
 *
 * ORIGINATION IS SEPARATE FROM AUTHORING. `DraftAuthor` updates and operates
 * existing adopted tickets but carries no bare create. `create_ticket` is
 * admitted by `DraftOriginate` alone — a capability a thread is opened with
 * (`./thread.ts`'s `threadCapabilitiesDefault`) and a lead is not — so the rule
 * is a fact about which capability admits which tool rather than a sentence in
 * a description. Which capabilities any one session is opened with is the
 * provisioning root's.
 */

import {
  nativeHttpBodyBytesMax,
  sessionSystemPromptCharsMax,
  textCodePointsCount,
} from "../contract/http.ts";
import type { SessionCapability } from "./agentSession.ts";
export interface LeadToolSettings {
  readonly basePrompt: string;
  readonly northStar?: string;
}

/** The one MCP server every session is given, and the prefix its tool names carry. */
export const chuggyToolServerName = "chuggy";
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
    "read_projects",
    "read_lead",
    "read_lead_transcript",
    "read_operation",
    "list_threads",
    "read_thread",
    "read_thread_transcript",
  ],
  DraftAuthor: [
    "update_ticket",
    "dispatch_ticket",
    "revoke_ticket",
    "resume_ticket",
  ],
  /**
   * A member's own authorship, which no lead roster carries: a thread files the
   * draft its owner asked for, against no parent, because the member asking is
   * where the work came from. It is one tool and it is not in `DraftAuthor`,
   * for the reason `DraftAuthor` exists.
   */
  DraftOriginate: ["create_ticket"],
} as const satisfies Readonly<Record<SessionCapability, readonly string[]>>;

/**
 * Every tool the chuggy server offers, in the order a roster is read in: what a
 * session may see of the project, what it may author, and what it may decide.
 */
export const allChuggyTools = [
  ...chuggyToolRoster.ProjectRead,
  ...chuggyToolRoster.DraftAuthor,
  ...chuggyToolRoster.DraftOriginate,
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

/** What a lead is told about its own tools, beside what the project tells it. */
const leadStandingInstructions = `# How you act on this project

- Two channels. A project tool is a command any member of this project has: it
  goes over the API under this project's membership and is recorded as yours.
  A decision tool writes nothing — it composes this turn's answer, and the
  selector runtime is what dispatches, refuses and lifts, under its own fence.
- You cannot originate a ticket. Use \`list_tickets\` and \`read_ticket\` to
  inspect the adopted ticket graph. Use \`update_ticket\` only to revise an
  existing ticket, with its current revision and an exact catalog commit.
- \`dispatch_ticket\`, \`revoke_ticket\`, \`resume_ticket\`, and \`update_ticket\`
  answer an accepted operation rather than an outcome. Use \`read_operation\`
  to learn whether the ticket machine decided or refused it.`;

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
export function leadSystemPrompt(settings: LeadToolSettings): string {
  const prompt = leadObjectives(settings.basePrompt, settings.northStar);
  if (textCodePointsCount(prompt) > sessionSystemPromptCharsMax)
    throw new RangeError(
      `lead system prompt must be at most ${String(sessionSystemPromptCharsMax)} characters`,
    );
  return prompt;
}
