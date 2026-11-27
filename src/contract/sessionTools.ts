/**
 * The one chuggy MCP server a session is given: its tools, the capability that
 * admits each, the bounds one call runs under, and the public API routes the
 * tools reach. The image registers the tools and the control plane names them
 * in allowlists, so the names belong to neither side and both read them here.
 * The request shapes a tool publishes are exported here too, while its input
 * schemas are not: those are the zod raw shapes the agent runtime's own
 * `tool()` takes, and they live in the image beside the handlers.
 *
 * THE CHANNELS ARE TOLD APART BY WHAT THEY WRITE AND WHOSE BEARER THEY PRESENT.
 * A project tool is a command a console user has: it goes over HTTP to the API
 * presenting the pod's session bearer, the API resolves that bearer to the
 * session's principal and authorizes it through the project membership
 * exactly as it authorizes a human's, and the operation row records which
 * session issued it. The API also confines that bearer to its own session's
 * tenant and project, answering another project's routes 404 and a tenant's
 * or the site's 403, and to the routes its session's capabilities admit,
 * answering one they do not 404. A person's own agent's tool presents no
 * session bearer: it reaches the API as that person, authorized as the
 * console's own call is, and an agent-account tool's route is that person's
 * own, at no tenant and no project, which every session bearer is refused. An
 * offer tool writes nothing and reaches no route: its call stands in the
 * thread's transcript like any other, and what it offers is done by the
 * member, as the member, or not at all.
 *
 * A ROSTER IS A CONTROL AS FAR AS THE API HOLDS IT, WHICH IS BY ROUTE AND
 * METHOD. The agent runtime enforces a roster inside the pod, and the pod is
 * the thing being controlled; the API admits a session bearer to a read of
 * its own scope under that scope's read capability, and otherwise only to the
 * routes some tool of its session row's capabilities calls, so a call to a
 * route none of them calls is refused. A route two capabilities' tools share
 * admits either one's whole body: `release_draft` posts an operation, so a
 * session holding `DraftAuthor` without `DraftOriginate` or `TicketDispatch`
 * may still post any operation, `ManualDispatch`,
 * `RevokeTicket` and `UpdateTicket` among them, and a draft no parent bears,
 * though no tool its roster holds does. The runtime's own tools reach no
 * route, and what a roster grants them is the pod's alone. Beside it stands
 * the membership, enforced by the database when it authorizes a project
 * access. A control described as stronger than it is, is worse than none.
 *
 * DERIVED WORK IS A FACT ABOUT THE MAP. `DraftAuthor` carries no bare create: a
 * dependent is filed against a parent that already exists, and a roster holding
 * only it cannot originate work. `create_draft` is admitted by `DraftOriginate`
 * alone, so whether a session may originate work is decided by the
 * capabilities it is opened with rather than by a sentence in a description.
 * A released ticket is re-authored only by `update_ticket`, which
 * `DraftOriginate` alone admits and which the machine refuses once the ticket
 * is past Pending.
 */

import { actionReportLinkCharsMax } from "./actionReport.ts";
import {
  configurationCanonicalCharsMax,
  dispatchCandidateCharsMax,
  jsonStringChars,
  jsonTextBytes,
  landingQueueHolderSinceDigits,
  landingQueueTicketsAnsweredMax,
  nativeHttpBodyBytesMax,
  nativeHttpPageItemsMax,
  nativeHttpRoutes,
  projectArtifactUploadBytesMax,
  proposalForgeFailureCharsMax,
  proposalForgeMessageCharsMax,
  proposalMergeStateCharsMax,
  proposalQueueWordCharsMax,
  runTranscriptBatchBytesMax,
  runTranscriptPageBatchesMax,
  textUtf8Bytes,
  ticketLandingConflictBytesMax,
  ticketLandingRefCharsMax,
  ticketLandingsAnsweredMax,
  ticketLandingStackDepthMax,
  ticketLandingStacksAnsweredMax,
  workerPlaneUploadBytesMax,
} from "./http.ts";
import { briefBranchCharsMax, briefRepositoryCharsMax } from "./brief.ts";
import { epicContentBytesMax, epicTicketsMax } from "./epics.ts";
import { epicStatusRoster } from "./responses.ts";
import { phaseRoster, type ToolCapability } from "./rosters.ts";

