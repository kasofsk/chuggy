import { z } from "zod";

import type {
  SelectorPolicyRequest,
  SelectorTerminationResult,
} from "../../interpreter/selector.ts";
import type { TrustedSelectorPolicy } from "../../interpreter/trustedSelectorPolicyHost.ts";
import { selectorOperationalContextV2Schema } from "./selectorContext.ts";
import { checkedPositiveBound } from "./bounds.ts";

export const trustedSelectorPolicyProtocolVersion = 1;
export const trustedSelectorPolicyMediaType =
  "application/vnd.chuggy.selector-policy.v1+json";
export const trustedSelectorPolicyRequestBytesMax = 1_048_576;
export const trustedSelectorPolicyCollectionMembersMax = 1_000;
export const trustedSelectorPolicyTerminationProofCharsMax = 1_024;
export const trustedSelectorPolicyRoutes = {
  execute: "v1/execute",
  cancel: "v1/cancel",
  inspect: "v1/inspect",
  readiness: "v1/ready",
} as const;

const integer = z.number().int().safe().nonnegative();
const positiveInteger = z.number().int().safe().positive();
const boundedText = z.string().min(1).max(65_536);
const terminationProof = z
  .string()
  .min(1)
  .max(trustedSelectorPolicyTerminationProofCharsMax);
const identity = z.string().min(1).max(256);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const json = z.json();

const token = z.strictObject({
  tenant: identity,
  project: identity,
  recoveryEpoch: identity,
  schemaVersion: positiveInteger,
  watermark: integer,
  digest,
});

const candidate = z.strictObject({
  ticket: positiveInteger,
  ticketVersion: integer,
  dependencies: z
    .array(positiveInteger)
    .max(trustedSelectorPolicyCollectionMembersMax),
  workFanout: positiveInteger,
  program: z
    .array(
      z.strictObject({
        fanout: positiveInteger,
        combinator: z.enum(["UnanimousPass", "AnyPass"]),
      }),
    )
    .max(trustedSelectorPolicyCollectionMembersMax),
  reworkPolicy: z.strictObject({
    type: z.literal("BudgetedRework"),
    value: integer,
  }),
  finalizationPricing: z.union([
    z.literal("DeadlineOnly"),
    z.strictObject({ type: z.literal("Budgeted"), value: integer }),
  ]),
  resumePricing: z.enum(["RetryCharged", "RetryFree"]),
  finalizer: z.enum(["NoFinalizer", "ManagedFinalizer"]),
  configurationRevision: identity,
  configurationDigest: digest,
  configurationCanonical: boundedText,
});

const capacity = z.strictObject({
  allocated: integer,
  limit: integer,
  available: integer,
});

const reviewFeedback = z
  .array(
    z.strictObject({
      ordinal: integer,
      selectorDecision: identity,
      outcome: z.enum(["Approved", "Rejected"]),
      reviewer: z.strictObject({ kind: identity, subject: identity }),
      feedback: boundedText.optional(),
      reviewedAt: identity,
    }),
  )
  .max(trustedSelectorPolicyCollectionMembersMax);

const operationalContextV1 = z.strictObject({
  version: z.literal(1),
  observedAt: identity,
  observedAtEpochMs: integer,
  reviewFeedback,
  activeWork: z
    .array(
      z.strictObject({
        ticket: positiveInteger,
        queuedTasks: integer,
        admittedTasks: integer,
        runningAttempts: integer,
      }),
    )
    .max(trustedSelectorPolicyCollectionMembersMax),
  projectCapacity: capacity.extend({ account: identity }),
  clusterCapacity: capacity.extend({
    visibility: z.literal("AuthorizedAggregate"),
    pressure: z.enum(["Normal", "Constrained", "Exhausted", "Unknown"]),
  }),
  executionBacklog: z.strictObject({
    queued: integer,
    ceiling: integer,
    dispatchAllowed: z.boolean(),
  }),
});

const operationalContext = z.discriminatedUnion("version", [
  operationalContextV1,
  selectorOperationalContextV2Schema,
]);

const candidateScan = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("Continue"),
    token,
    after: positiveInteger,
  }),
  z.strictObject({ state: z.literal("Exhausted"), token }),
]);

