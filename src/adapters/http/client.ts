import type { Principal } from "../../interpreter/nativeWeb.ts";
import type { SelectorNativeApi } from "../../interpreter/selectorNativeSource.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  dispatchViewResponseSchema,
  errorResponseSchema,
  notificationsResponseSchema,
  operationResponseSchema,
  projectInventoryResponseSchema,
  proposalSubmissionResponseSchema,
} from "./codecs.ts";
import { encodeInventoryCursor, nativeHttpMediaType } from "./contract.ts";

export interface NativeHttpClientConfig {
  readonly baseUrl: string;
  readonly accessToken: (signal: AbortSignal) => Promise<string>;
  readonly requestTimeoutMs: number;
  readonly responseBytesMax: number;
  readonly fetch?: typeof fetch;
}

function checkedPositiveBound(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function projectPath(partition: Partition): string {
  return `/api/v1/tenants/${encodeURIComponent(partition.tenant)}/projects/${encodeURIComponent(partition.project)}`;
}

function queryString(
  values: Readonly<Record<string, string | number | undefined>>,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values))
    if (value !== undefined) query.set(name, String(value));
  const encoded = query.toString();
  return encoded.length === 0 ? "" : `?${encoded}`;
}

async function boundedJson(
  response: Response,
  bytesMax: number,
): Promise<unknown> {
  if (response.body === null)
    throw new TypeError("native HTTP response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let reads = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    reads += 1;
    if (reads > bytesMax) {
      await reader.cancel("native HTTP response exceeds its read limit");
      throw new RangeError("native HTTP response exceeds its read limit");
    }
    const chunk = read.value as Uint8Array;
    bytes += chunk.byteLength;
    if (bytes > bytesMax) {
      await reader.cancel("native HTTP response exceeds its byte limit");
      throw new RangeError("native HTTP response exceeds its byte limit");
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function checkedToken(value: string): string {
  if (value.length === 0 || /[\r\n]/u.test(value))
    throw new RangeError("native HTTP bearer token is empty or malformed");
  return value;
}

function retryAfter(response: Response): number {
  const value = response.headers.get("retry-after");
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new TypeError("native HTTP retry-after is invalid");
  return parsed;
}

function abortable<Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  const reason = (): Error =>
    signal.reason instanceof Error
      ? signal.reason
      : new Error("native HTTP request aborted");
  if (signal.aborted) return Promise.reject(reason());
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(reason());
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (failure: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(
          failure instanceof Error
            ? failure
            : new Error("native HTTP authentication failed"),
        );
      },
    );
  });
}

interface NativeHttpClientContext {
  readonly baseUrl: URL;
  readonly accessToken: NativeHttpClientConfig["accessToken"];
  readonly timeoutMs: number;
  readonly bytesMax: number;
  readonly requestFetch: typeof fetch;
}

interface NativeHttpFound {
  readonly response: Response;
  readonly body: unknown;
}

async function nativeRequest(
  context: NativeHttpClientContext,
  path: string,
  init: Omit<RequestInit, "signal"> = {},
): Promise<NativeHttpFound> {
  const signal = AbortSignal.timeout(context.timeoutMs);
  const token = checkedToken(
    await abortable(context.accessToken(signal), signal),
  );
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", nativeHttpMediaType);
  if (init.body !== undefined) headers.set("content-type", nativeHttpMediaType);
  const response = await context.requestFetch(new URL(path, context.baseUrl), {
    ...init,
    headers,
    signal,
  });
  return {
    response,
    body: await boundedJson(response, context.bytesMax),
  };
}

async function projectInventory(
  context: NativeHttpClientContext,
  after: Parameters<SelectorNativeApi["projectInventory"]>[1],
  limit: number,
) {
  const found = await nativeRequest(
    context,
    `/api/v1/projects${queryString({
      cursor: after === undefined ? undefined : encodeInventoryCursor(after),
      limit,
    })}`,
  );
  if (found.response.status !== 200)
    throw new Error("native HTTP project inventory failed");
  return projectInventoryResponseSchema.parse(found.body);
}

async function notifications(
  context: NativeHttpClientContext,
  partition: Parameters<SelectorNativeApi["notifications"]>[1],
  cursor: Parameters<SelectorNativeApi["notifications"]>[2],
) {
  const path = `${projectPath(partition)}/notifications${queryString({ after: cursor.after, limit: cursor.limit })}`;
  const found = await nativeRequest(context, path);
  if (found.response.status === 404) return { result: "NotFound" } as const;
  if (found.response.status !== 200)
    throw new Error("native HTTP notifications failed");
  return {
    result: "Authorized",
    value: notificationsResponseSchema.parse(found.body),
  } as const;
}

