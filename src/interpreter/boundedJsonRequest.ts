/**
 * One JSON request through a fetcher the caller holds, its answer read under a
 * byte bound and a read bound, and its status left to the caller to judge.
 *
 * IT IS HERE SO THAT ADAPTERS CAN SHARE IT. No adapter may reach another, and
 * this reaches nothing but the fetcher and the signal it is handed, so the
 * network and the clock stay the adapter's.
 *
 * NOT ANSWERING IS ONE FAULT, `BoundedJsonUnanswered`: a request that did not
 * complete, and a body past either bound. A body that is not JSON is answered
 * as no JSON, because only the caller knows whether its status carries any.
 */

/** What one request is, and how much of its answer may be read. */
export interface BoundedJsonRequest {
  readonly fetcher: typeof fetch;
  readonly url: URL;
  readonly method: "GET" | "POST";
  readonly signal: AbortSignal;
  readonly bytesMax: number;
  readonly readsMax: number;
  readonly body?: unknown;
}

/** The status, and the body read as JSON, or nothing where it is empty or is not JSON. */
export interface BoundedJsonAnswer {
  readonly status: number;
  readonly json: unknown;
}

/** A request that came to no answer this side may read. */
export class BoundedJsonUnanswered extends Error {
  constructor(why: string) {
    super(why);
    this.name = "BoundedJsonUnanswered";
  }
}

/** The body's chunks, refused once they pass either bound. */
async function boundedJsonChunks(
  body: ReadableStream<Uint8Array>,
  bytesMax: number,
  readsMax: number,
): Promise<readonly Uint8Array[]> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let weighed = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    weighed += read.value.byteLength;
    chunks.push(read.value);
    if (chunks.length > readsMax || weighed > bytesMax) {
      await reader.cancel();
      throw new BoundedJsonUnanswered("the answer is past its bound");
    }
  }
  return chunks;
}

/** The chunks as JSON, or nothing where they are empty, not text, or not JSON. */
function boundedJsonParsed(chunks: readonly Uint8Array[]): unknown {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    const text =
      chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") +
      decoder.decode();
    return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

export async function boundedJsonRequest(
  request: BoundedJsonRequest,
): Promise<BoundedJsonAnswer> {
  let response: Response;
  try {
    response = await request.fetcher(request.url, {
      method: request.method,
      signal: request.signal,
      redirect: "error",
      headers:
        request.body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
  } catch {
    throw new BoundedJsonUnanswered(
      `${request.method} ${request.url.pathname} did not complete`,
    );
  }
  const chunks =
    response.body === null
      ? []
      : await boundedJsonChunks(
          response.body,
          request.bytesMax,
          request.readsMax,
        ).catch((failure: unknown) => {
          if (failure instanceof BoundedJsonUnanswered) throw failure;
          throw new BoundedJsonUnanswered(
            `${request.method} ${request.url.pathname} answered a body that could not be read`,
          );
        });
  return { status: response.status, json: boundedJsonParsed(chunks) };
}