const limits = z.strictObject({
  tokensPerDecision: integer,
  millisecondsPerDecision: positiveInteger,
  toolCallsPerDecision: integer,
  inputBytesPerDecision: positiveInteger,
  candidatePagesPerDecision: positiveInteger,
  concurrentDecisions: positiveInteger,
  selectionsPerMinute: positiveInteger,
});

const policyRequest = z.strictObject({
  attempt: identity,
  observation: z.strictObject({
    token,
    candidates: z
      .array(candidate)
      .max(trustedSelectorPolicyCollectionMembersMax),
    notificationCursor: integer,
    operationalContext,
    workingMemory: json,
    nextCandidateScan: candidateScan,
    resourceLimit: z.literal("CandidateTooLarge").optional(),
  }),
  instructions: z.strictObject({ revision: integer, content: boundedText }),
  constraints: z.strictObject({
    models: z.array(identity).max(trustedSelectorPolicyCollectionMembersMax),
    tools: z.array(identity).max(trustedSelectorPolicyCollectionMembersMax),
    limits,
  }),
});

const policyResult = z.strictObject({
  selectedTicket: positiveInteger.optional(),
  planningIntent: json.optional(),
  attention: z.enum(["Monitoring", "Attention", "Stopped"]),
  workingMemory: json,
});
const policyExecution = z.strictObject({
  result: policyResult,
  implementationRevision: identity,
  modelRevision: identity,
  policyRevision: identity,
  toolActivity: z.array(json).max(trustedSelectorPolicyCollectionMembersMax),
  accounting: z.strictObject({ tokens: integer, durationMs: integer }),
  startedAt: identity,
  completedAt: identity,
});
const executionEnvelope = z.strictObject({
  version: z.literal(trustedSelectorPolicyProtocolVersion),
  execution: policyExecution,
});
const attemptEnvelope = z.strictObject({
  version: z.literal(trustedSelectorPolicyProtocolVersion),
  attempt: identity,
});
const terminationEnvelope = z.strictObject({
  version: z.literal(trustedSelectorPolicyProtocolVersion),
  termination: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("Terminated"),
      attempt: identity,
      proof: terminationProof,
    }),
    z.strictObject({ status: z.literal("Unconfirmed") }),
  ]),
});
const readinessEnvelope = z.strictObject({
  version: z.literal(trustedSelectorPolicyProtocolVersion),
  ready: z.boolean(),
});

export interface TrustedSelectorPolicyClientConfig {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly requestDeadlineMs: number;
  readonly responseBytesMax: number;
}

