/**
 * The one chuggy MCP server a session is given: its tools, the capability that
 * admits each, the bounds one call runs under, and the public API routes the
 * tools reach. The image registers the tools and the control plane names them
 * in allowlists, so the names belong to neither side and both read them here.
 * The tool input schemas are not here: they are the zod raw shapes the agent
 * runtime's own `tool()` takes, and they live in the image beside the handlers.
 *
 * TWO CHANNELS, TOLD APART BY WHAT THEY WRITE. A project tool is a command a
 * console user has: it goes over HTTP to the API presenting the pod's session
 * bearer, the API resolves that bearer to the session's principal and
 * authorizes it through the project membership exactly as it authorizes a
 * human's, and the operation row records which session issued it. The API
 * also confines that bearer to its own session's tenant and project, answering
 * another project's routes 404 and a tenant's or the site's 403. A decision
 * tool writes nothing at all: it accumulates in the pod and becomes the turn's
 * answer, which the selector runtime still reads and acts on under its own
 * fence, so the runtime remains the single writer of a dispatch and of the
 * refusal ledger.
 *
 * A ROSTER IS NOT A CONTROL, AND SAYING SO IS THE POINT. A roster is enforced
 * by the agent runtime inside the pod, and the pod is the thing being
 * controlled. Two controls that are not the pod's are the membership,
 * enforced by the database when it authorizes a project access, and the
 * decision controls the selector applies to a finished turn — and the second is
 * post-hoc: the tool has already run and its command has already landed, and
 * what the selector refuses is the decision that used it. A third is the API's
 * confinement of a session bearer to its own session's tenant and project. A
 * control described as stronger than it is, is worse than none.
 *
 * DERIVED WORK IS A FACT ABOUT THE MAP. `DraftAuthor` carries no bare create: a
 * dependent is filed against a parent that already exists, and a roster holding
 * only it cannot originate work. `create_draft` is admitted by `DraftOriginate`
 * alone, so whether a session may originate work is decided by the
 * capabilities it is opened with rather than by a sentence in a description. No
 * capability admits a tool that re-authors a released ticket — merge, split,
 * supersede, re-point a dependency — because a released ticket's dependencies
 * are immutable in `model/domain.qnt`, which names re-authoring machinery as
 * deliberately absent.
 */

import { actionReportLinkCharsMax } from "./actionReport.ts";
import {
  jsonStringChars,
  jsonTextBytes,
  nativeHttpBodyBytesMax,
  nativeHttpRoutes,
  projectArtifactUploadBytesMax,
  proposalMergeStateCharsMax,
  runTranscriptBatchBytesMax,
  runTranscriptPageBatchesMax,
  ticketLandingConflictBytesMax,
  ticketLandingRefCharsMax,
  ticketLandingsAnsweredMax,
  workerPlaneUploadBytesMax,
} from "./http.ts";
import type { SessionCapability } from "./rosters.ts";

/** The public API's own values a tool builds its request with or bounds an argument by. */
export {
  agenticRefusalsAnsweredMax,
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpPageItemsMax,
  selectorHistoryLimitMax,
  sessionStorePageBatchesMax,
  threadTurnsAnsweredMax,
} from "./http.ts";
export { briefLineCharsMax } from "./brief.ts";

/** What `fetch_image` checks its route's answer by: the media types a project's image is admitted under, and the encoding its bytes are answered in. */
export { imageMediaTypes, projectArtifactEncoding } from "./http.ts";

/** What `read_run_transcript`'s route answers one page of: at most this many batches, each at most this many bytes. */
export {
  runTranscriptBatchBytesMax,
  runTranscriptPageBatchesMax,
} from "./http.ts";

/** What `read_ticket_landings`'s route answers: at most this many landings, the newest. */
export { ticketLandingsAnsweredMax } from "./http.ts";

/** The one MCP server every session is given, and the prefix its tool names carry. */
export const chuggyToolServerName = "chuggy";
export const chuggyToolPrefix = "mcp__chuggy__";

/** What one tool answer may weigh, which is what the API answered and never more. */
export const chuggyToolResponseBytesMax = nativeHttpBodyBytesMax;

/**
 * What `fetch_image`'s route may answer: the largest image an upload admits, as
 * the base64 its JSON body carries, and an ordinary answer's bound for the
 * fields around it.
 */
export const chuggyToolImageResponseBytesMax =
  Math.ceil(projectArtifactUploadBytesMax / 3) * 4 + nativeHttpBodyBytesMax;

/**
 * What `read_run_error`'s route may answer: the largest error text a worker
 * uploads, as a JSON string that escapes every byte of it, and an ordinary
 * answer's bound for the fields around it. JSON escapes only one-byte
 * characters, each to no more than `jsonStringChars` allows a character, so
 * that of a byte count bounds the string in bytes.
 */
export const chuggyToolRunErrorResponseBytesMax =
  jsonStringChars(workerPlaneUploadBytesMax) + nativeHttpBodyBytesMax;

/**
 * What `read_run_transcript`'s route may answer: a page of the largest
 * batches, each as a JSON string that escapes every byte of it, and an
 * ordinary answer's bound for the fields around them.
 */
