/**
 * One public request: bearer, media type, timeout, bounded retry, and the
 * contract's classification of whatever came back.
 *
 * `classify` from `src/contract/outcomes.ts` decides what a status means, and
 * caps `retry-after` before handing it over; what this module adds is a
 * deadline on every request, a bound on how many times that delay is honoured,
 * and the two answers a network gives that no status describes. A 202 is folded
 * into `Ok` because the acceptance body is what a caller of the one route that
 * answers 202 reads.
 */

import { classify } from "../../../../src/contract/outcomes.ts";
import type { ApiOutcome } from "../../../../src/contract/outcomes.ts";
import { nativeHttpMediaType } from "../../../../src/contract/http.ts";

export const apiTimeoutMsDefault = 15_000;
export const apiAttemptsMax = 3;

export interface ApiFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

export type ApiFetchPort = (
  url: string,
  init: ApiFetchInit,
) => Promise<Response>;

export interface ApiPorts {
  readonly fetch: ApiFetchPort;
  readonly bearer: () => Promise<string | undefined>;
  readonly sleepMs: (
    ms: number,
    signal: AbortSignal | undefined,
  ) => Promise<void>;
}

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * The refusals are the contract's own members, subtracted rather than
 * restated: a member it gains arrives here, and one it renames stops compiling.
 */
type ApiRefusal = Exclude<
  ApiOutcome,
  { readonly outcome: "Ok" } | { readonly outcome: "Accepted" }
>;

/** What a network answers with instead of a status, and what a parser answers. */
type ApiNoAnswer =
  | { readonly outcome: "Unreachable"; readonly reason: string }
  | { readonly outcome: "Unreadable"; readonly reason: string };

export type ApiResult<T> =
  { readonly outcome: "Ok"; readonly value: T } | ApiRefusal | ApiNoAnswer;

export type ApiFailure = Exclude<
  ApiResult<unknown>,
  { readonly outcome: "Ok" }
>;

/** The outcome carried as an error, so a cache holds the value and not a wrapper. */
export class ApiOutcomeError extends Error {
  readonly result: ApiFailure;

  constructor(result: ApiFailure, message: string) {
    super(message);
    this.name = "ApiOutcomeError";
    this.result = result;
  }
}

/** For a cache that holds resources: the value, or the outcome as an error. */
export function apiOrThrow<T>(
  result: ApiResult<T>,
  reason: (failure: ApiFailure) => string,
): T {
  if (result.outcome === "Ok") return result.value;
  throw new ApiOutcomeError(result, reason(result));
}

interface ApiDeadline {
  readonly signal: AbortSignal;
  readonly done: () => void;
}

function apiDeadline(
  timeoutMs: number,
  caller: AbortSignal | undefined,
): ApiDeadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("the request outlived its deadline"));
  }, timeoutMs);
  const relay = () => {
    controller.abort(new Error("the caller abandoned the request"));
  };
  caller?.addEventListener("abort", relay, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", relay);
    },
  };
}

function apiHeaders(
  bearer: string | undefined,
  request: ApiRequest,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = { accept: nativeHttpMediaType };
  if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer}`;
  if (hasBody) headers["content-type"] = nativeHttpMediaType;
  if (request.idempotencyKey !== undefined)
    headers["idempotency-key"] = request.idempotencyKey;
  return headers;
}

/** An empty body is not a JSON document, and neither is one that will not parse. */
function apiBody(text: string): unknown {
  if (text.trim() === "") return undefined;
  return JSON.parse(text);
}

async function apiOnce(
  ports: ApiPorts,
  request: ApiRequest,
): Promise<ApiOutcome> {
  const deadline = apiDeadline(
    request.timeoutMs ?? apiTimeoutMsDefault,
    request.signal,
  );
  try {
    const body =
      request.body === undefined ? undefined : JSON.stringify(request.body);
    const response = await ports.fetch(request.path, {
      method: request.method,
      headers: apiHeaders(await ports.bearer(), request, body !== undefined),
      ...(body === undefined ? {} : { body }),
      signal: deadline.signal,
    });
    return classify(
      response.status,
      (name) => response.headers.get(name),
      apiBody(await response.text()),
    );
  } finally {
    deadline.done();
  }
}

function apiReason(failure: unknown): string {
  return failure instanceof Error ? failure.message : "the request failed";
}

/** The retry is the server's own instruction, honoured a bounded number of times. */
export async function apiSend(
  ports: ApiPorts,
  request: ApiRequest,
): Promise<
  ApiOutcome | { readonly outcome: "Unreachable"; readonly reason: string }
> {
  let last: ApiOutcome | undefined;
  for (let attempt = 0; attempt < apiAttemptsMax; attempt += 1) {
    try {
      last = await apiOnce(ports, request);
    } catch (failure: unknown) {
      return { outcome: "Unreachable", reason: apiReason(failure) };
    }
    if (last.outcome !== "Retryable") return last;
    if (attempt + 1 === apiAttemptsMax) return last;
    await ports.sleepMs(last.retryAfterSeconds * 1_000, request.signal);
  }
  return last ?? { outcome: "Unreachable", reason: "no attempt was made" };
}

/** The parser is the wire's; a body it rejects is a server fault, drawn as one. */
export async function apiRead<T>(
  ports: ApiPorts,
  request: ApiRequest,
  parse: (value: unknown) => T,
): Promise<ApiResult<T>> {
  const outcome = await apiSend(ports, request);
  if (outcome.outcome !== "Ok" && outcome.outcome !== "Accepted")
    return outcome;
  try {
    return { outcome: "Ok", value: parse(outcome.body) };
  } catch (failure: unknown) {
    return { outcome: "Unreadable", reason: apiReason(failure) };
  }
}