export interface TrustedSelectorPolicyClient extends TrustedSelectorPolicy {
  ready(signal?: AbortSignal): Promise<boolean>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface CheckedConfig {
  readonly baseUrl: URL;
  readonly authorization: string;
  readonly requestDeadlineMs: number;
  readonly responseBytesMax: number;
}

function checkedConfig(
  config: TrustedSelectorPolicyClientConfig,
): CheckedConfig {
  const baseUrl = new URL(config.baseUrl);
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  )
    throw new TypeError("selector policy base URL must be an HTTP service URL");
  if (
    config.bearerToken.length === 0 ||
    !config.bearerToken.isWellFormed() ||
    /\s/u.test(config.bearerToken)
  )
    throw new TypeError("selector policy bearer token is invalid");
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/u, "")}/`;
  return {
    baseUrl,
    authorization: `Bearer ${config.bearerToken}`,
    requestDeadlineMs: checkedPositiveBound(
      config.requestDeadlineMs,
      "selector policy request deadline",
    ),
    responseBytesMax: checkedPositiveBound(
      config.responseBytesMax,
      "selector policy response bound",
    ),
  };
}

async function boundedResponseBytes(
  response: Response,
  bytesMax: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > bytesMax)
  )
    throw new RangeError("selector policy response exceeds its byte bound");
  if (response.body === null)
    throw new TypeError("selector policy response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let index = 0; index <= bytesMax; index += 1) {
    const chunk = (await reader.read()) as
      | { readonly done: true; readonly value?: undefined }
      | { readonly done: false; readonly value: Uint8Array };
    if (chunk.done) {
      const joined = new Uint8Array(length);
      let offset = 0;
      for (const value of chunks) {
        joined.set(value, offset);
        offset += value.byteLength;
      }
      return joined;
    }
    length += chunk.value.byteLength;
    if (length > bytesMax) {
      await reader.cancel();
      throw new RangeError("selector policy response exceeds its byte bound");
    }
    chunks.push(chunk.value);
  }
  await reader.cancel();
  throw new RangeError("selector policy response has too many chunks");
}

async function responseJson(
  response: Response,
  bytesMax: number,
): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `selector policy service returned HTTP ${String(response.status)}`,
    );
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== trustedSelectorPolicyMediaType) {
    await response.body?.cancel();
    throw new TypeError("selector policy response has the wrong media type");
  }
  const bytes = await boundedResponseBytes(response, bytesMax);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("selector policy response is not valid UTF-8 JSON");
  }
}

function requestBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (
    new TextEncoder().encode(body).byteLength >
    trustedSelectorPolicyRequestBytesMax
  )
    throw new RangeError("selector policy request exceeds its byte bound");
  return body;
}

function clientRequest(
  fetcher: Fetch,
  config: CheckedConfig,
  path: string,
  method: "GET" | "POST",
  body: string | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const deadline = new AbortController();
  const timeout = setTimeout(() => {
    deadline.abort();
  }, config.requestDeadlineMs);
  const combined =
    signal === undefined
      ? deadline.signal
      : AbortSignal.any([signal, deadline.signal]);
  return fetcher(new URL(path, config.baseUrl).href, {
    method,
    headers: {
      authorization: config.authorization,
      accept: trustedSelectorPolicyMediaType,
      ...(body === undefined
        ? {}
        : { "content-type": trustedSelectorPolicyMediaType }),
    },
    ...(body === undefined ? {} : { body }),
    signal: combined,
  })
    .then((response) => responseJson(response, config.responseBytesMax))
    .catch((error: unknown) => {
      if (deadline.signal.aborted && signal?.aborted !== true)
        throw new Error("selector policy request deadline exceeded", {
          cause: error,
        });
      throw error;
    })
    .finally(() => {
      clearTimeout(timeout);
    });
}

export function parseTrustedSelectorPolicyRequest(
  value: unknown,
): SelectorPolicyRequest {
  return policyRequest.parse(value) as unknown as SelectorPolicyRequest;
}

export function trustedSelectorPolicyHttpClient(
  configValue: TrustedSelectorPolicyClientConfig,
  fetcher: Fetch = fetch,
): TrustedSelectorPolicyClient {
  const config = checkedConfig(configValue);
  const postAttempt = async (
    path: string,
    attempt: string,
    signal: AbortSignal,
  ): Promise<SelectorTerminationResult> => {
    const body = attemptEnvelope.parse({
      version: trustedSelectorPolicyProtocolVersion,
      attempt,
    });
    const response = await clientRequest(
      fetcher,
      config,
      path,
      "POST",
      requestBody(body),
      signal,
    );
    const termination = terminationEnvelope.parse(response).termination;
    if (termination.status === "Terminated" && termination.attempt !== attempt)
      throw new TypeError("selector policy termination names another attempt");
    return termination;
  };
  return {
    execute: async (request, signal) => {
      const checked = parseTrustedSelectorPolicyRequest(request);
      const response = await clientRequest(
        fetcher,
        config,
        trustedSelectorPolicyRoutes.execute,
        "POST",
        requestBody({
          version: trustedSelectorPolicyProtocolVersion,
          request: checked,
        }),
        signal,
      );
      return executionEnvelope.parse(response).execution;
    },
    cancel: (attempt, signal) =>
      postAttempt(trustedSelectorPolicyRoutes.cancel, attempt, signal),
    inspect: (attempt, signal) =>
      postAttempt(trustedSelectorPolicyRoutes.inspect, attempt, signal),
    ready: async (signal) => {
      const response = await clientRequest(
        fetcher,
        config,
        trustedSelectorPolicyRoutes.readiness,
        "GET",
        undefined,
        signal,
      );
      return readinessEnvelope.parse(response).ready;
    },
  };
}
