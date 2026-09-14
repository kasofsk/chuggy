/** Shared conversation and run-evidence endpoints for the server, browser, and contract document. */
import { fieldsOnly, integerField, textField } from "./fields.ts";
import { z } from "zod";
import {
  nativeHttpRoutes,
  sessionStorePageBatchesMax,
  threadTurnsAnsweredMax,
} from "./http.ts";
import {
  threadMessageSchema,
  threadRenameRequestSchema,
  threadHideRequestSchema,
  leadInquirySchema,
} from "./requests.ts";
import {
  operationalStatusResponseSchema,
  executionResponseSchema,
  leadResponseSchema,
  leadTranscriptResponseSchema,
  runTurnsResponseSchema,
  runTranscriptResponseSchema,
  runConfigurationResponseSchema,
  threadsResponseSchema,
  threadResponseSchema,
  threadTranscriptResponseSchema,
  threadEntryResponseSchema,
  threadMessageAcceptedSchema,
  threadRenameResponseSchema,
  threadHideResponseSchema,
  leadInquiriesResponseSchema,
  leadInquiryResponseSchema,
  leadInquiryAcceptedSchema,
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
const emptyBody = z.preprocess((value) => value ?? {}, endpointQuery({}));

export const nativeHttpEndpoints = {
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
  lead: {
    method: "GET",
    path: nativeHttpRoutes.lead,
    response: leadResponseSchema,
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
    body: emptyBody,
    response: threadEntryResponseSchema,
  },
  sendThreadMessage: {
    method: "POST",
    path: nativeHttpRoutes.threadMessages,
    body: threadMessageSchema,
    response: threadMessageAcceptedSchema,
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