/** The public API's own values a tool builds its request with or bounds an argument by. */
export {
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpPageItemsMax,
  sessionStorePageBatchesMax,
  threadTurnsAnsweredMax,
} from "./http.ts";
export { briefLineCharsMax } from "./brief.ts";

/** The request shapes a drafting tool publishes as its arguments' schemas, and the bounds they hold an argument to. */
export {
  authoringSchema,
  evaluatorDefinitionSchema,
  programStageSchema,
} from "./authoring.ts";
export {
  briefBranchCharsMax,
  briefBranchSchema,
  briefCheckSchema,
  briefChecksMax,
  briefImagesMax,
  briefIntentCharsMax,
  briefLinkSchema,
  briefLinksMax,
  briefRepositoryCharsMax,
  briefRepositorySchema,
  briefSchema,
  briefTitleCharsMax,
} from "./brief.ts";
export { configurationSelectionSchema } from "./configurationSelection.ts";

/** What `navigate` names as its argument: a page in the vocabulary the console names its own pages in. */
export { consolePageSchema, type ConsolePage } from "./consolePage.ts";

/** What `offer_release` and `offer_revoke` name as their arguments, which the console reads off the transcript to draw each offer. */
export {
  threadOfferReleaseSchema,
  threadOfferRevokeSchema,
  type ThreadOfferRelease,
  type ThreadOfferRevoke,
} from "./threadOffers.ts";

/** What `fetch_image` checks its route's answer by: the media types a project's image is admitted under, and the encoding its bytes are answered in. */
export { imageMediaTypes, projectArtifactEncoding } from "./http.ts";

/** What `read_run_transcript`'s route answers one page of: at most this many batches, each at most this many bytes. */
export {
  runTranscriptBatchBytesMax,
  runTranscriptPageBatchesMax,
} from "./http.ts";

/** What `read_ticket_landings`'s route answers: at most this many landings, the newest, and the stacks of at most this many work cycles, the newest. */
export {
  ticketLandingsAnsweredMax,
  ticketLandingStacksAnsweredMax,
} from "./http.ts";

/** What `read_landing_queues`'s route answers: at most this many tickets, holders and waiters together, the earliest-ranked. */
export { landingQueueTicketsAnsweredMax } from "./http.ts";

/** What the epic tools hold an argument to: the title and summary a revision carries, the most one revision weighs and holds, and the most one page answers. */
export {
  epicContentBytesMax,
  epicPageLimitMax,
  epicSummaryCharsMax,
  epicTicketsMax,
  epicTitleCharsMax,
} from "./epics.ts";

/** What the settings and placement tools publish as their arguments' shapes, and the bound a settings text is held to. */
export { selectorProjectOverridesSchema } from "./requests.ts";
export { selectorSettingsTextCharsMax } from "./http.ts";
export { leadOfferings, placementRoutes } from "./rosters.ts";

/** What `update_usage_settings`, `retry_paused_agent` and `retire_credential` publish as their arguments' shapes: an agent's settings, written whole, and the agents an account names. */
export { agentAccountSettingsSchema } from "./requests.ts";
export { accountAgents } from "./rosters.ts";

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
 * target's, head's and base's reference names and the base its re-check was
 * read against, its merge state and the reason
 * and login of a removal from a merge queue, and the message and failure
 * the forge answered its newest merge with, each escaping every character;
 * its link, visible ASCII that JSON escapes to at most two bytes a character;
 * its conflict's paths and the checks its attempt and its hold name, weighed
 * together within the paths' bound, and the commas between them, fewer than
 * the lightest strings that bound holds; and the rest of it.
 */
export const chuggyToolTicketLandingBytesMax =
  4 * jsonStringChars(ticketLandingRefCharsMax) +
  2 * (actionReportLinkCharsMax + 1) +
  jsonStringChars(proposalMergeStateCharsMax) +
  2 * jsonStringChars(proposalQueueWordCharsMax) +
  jsonStringChars(proposalForgeMessageCharsMax) +
  jsonStringChars(proposalForgeFailureCharsMax) +
  ticketLandingConflictBytesMax +
  Math.floor(ticketLandingConflictBytesMax / jsonTextBytes("x")) +
  chuggyToolTicketLandingFieldsBytesMax;

