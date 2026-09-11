/**
 * One forge response's whole text, refused rather than truncated once it
 * passes the bound it is read under.
 *
 * IT IS SHARED BECAUSE EVERY REQUEST TO THIS FORGE IS READ THE SAME WAY. A
 * second copy of a byte bound is a second chance to get one wrong, and the way
 * it would go wrong — a body counted by decoded characters rather than by the
 * bytes that arrive — is invisible until the answer that exploits it.
 *
 * A BODY REFUSED BEFORE IT IS READ IS CANCELLED FIRST, because a refusal that
 * leaves the stream open holds the connection it refused.
 */

/** The whole body as text, raising rather than answering where it cannot be read within the bound. */
export async function githubResponseTextOf(
  response: Response,
  bytesMax: number,
  what: string,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > bytesMax) {
    await response.body?.cancel().catch(() => undefined);
    throw new RangeError(`${what}: a response declares too many bytes`);
  }
  if (response.body === null)
    throw new TypeError(`${what}: a response carried no body`);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body.getReader();
  let text = "";
  let bytes = 0;
  for (let chunks = 0; chunks <= bytesMax; chunks += 1) {
    const read = await reader.read();
    if (read.done) return text + decoder.decode();
    const chunk = read.value as Uint8Array;
    bytes += chunk.byteLength;
    if (bytes > bytesMax) break;
    text += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel();
  throw new RangeError(`${what}: a response passed its byte bound`);
}
