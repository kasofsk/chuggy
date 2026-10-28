/** Shared conversation and run-evidence endpoints for the server, browser, and contract document. */
import { ticketActionReachResponseSchema } from "./actionReach.ts";
import { fieldsOnly, integerField, textField } from "./fields.ts";
import { z } from "zod";
import {
  nativeHttpPageItemsMax,
  nativeHttpRoutes,
  sessionStorePageBatchesMax,
  threadTurnsAnsweredMax,
} from "./http.ts";
import {
  threadMessageSchema,
  threadOpenSchema,
  threadRenameRequestSchema,
  threadHideRequestSchema,
  leadInquirySchema,
  selectorProposalReviewSchema,
} from "./requests.ts";
import {
  operationalStatusResponseSchema,
  executionResponseSchema,
  hostedRunsResponseSchema,
  projectAbilitiesResponseSchema,
  leadReadResponseSchema,
  leadTranscriptResponseSchema,
  runTurnsResponseSchema,
  runTranscriptResponseSchema,
  runConfigurationResponseSchema,
  runErrorResponseSchema,
  threadsResponseSchema,
  threadResponseSchema,
  chatAbilitiesResponseSchema,
  chatProjectsResponseSchema,
  chatThreadsResponseSchema,
  threadTranscriptResponseSchema,
  threadEntryResponseSchema,
  threadMessageAcceptedSchema,
  threadTurnStopResponseSchema,
  threadRenameResponseSchema,
  threadHideResponseSchema,
  leadInquiriesResponseSchema,
  leadInquiryResponseSchema,
  leadInquiryAcceptedSchema,
  selectorProposalsResponseSchema,
  selectorProposalReviewResponseSchema,
  ticketLandingsResponseSchema,
  repositoryConfigurationHeadResponseSchema,
} from "./responses.ts";

function endpointInteger(name: string, fallback?: number) {
  const schema = z
    .unknown()
    .transform((value) => integerField({ [name]: value }, name));
  return fallback === undefined ? schema : schema.default(fallback);
}

function endpointQuery<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess(
    (value) => fieldsOnly(value, Object.keys(shape)),
    z.object(shape),
  );
}

const threadQuery = endpointQuery({
  before: endpointInteger("before").optional(),
  limit: endpointInteger("limit", threadTurnsAnsweredMax),
});
const transcriptQuery = endpointQuery({
  stream: z
    .unknown()
    .transform((value) => textField({ stream: value }, "stream"))
    .optional(),
  after: endpointInteger("after", 0),
  limit: endpointInteger("limit", sessionStorePageBatchesMax),
});
/** One of a member's own threads, or one they hold in the project `project` names. */
const chatThreadQuery = endpointQuery({
  before: endpointInteger("before").optional(),
  limit: endpointInteger("limit", threadTurnsAnsweredMax),
  project: z
    .unknown()
    .transform((value) => textField({ project: value }, "project"))
    .optional(),
});
const emptyBody = z.preprocess((value) => value ?? {}, endpointQuery({}));