/**
 * What one work cycle's stack `read_ticket_landings`'s route answers weighs
 * beside its reference: the deepest stack there may be, its cycle and the
 * tickets beneath it at the largest number a ticket's may be, its mark of a
 * re-stack, and its comma. A cycle decided unstacked carries none of the stack's
 * and weighs less.
 */
const chuggyToolTicketLandingStackFieldsBytesMax = textUtf8Bytes(
  `${JSON.stringify({
    cycle: Number.MAX_SAFE_INTEGER,
    restacked: true,
    prepared: "Stacked",
    beneath: Array.from({ length: ticketLandingStackDepthMax }, () => ({
      ticket: Number.MAX_SAFE_INTEGER,
      commit: "f".repeat(64),
    })),
    reference: "",
    tip: "f".repeat(64),
  })},`,
);

/**
 * What the stacks `read_ticket_landings`'s route answers may weigh: as many
 * work cycles as one read answers stacks of, each the deepest with its
 * reference escaping every character, and the names and brackets around them.
 */
export const chuggyToolTicketLandingStacksBytesMax =
  ticketLandingStacksAnsweredMax *
    (jsonStringChars(ticketLandingRefCharsMax) +
      chuggyToolTicketLandingStackFieldsBytesMax) +
  textUtf8Bytes(
    `,${JSON.stringify({ stacks: { cycles: [], truncated: false } })}`,
  );

/**
 * What `read_ticket_landings`'s route may answer: as many landings as one read
 * answers, each at its heaviest, the stacks it answers at their heaviest, and
 * an ordinary answer's bound for the fields around them.
 */
export const chuggyToolTicketLandingsResponseBytesMax =
  ticketLandingsAnsweredMax * chuggyToolTicketLandingBytesMax +
  chuggyToolTicketLandingStacksBytesMax +
  nativeHttpBodyBytesMax;

/**
 * What one queue `read_landing_queues`'s route answers weighs beside its
 * repository, its target and its waiters: the names and brackets around them,
 * its holder at the largest number a ticket's may be, the instant it holds
 * from at the one length its schema takes, and its longest phase.
 */
const chuggyToolLandingQueueFieldsBytesMax = textUtf8Bytes(
  `${JSON.stringify({
    repository: "",
    target: "",
    holder: Number.MAX_SAFE_INTEGER,
    holderSince: `0000-00-00T00:00:00.${"0".repeat(landingQueueHolderSinceDigits)}Z`,
    holderPhase: phaseRoster.reduce((longest, phase) =>
      phase.length > longest.length ? phase : longest,
    ),
    waiting: [],
  })},`,
);

/** What one waiter weighs in a queue's `waiting`: the largest number a ticket's may be, and its comma. */
const chuggyToolLandingQueueWaiterBytesMax = textUtf8Bytes(
  `${String(Number.MAX_SAFE_INTEGER)},`,
);

/**
 * What `read_landing_queues`'s route may answer: as many queues as one read
 * answers tickets, each with its repository and target escaping every
 * character and its fields at their heaviest, as many waiters as it answers
 * tickets, and an ordinary answer's bound for the fields around them.
 */
export const chuggyToolLandingQueuesResponseBytesMax =
  landingQueueTicketsAnsweredMax *
    (jsonStringChars(briefRepositoryCharsMax) +
      jsonStringChars(briefBranchCharsMax) +
      chuggyToolLandingQueueFieldsBytesMax +
      chuggyToolLandingQueueWaiterBytesMax) +
  nativeHttpBodyBytesMax;

/**
 * What one UTF-16 code unit of an embedded canonical may weigh in UTF-8,
 * escaping included: a code point's heaviest encoding, which no single code
 * unit and no escaped character reaches.
 */
const chuggyToolCharBytesMax = 4;

/**
 * What `dispatch_ticket`'s read of the dispatch view may answer: a page of one
 * candidate, its canonical configuration at its longest with every character
 * at its heaviest, and an ordinary answer's bound for the page around it.
 */
export const chuggyToolDispatchViewResponseBytesMax =
  dispatchCandidateCharsMax +
  jsonStringChars(0) +
  configurationCanonicalCharsMax * chuggyToolCharBytesMax +
  nativeHttpBodyBytesMax;

