/**
 * The one bounded read every client in this directory does of an answer it did
 * not write.
 *
 * A DEADLINE IS NOT A SIZE BOUND. An abort signal ends a body that stopped
 * arriving; it does nothing about one that keeps arriving quickly, which is the
 * shape that exhausts this process rather than stalling it. House rule 9 wants
 * both, so the byte count is here and the deadline stays on the request.
 *
 * TOO MUCH IS NOTHING AT ALL. An over-long answer comes back as `undefined`
 * rather than as a truncated string, because a prefix of a JSON document parses
 * as nothing useful and, where it did parse, would be a document the sender
 * never sent.
 */

/** The answer's text, or nothing where it weighed more than the caller allows. */
export async function httpBoundedText(
  response: Response,
  bytesMax: number,
): Promise<string | undefined> {
  if (response.body === null) return "";
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let weighed = 0;
  try {
    for (
      let read = await reader.read();
      !read.done;
      read = await reader.read()
    ) {
      const chunk: Uint8Array = read.value;
      weighed += chunk.byteLength;
      if (weighed > bytesMax) return undefined;
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks),
  );
}
