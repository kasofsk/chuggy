/**
 * The reads of a project's sessions — its lead, its threads, the inquiries
 * put to it, the selector's decisions and the refusals it raised — each a list
 * a `Session` or `AgenticRefusal` frame stales, except the decisions, which no
 * frame names and the partition's refetch reaches.
 */

import { selectorHistoryLimitMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  AgenticRefusalsResponse,
  LeadInquiriesResponse,
  LeadReadResponse,
  ThreadResponse,
  ThreadsResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiAgenticRefusals,
  apiLead,
  apiLeadInquiries,
  apiSelectorHistory,
  apiThread,
  apiThreads,
} from "./apiRoutes.ts";
import { consoleListQuery, consolePartitionQuery } from "./consoleQuery.ts";
import { inquirySessionKind } from "./leadInquiries.ts";
import { leadSessionNamed, sessionChangeKindNamed } from "./leadTranscript.ts";
import { projectLeadSessionKind } from "./projectLead.ts";
import {
  projectListReread,
  projectListRereadNamed,
} from "./projectQueryKeys.ts";

/**
 * The lead read, re-read on the `Session` frames that name `session` and left
 * alone by the rest — or, until the caller has learnt which session that is,
 * on any lead's frame, which is how a project with none hears one has opened.
 */
export function leadQuery(
  partition: PartitionIdentity,
  session: string | undefined,
  polledMs: number | undefined,
) {
  return consoleListQuery(
    projectListRereadNamed<LeadReadResponse>(
      partition,
      "Session",
      "lead",
      (change) =>
        session === undefined
          ? sessionChangeKindNamed(change.resource) === projectLeadSessionKind
          : leadSessionNamed(change.resource) === session,
    ),
    (ports) => apiLead(ports, partition),
    polledMs,
  );
}

/** The listing the chat pane reads, which lists no lead session and so is not
 * read again on the frames of one. */
export function threadsQuery(partition: PartitionIdentity) {
  return consoleListQuery(
    projectListRereadNamed<ThreadsResponse>(
      partition,
      "Session",
      "threads",
      (change) =>
        sessionChangeKindNamed(change.resource) !== projectLeadSessionKind,
    ),
    (ports) => apiThreads(ports, partition),
  );
}

/** One thread, named by the session it draws so two threads open at once are
 * two entries and not one. */
export function threadQuery(partition: PartitionIdentity, session: string) {
  return consoleListQuery(
    projectListRereadNamed<ThreadResponse>(
      partition,
      "Session",
      `thread-${session}`,
      (change) => leadSessionNamed(change.resource) === session,
    ),
    (ports) => apiThread(ports, partition, session),
  );
}

/** One project's inquiries, re-read on the `Session` frames naming an inquiry
 * and left alone by every other kind. Built from a project rather than closed
 * over the one on screen, because an accepted press re-reads the project it was
 * asked in and that is not always the project being drawn when it answers. */
export function leadInquiriesQuery(partition: PartitionIdentity) {
  return consoleListQuery(
    projectListRereadNamed<LeadInquiriesResponse>(
      partition,
      "Session",
      "inquiries",
      (change) =>
        sessionChangeKindNamed(change.resource) === inquirySessionKind,
    ),
    (ports) => apiLeadInquiries(ports, partition),
  );
}

export function agenticRefusalsQuery(partition: PartitionIdentity) {
  return consoleListQuery(
    projectListReread<AgenticRefusalsResponse>(
      partition,
      "AgenticRefusal",
      "lead",
    ),
    (ports) => apiAgenticRefusals(ports, partition),
  );
}

/** The selector's newest decisions, which no frame names. */
export function leadDecisionsQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "selector-history", (ports) =>
    apiSelectorHistory(ports, partition, {
      order: "newest",
      limit: selectorHistoryLimitMax,
    }),
  );
}