/**
 * What the epic view carries beside its content, at its heaviest: its number
 * and revision, each phase's count and the drafts, done and total at the most
 * members an epic holds, its longest status, and a full page of the tickets it
 * waits on, each number the largest a ticket's may be.
 */
const chuggyToolEpicViewFieldsBytesMax = textUtf8Bytes(
  JSON.stringify({
    number: Number.MAX_SAFE_INTEGER,
    revision: Number.MAX_SAFE_INTEGER,
    progress: {
      byPhase: Object.fromEntries(
        phaseRoster.map((phase) => [phase, epicTicketsMax]),
      ),
      drafts: epicTicketsMax,
      done: epicTicketsMax,
      total: epicTicketsMax,
    },
    status: epicStatusRoster.reduce((longest, status) =>
      status.length > longest.length ? status : longest,
    ),
    waitingOnOutside: Array.from(
      { length: nativeHttpPageItemsMax },
      () => Number.MAX_SAFE_INTEGER,
    ),
  }),
);

/**
 * What the epic view's route may answer, which `add_epic_tickets` and
 * `remove_epic_tickets` read whole before writing it back: its content at the
 * most the content's canonical JSON may weigh, escaping included, since the
 * view writes those fields as the canonical does; the fields beside it at their
 * heaviest; and an ordinary answer's bound for the answer around them.
 */
export const chuggyToolEpicViewResponseBytesMax =
  epicContentBytesMax +
  chuggyToolEpicViewFieldsBytesMax +
  nativeHttpBodyBytesMax;

/**
 * The public index that lists each page of chuggy's docs as its Markdown, which
 * `read_docs` called with no argument answers verbatim, sending no bearer
 * because the docs are public. Called with `page`, one page's URL as the index
 * lists it, it answers that page's Markdown verbatim, and it refuses a URL
 * outside the index's own directory.
 */
export const chuggyDocsIndex =
  "https://raw.githubusercontent.com/kasofsk/chuggy-docs/main/llms.txt";

/**
 * What one `read_docs` answer may weigh. A page is written to be read whole,
 * so the bound holds the heaviest page the docs have published several times
 * over and is still an answer an agent takes in one read rather than pages.
 */
export const chuggyToolDocsResponseBytesMax = 65_536;

/** A wall-clock bound per tool call, because the runtime's own default is effectively unbounded. */
export const chuggyToolTimeoutMs = 30_000;

/** How many pages one tool call may walk, so a tool answers a page and names its cursor. */
export const chuggyToolPagesMax = 1;

/**
 * What a member's own session reads of them and of nothing else: who they are
 * in their tenant, the projects they may list, their own threads wherever each
 * is kept, and their own machines. `read_docs` is held beside these, a tool
 * that reaches no route and so names neither scope.
 */