async function dispatchView(
  context: NativeHttpClientContext,
  partition: Parameters<SelectorNativeApi["dispatchView"]>[1],
  query: Parameters<SelectorNativeApi["dispatchView"]>[2],
) {
  const path = `${projectPath(partition)}/dispatch-view${queryString({ after: query.after, limit: query.limit, watermark: query.watermark })}`;
  const found = await nativeRequest(context, path);
  if (found.response.status === 404) return { result: "NotFound" } as const;
  if (found.response.status !== 200)
    throw new Error("native HTTP dispatch view failed");
  return {
    result: "Authorized",
    value: dispatchViewResponseSchema.parse(found.body),
  } as const;
}

function proposalRefusal(found: NativeHttpFound) {
  const error = errorResponseSchema.parse(found.body);
  const retryAfterSeconds = (): number => retryAfter(found.response);
  if (found.response.status === 404) return { result: "NotFound" } as const;
  if (found.response.status === 429 && error.error.code === "DispatchBacklog")
    return {
      result: "Backlogged",
      retryAfterSeconds: retryAfterSeconds(),
    } as const;
  if (found.response.status === 429 || found.response.status === 503)
    return {
      result: "Authorized",
      acceptance: {
        accepted:
          found.response.status === 429 ? "Backpressure" : "Unavailable",
        retryAfterSeconds: retryAfterSeconds(),
      },
    } as const;
  if (
    found.response.status === 409 &&
    error.error.code === "IdempotencyConflict"
  )
    return {
      result: "Authorized",
      acceptance: { accepted: "IdempotencyConflict" },
    } as const;
  if (
    found.response.status === 409 &&
    error.error.code === "MutationNotAdmitted"
  )
    return {
      result: "Authorized",
      acceptance: { accepted: "NotAdmitted" },
    } as const;
  if (found.response.status === 422)
    return {
      result: "Authorized",
      acceptance: { accepted: "InvalidCommand" },
    } as const;
  throw new Error("native HTTP proposal submission failed");
}

async function submit(
  context: NativeHttpClientContext,
  submission: Parameters<SelectorNativeApi["submit"]>[1],
) {
  const command = submission.command;
  if (command.command !== "ProposeDispatch")
    throw new TypeError("native HTTP selector client accepts proposals only");
  const found = await nativeRequest(
    context,
    `${projectPath(submission.partition)}/operations`,
    {
      method: "POST",
      body: JSON.stringify({
        operation: submission.operation,
        mutation: {
          mutation: "ProposeDispatch",
          ticket: command.ticket,
          expectedTicketVersion: command.expectedTicketVersion,
          observedViewToken: command.observedViewToken,
          selectorDecisionReference: command.selectorDecisionReference,
        },
      }),
      headers: { "idempotency-key": submission.key },
    },
  );
  if (found.response.status !== 202) return proposalRefusal(found);
  proposalSubmissionResponseSchema.parse(found.body);
  return {
    result: "Authorized",
    acceptance: { accepted: "Accepted" },
  } as const;
}

async function operation(
  context: NativeHttpClientContext,
  partition: Parameters<SelectorNativeApi["operation"]>[1],
  identity: Parameters<SelectorNativeApi["operation"]>[2],
) {
  const found = await nativeRequest(
    context,
    `${projectPath(partition)}/operations/${encodeURIComponent(identity)}`,
  );
  if (found.response.status === 404) return undefined;
  if (found.response.status !== 200)
    throw new Error("native HTTP operation read failed");
  return operationResponseSchema.parse(found.body);
}

export function nativeHttpClient(
  config: NativeHttpClientConfig,
): SelectorNativeApi {
  const context: NativeHttpClientContext = {
    baseUrl: new URL(config.baseUrl),
    accessToken: config.accessToken,
    timeoutMs: checkedPositiveBound(config.requestTimeoutMs, "request timeout"),
    bytesMax: checkedPositiveBound(
      config.responseBytesMax,
      "response byte limit",
    ),
    requestFetch: config.fetch ?? fetch,
  };
  return {
    projectInventory: (_principal: Principal, after, limit) =>
      projectInventory(context, after, limit),
    notifications: (_principal, partition, cursor) =>
      notifications(context, partition, cursor),
    dispatchView: (_principal, partition, query) =>
      dispatchView(context, partition, query),
    submit: (_principal, submission) => submit(context, submission),
    operation: (_principal, partition, identity) =>
      operation(context, partition, identity),
  };
}
