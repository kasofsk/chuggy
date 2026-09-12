/**
 * One bounded request to Ory Keto, and the fault every caller here classifies
 * the same way.
 *
 * EVERY OUTCOME BUT A READ 200 BODY IS A FAULT. A refusal is a 200 saying the
 * subject is not allowed; a status this side did not ask for, a body it cannot
 * read and a connection it could not open are all this server failing to
 * decide, and answering any of them as "not allowed" would turn an outage into
 * a silent denial for every caller at once.
 *
 * THE BODY IS READ UNDER A BYTE BOUND rather than awaited whole, because the
 * answers this module reads are a flag or a status and an authority that
 * answered a stream instead is one this side cannot decide from.
 */

import { ProjectAccessUnavailable } from "../../interpreter/projectAccess.ts";

/** The most one answer may weigh, which is orders above every body read here. */
export const ketoResponseBytesMax = 64 * 1024;

/** The most reads one answer may take, so a trickle of empty chunks cannot hold the request open. */
export const ketoResponseReadsMax = 64;

async function ketoBoundedText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let reads = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    reads += 1;
    if (reads > ketoResponseReadsMax || bytes > ketoResponseBytesMax) {
      await reader.cancel("the authority's answer is past its bound");
      throw new ProjectAccessUnavailable(
        "the authority's answer is past its bound",
      );
    }
    const chunk = read.value as Uint8Array;
    bytes += chunk.byteLength;
    chunks.push(chunk);
  }
  if (bytes > ketoResponseBytesMax)
    throw new ProjectAccessUnavailable(
      "the authority's answer is past its bound",
    );
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ProjectAccessUnavailable("the authority's answer is not text");
  }
}

/** One request, its transport faults and its non-200 answers alike raised as undecided. */
export async function ketoRequest(input: {
  readonly url: URL;
  readonly method: string;
  readonly requestTimeoutMs: number;
  readonly fetcher: typeof fetch;
  readonly body?: unknown;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await input.fetcher(input.url, {
      method: input.method,
      signal: AbortSignal.timeout(input.requestTimeoutMs),
      headers: {
        accept: "application/json",
        ...(input.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  } catch (failure) {
    throw new ProjectAccessUnavailable(
      `${input.method} ${input.url.pathname} did not complete: ${
        failure instanceof Error ? failure.message : "unknown fault"
      }`,
    );
  }
  let text: string;
  try {
    text = await ketoBoundedText(response);
  } catch (failure) {
    if (failure instanceof ProjectAccessUnavailable) throw failure;
    throw new ProjectAccessUnavailable(
      `${input.method} ${input.url.pathname} answered a body that could not be read`,
    );
  }
  if (!response.ok)
    throw new ProjectAccessUnavailable(
      `${input.method} ${input.url.pathname} answered ${String(response.status)}`,
    );
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProjectAccessUnavailable(
      `${input.method} ${input.url.pathname} answered something that is not JSON`,
    );
  }
}