const chuggyToolMemberReads = [
  "read_my_abilities",
  "list_projects",
  "list_my_threads",
  "read_my_thread",
  "list_my_runners",
  "read_chat_host",
] as const;

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
    "read_ticket_landings",
    "read_landing_queues",
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
    "read_docs",
    "read_abilities",
    "list_epics",
    "read_epic",
    "read_epic_history",
    "read_epic_graph",
  ],
  DraftAuthor: [
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
  ],
  /**
   * What a thread does on its member's own word: it files the draft its owner asked for, against no parent, because the
   * member asking is where the work came from; it revokes the ticket its owner
   * said to end; it takes the ticket its owner said to take onto their own
   * runner and account, and returns the one they said to give back to its
   * creator; and it releases the revision of a Pending ticket's draft its
   * owner said to apply. None is in `DraftAuthor`, for the reason `DraftAuthor`
   * exists, and `revoke_ticket`, `take_ticket`, `return_ticket`,
   * `update_ticket` and the epic writes, which the API authorizes as the
   * member's `Mutate`, are here rather than there for the same reason.
   */
  DraftOriginate: [
    "create_draft",
    "revoke_ticket",
    "take_ticket",
    "return_ticket",
    "update_ticket",
    "create_epic",
    "revise_epic",
    "add_epic_tickets",
    "remove_epic_tickets",
  ],
  /**
   * Dispatching one released ticket on the member's own word, as the member's
   * `ManualDispatch`: the API authorizes it as that member's dispatch, so a
   * session holding this may dispatch exactly what its owner may.
   */
  TicketDispatch: ["dispatch_ticket"],
  MemberRead: [...chuggyToolMemberReads, "read_docs"],
  /**
   * What a thread offers its member rather than doing: `navigate` names a console page, `offer_release` one draft at the
   * exact authoring version to release, and `offer_revoke` one ticket at its
   * version. None writes or reaches a route, so the direct tools in
   * `DraftOriginate` and `TicketDispatch` stay what a thread does on its
   * member's word.
   */
  ThreadOffer: ["navigate", "offer_release", "offer_revoke"],
  /**
   * What a person's own agent does to a project's thread settings and to
   * where its threads run, which the API authorizes as it does the console's
   * own read or write of them. Only that person's agent holds it and no
   * session can, because a thread must not rewrite the settings it runs under
   * or make an administrator's write on the strength of a chat message.
   */
  ProjectSettings: [
    "read_lead_settings",
    "update_lead_settings",
    "read_placement",
    "update_placement",
  ],
  /**
   * What a person's own agent reads and does to their agent accounts, which
   * only that person's agent holds and no session can, because a session must
   * not change the thresholds it runs under or retire the credential whose
   * reading pauses it. The API authorizes these tools as it does the console's
   * own reads and writes of the account, and each acts on the person's own
   * account, whichever project the server is bound to.
   */
  AgentAccounts: [
    "read_usage",
    "update_usage_settings",
    "retry_paused_agent",
    "retire_credential",
  ],
  /**
   * What a person's own agent does to the pull request a ticket opened, which
   * the API authorizes as that person's `MergeProposals`. Only that person's
   * agent holds it and no session can, because a session must not merge on the
   * strength of a chat message the work it merges may have written.
   */
  ProposalMerge: ["merge_pull_request"],
} as const satisfies Readonly<Record<ToolCapability, readonly string[]>>;

/**
 * Every tool the chuggy server offers, in the order a roster is read in: what a
 * session may see of the project, what it may author, what a member's own
 * session reads of them, what a thread may offer its member,
 * and what a person's own agent may do to a project's settings, to their own
 * agent accounts and to a ticket's pull request, each named once.
 */
export const allChuggyTools = [
  ...chuggyToolRoster.ProjectRead,
  ...chuggyToolRoster.DraftAuthor,
  ...chuggyToolRoster.DraftOriginate,
  ...chuggyToolRoster.TicketDispatch,
  ...chuggyToolMemberReads,
  ...chuggyToolRoster.ThreadOffer,
  ...chuggyToolRoster.ProjectSettings,
  ...chuggyToolRoster.AgentAccounts,
  ...chuggyToolRoster.ProposalMerge,
] as const;
export type ChuggyTool = (typeof allChuggyTools)[number];

/** The same roster as the map a capability is looked up in. */
export const chuggyToolCapabilities: Readonly<
  Record<ToolCapability, readonly ChuggyTool[]>
> = chuggyToolRoster;

/**
 * The qualified names a runtime reports and an allowlist must name, in roster
 * order. The roster is filtered rather than the capabilities walked, so a tool
 * two capabilities admitted would still be named once.
 */