export const nativeHttpEndpoints = {
  configurationHead: {
    method: "GET",
    path: nativeHttpRoutes.configurationHead,
    query: endpointQuery({
      repository: z
        .unknown()
        .transform((value) => textField({ repository: value }, "repository")),
    }),
    response: repositoryConfigurationHeadResponseSchema,
  },
  operationalStatus: {
    method: "GET",
    path: nativeHttpRoutes.operationalStatus,
    response: operationalStatusResponseSchema,
  },
  execution: {
    method: "GET",
    path: nativeHttpRoutes.execution,
    response: executionResponseSchema,
  },
  hostedRuns: {
    method: "GET",
    path: nativeHttpRoutes.hostedRuns,
    response: hostedRunsResponseSchema,
  },
  abilities: {
    method: "GET",
    path: nativeHttpRoutes.abilities,
    response: projectAbilitiesResponseSchema,
  },
  lead: {
    method: "GET",
    path: nativeHttpRoutes.lead,
    response: leadReadResponseSchema,
  },
  leadTranscript: {
    method: "GET",
    path: nativeHttpRoutes.leadTranscript,
    query: transcriptQuery,
    response: leadTranscriptResponseSchema,
  },
  runTurns: {
    method: "GET",
    path: nativeHttpRoutes.runTurns,
    query: endpointQuery({
      after: endpointInteger("after").optional(),
      limit: endpointInteger("limit", 50),
    }),
    response: runTurnsResponseSchema,
  },
  runTranscript: {
    method: "GET",
    path: nativeHttpRoutes.runTranscript,
    query: endpointQuery({ after: endpointInteger("after", 0) }),
    response: runTranscriptResponseSchema,
  },
  runConfiguration: {
    method: "GET",
    path: nativeHttpRoutes.runConfiguration,
    response: runConfigurationResponseSchema,
  },
  runError: {
    method: "GET",
    path: nativeHttpRoutes.runError,
    response: runErrorResponseSchema,
  },
  threads: {
    method: "GET",
    path: nativeHttpRoutes.threads,
    response: threadsResponseSchema,
  },
  thread: {
    method: "GET",
    path: nativeHttpRoutes.thread,
    query: threadQuery,
    response: threadResponseSchema,
  },
  threadTranscript: {
    method: "GET",
    path: nativeHttpRoutes.threadTranscript,
    query: transcriptQuery,
    response: threadTranscriptResponseSchema,
  },
  openThread: {
    method: "POST",
    path: nativeHttpRoutes.threads,
    body: threadOpenSchema,
    response: threadEntryResponseSchema,
  },
  sendThreadMessage: {
    method: "POST",
    path: nativeHttpRoutes.threadMessages,
    body: threadMessageSchema,
    response: threadMessageAcceptedSchema,
  },
  stopThreadTurn: {
    method: "POST",
    path: nativeHttpRoutes.threadTurnStop,
    body: emptyBody,
    response: threadTurnStopResponseSchema,
  },
  closeThread: {
    method: "POST",
    path: nativeHttpRoutes.threadClose,
    body: emptyBody,
    response: threadEntryResponseSchema,
  },
  renameThread: {
    method: "POST",
    path: nativeHttpRoutes.threadRename,
    body: threadRenameRequestSchema,
    response: threadRenameResponseSchema,
  },
  hideThread: {
    method: "POST",
    path: nativeHttpRoutes.threadHide,
    body: threadHideRequestSchema,
    response: threadHideResponseSchema,
  },
  chatAbilities: {
    method: "GET",
    path: nativeHttpRoutes.chatAbilities,
    response: chatAbilitiesResponseSchema,
  },
  chatProjects: {
    method: "GET",
    path: nativeHttpRoutes.chatProjects,
    query: endpointQuery({
      after: z
        .unknown()
        .transform((value) => textField({ after: value }, "after"))
        .optional(),
      limit: endpointInteger("limit", nativeHttpPageItemsMax),
    }),
    response: chatProjectsResponseSchema,
  },
  chatThreads: {
    method: "GET",
    path: nativeHttpRoutes.chatThreads,
    response: chatThreadsResponseSchema,
  },
  chatThread: {
    method: "GET",
    path: nativeHttpRoutes.chatThread,
    query: chatThreadQuery,
    response: threadResponseSchema,
  },
  chatThreadTranscript: {
    method: "GET",
    path: nativeHttpRoutes.chatThreadTranscript,
    query: transcriptQuery,
    response: threadTranscriptResponseSchema,
  },
  openChatThread: {
    method: "POST",
    path: nativeHttpRoutes.chatThreads,
    body: threadOpenSchema,
    response: threadEntryResponseSchema,
  },
  sendChatThreadMessage: {
    method: "POST",
    path: nativeHttpRoutes.chatThreadMessages,
    body: threadMessageSchema,
    response: threadMessageAcceptedSchema,
  },
  stopChatThreadTurn: {
    method: "POST",
    path: nativeHttpRoutes.chatThreadTurnStop,
    body: emptyBody,
    response: threadTurnStopResponseSchema,
  },
  closeChatThread: {
    method: "POST",
    path: nativeHttpRoutes.chatThreadClose,
    body: emptyBody,
    response: threadEntryResponseSchema,
  },
  renameChatThread: {
    method: "POST",
    path: nativeHttpRoutes.chatThreadRename,
    body: threadRenameRequestSchema,
    response: threadRenameResponseSchema,
  },
  hideChatThread: {
    method: "POST",
    path: nativeHttpRoutes.chatThreadHide,
    body: threadHideRequestSchema,
    response: threadHideResponseSchema,
  },
  leadInquiries: {
    method: "GET",
    path: nativeHttpRoutes.leadInquiries,
    response: leadInquiriesResponseSchema,
  },
  leadInquiry: {
    method: "GET",
    path: nativeHttpRoutes.leadInquiry,
    response: leadInquiryResponseSchema,
  },
  askLead: {
    method: "POST",
    path: nativeHttpRoutes.leadInquiries,
    body: leadInquirySchema,
    response: leadInquiryAcceptedSchema,
  },
  selectorProposals: {
    method: "GET",
    path: nativeHttpRoutes.selectorProposals,
    response: selectorProposalsResponseSchema,
  },
  reviewSelectorProposal: {
    method: "POST",
    path: nativeHttpRoutes.selectorProposalReview,
    body: selectorProposalReviewSchema,
    response: selectorProposalReviewResponseSchema,
  },
  ticketActionReach: {
    method: "GET",
    path: nativeHttpRoutes.ticketActionReach,
    response: ticketActionReachResponseSchema,
  },
  ticketLandings: {
    method: "GET",
    path: nativeHttpRoutes.ticketLandings,
    response: ticketLandingsResponseSchema,
  },
} as const;

type EndpointParameterNames<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? Name | EndpointParameterNames<Rest>
    : Path extends `${string}:${infer Name}`
      ? Name
      : never;
export type EndpointParameters<Path extends string> = Readonly<
  Record<EndpointParameterNames<Path>, string | number>
>;

/** Fills only complete path segments, with opaque identities encoded exactly once. */
export function endpointPath<Path extends string>(
  path: Path,
  parameters: EndpointParameters<Path>,
): string {
  const fields: Readonly<Record<string, string | number>> = parameters;
  return path
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const value = fields[segment.slice(1)];
      if (value === undefined)
        throw new TypeError(`missing path parameter ${segment}`);
      return encodeURIComponent(String(value));
    })
    .join("/");
}