export const chuggyToolRunTranscriptResponseBytesMax =
  runTranscriptPageBatchesMax * jsonStringChars(runTranscriptBatchBytesMax) +
  nativeHttpBodyBytesMax;

/**
 * What one landing weighs beside its texts: its counts, codes, commits and
 * instants, and the names and brackets around them all. It is a ceiling rather
 * than a measurement, and the plane's suite is what holds the heaviest landing
 * under it.
 */
const chuggyToolTicketLandingFieldsBytesMax = 1_280;

/**
 * What one landing `read_ticket_landings`'s route answers may weigh: its
 * target's, head's and base's reference names and its merge state, each
 * escaping every character; its link, visible ASCII that JSON escapes to at
 * most two bytes a character; its conflict's paths, and the commas between
 * them, fewer than the lightest paths its bound holds; and the rest of it.
 */
export const chuggyToolTicketLandingBytesMax =
  3 * jsonStringChars(ticketLandingRefCharsMax) +
  2 * (actionReportLinkCharsMax + 1) +
  jsonStringChars(proposalMergeStateCharsMax) +
  ticketLandingConflictBytesMax +
  Math.floor(ticketLandingConflictBytesMax / jsonTextBytes("x")) +
  chuggyToolTicketLandingFieldsBytesMax;

/**
 * What `read_ticket_landings`'s route may answer: as many landings as one read
 * answers, each at its heaviest, and an ordinary answer's bound for the fields
 * around them.
 */
export const chuggyToolTicketLandingsResponseBytesMax =
  ticketLandingsAnsweredMax * chuggyToolTicketLandingBytesMax +
  nativeHttpBodyBytesMax;

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
    "read_ticket_landings",
    "read_lead",
    "read_lead_transcript",
    "list_executions",
    "read_execution",
    "read_run_transcript",
    "read_run_error",
    "read_operation",
    "list_threads",
    "read_thread",
    "read_thread_transcript",
    "list_repositories",
    "fetch_image",
  ],
  DraftAuthor: [
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
  ],
  /**
   * What a thread does on its member's own word, which no lead roster carries:
   * it files the draft its owner asked for, against no parent, because the
   * member asking is where the work came from; it revokes the ticket its owner
   * said to end; and it releases the revision of a Pending ticket's draft its
   * owner said to apply. None is in `DraftAuthor`, for the reason `DraftAuthor`
   * exists, and `revoke_ticket` and `update_ticket` are here because a thread
   * holds this capability and a lead does not.
   */
  DraftOriginate: ["create_draft", "revoke_ticket", "update_ticket"],
  /**
   * Dispatching one released ticket on the member's own word, as the member's
   * `ManualDispatch`: the API authorizes it as that member's dispatch, so a
   * session holding this may dispatch exactly what its owner may.
   */
  TicketDispatch: ["dispatch_ticket"],
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
  ...chuggyToolRoster.DraftOriginate,
  ...chuggyToolRoster.TicketDispatch,
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

/** The agent runtime's own tools each capability admits, which the image grants and an allowlist names. */
export const builtInToolCapabilities: Readonly<
  Record<SessionCapability, readonly string[]>
> = {
  RepositoryRead: ["Glob", "Grep", "Read"],
  RepositoryWrite: ["Edit", "NotebookEdit", "Write"],
  RunCommands: ["Bash"],
  ProjectRead: [],
  DraftAuthor: [],
  DraftOriginate: [],
  TicketDispatch: [],
  LeadDecision: [],
};

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

/** How many tickets one decision may refuse, and how many it may lift. */
export const leadRefusalsPerDecisionMax = 16;

/** The public API routes the project tools call; each is the route table's own entry. */
export const chuggyToolRoutes = {
  project: nativeHttpRoutes.project,
  ticket: nativeHttpRoutes.ticket,
  draft: nativeHttpRoutes.draft,
  drafts: nativeHttpRoutes.drafts,
  dispatchView: nativeHttpRoutes.dispatchView,
  configurations: nativeHttpRoutes.configurations,
  configuration: nativeHttpRoutes.configuration,
  selectorHistory: nativeHttpRoutes.selectorHistory,
  agenticRefusals: nativeHttpRoutes.agenticRefusals,
  ticketAgenticRefusals: nativeHttpRoutes.ticketAgenticRefusals,
  ticketLandings: nativeHttpRoutes.ticketLandings,
  lead: nativeHttpRoutes.lead,
  leadTranscript: nativeHttpRoutes.leadTranscript,
  executions: nativeHttpRoutes.executions,
  execution: nativeHttpRoutes.execution,
  runTranscript: nativeHttpRoutes.runTranscript,
  runError: nativeHttpRoutes.runError,
  operation: nativeHttpRoutes.operation,
  threads: nativeHttpRoutes.threads,
  thread: nativeHttpRoutes.thread,
  threadTranscript: nativeHttpRoutes.threadTranscript,
  projectRepositories: nativeHttpRoutes.projectRepositories,
  projectArtifact: nativeHttpRoutes.projectArtifact,
  draftInitialization: nativeHttpRoutes.draftInitialization,
  operations: nativeHttpRoutes.operations,
} as const;