export function chuggyToolNames(
  capabilities: readonly ToolCapability[],
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
  Record<ToolCapability, readonly string[]>
> = {
  RepositoryRead: ["Glob", "Grep", "Read"],
  RepositoryWrite: ["Edit", "NotebookEdit", "Write"],
  RunCommands: ["Bash"],
  ProjectRead: [],
  DraftAuthor: [],
  DraftOriginate: [],
  TicketDispatch: [],
  MemberRead: [],
  ThreadOffer: [],
  ProjectSettings: [],
  AgentAccounts: [],
  ProposalMerge: [],
};

/**
 * The relation a filed dependent may carry, and the one it may not. A follow-up
 * points from the new draft to the existing ticket and changes nothing already
 * released; a prerequisite points the other way, which would update the
 * existing ticket, so it is admitted by the schema only so that its refusal can
 * name the reason.
 */
export const allDependentRelations = ["FollowUp", "Prerequisite"] as const;
export type DependentRelation = (typeof allDependentRelations)[number];
export const dependentRelationsAdmitted = ["FollowUp"] as const;

/** The public API routes the chuggy tools call; each is the route table's own entry. */
export const chuggyToolRoutes = {
  projects: nativeHttpRoutes.projects,
  project: nativeHttpRoutes.project,
  ticket: nativeHttpRoutes.ticket,
  draft: nativeHttpRoutes.draft,
  drafts: nativeHttpRoutes.drafts,
  dispatchView: nativeHttpRoutes.dispatchView,
  configurations: nativeHttpRoutes.configurations,
  configuration: nativeHttpRoutes.configuration,
  /**
   * What `read_ticket_landings` answers of a Stacked ticket beside its
   * landings: under `stacks`, each of its newest work cycles the finalizer
   * prepared an evaluation for, oldest first, with a cycle prepared neither
   * way and a ticket that is not Stacked answering nothing there. A cycle
   * evaluated over a stack answers the tickets beneath it, bottom first, each
   * with the commit it must land, and the reference the stack was built on
   * with that reference's tip; a cycle decided unstacked answers why,
   * `Unchosen`, `Conflicted` or `Unpublished`.
   */
  ticketLandings: nativeHttpRoutes.ticketLandings,
  /**
   * What `take_ticket` and `return_ticket` post, taking nothing: the caller
   * becomes the ticket's owner, or its taker gives it back to its creator.
   */
  ticketTake: nativeHttpRoutes.ticketTake,
  ticketReturn: nativeHttpRoutes.ticketReturn,
  /**
   * What `merge_pull_request` posts, taking nothing: the pull request the
   * ticket's newest successful landing opened is merged at the head that
   * landing evaluated, or the refusal is named.
   */
  ticketProposalMerge: nativeHttpRoutes.ticketProposalMerge,
  /**
   * What `read_landing_queues` answers, taking nothing: the project's landing
   * queues, one for each reference a Serialized or Stacked ticket lands on, by
   * its repository and its target, a queue naming none being the repository's
   * default branch's. A queue's holder is the one ticket that may land on that
   * reference now, and its waiters are the tickets ranked behind it, none of
   * which lands there before the holder stops holding it; a ticket alone in a
   * queue is its holder and waits on nobody; `holderPhase` is the holder's
   * phase, and `holderSince` when it became the holder, the later of when it
   * took its rank and when the ticket holding the queue before it stopped,
   * which a re-check, a re-stack, a re-evaluation and an invalidation leave
   * as it was.
   */
  landingQueues: nativeHttpRoutes.landingQueues,
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
  /**
   * What `read_abilities` answers, taking nothing: the principal the session
   * acts as, encoded as a ticket's `creator` is, and which permits it holds on
   * this project, read live. An agent asks it once before acting rather than
   * learning a permit from a refusal.
   */
  abilities: nativeHttpRoutes.abilities,
  epics: nativeHttpRoutes.epics,
  epic: nativeHttpRoutes.epic,
  epicHistory: nativeHttpRoutes.epicHistory,
  epicGraph: nativeHttpRoutes.epicGraph,
  selectorSettings: nativeHttpRoutes.selectorSettings,
  sessionPlacement: nativeHttpRoutes.sessionPlacement,
  /**
   * What a member's own session reads, each at its tenant and none at a
   * project: `read_my_abilities` the tenant's questions, `list_projects` the
   * projects its chat may see, `list_my_threads` its owner's threads wherever
   * each is kept, a project's by its metadata alone, `read_my_thread` one of
   * its owner's own, and `list_my_runners` and `read_chat_host` its owner's
   * machines.
   */
  chatAbilities: nativeHttpRoutes.chatAbilities,
  chatProjects: nativeHttpRoutes.chatProjects,
  chatThreads: nativeHttpRoutes.chatThreads,
  chatThread: nativeHttpRoutes.chatThread,
  personalRunner: nativeHttpRoutes.personalRunner,
  chatHost: nativeHttpRoutes.chatHost,
  /**
   * What a person's own agent reads and writes of their own agent accounts,
   * each the caller's own, at no tenant and no project: `read_usage` every
   * agent's readings, pause and credentials, `update_usage_settings` an
   * agent's settings, `retry_paused_agent` a press, and `retire_credential`
   * one credential.
   */
  agentAccounts: nativeHttpRoutes.agentAccounts,
  agentAccountSettings: nativeHttpRoutes.agentAccountSettings,
  agentAccountPresses: nativeHttpRoutes.agentAccountPresses,
  agentAccountCredential: nativeHttpRoutes.agentAccountCredential,
} as const;
