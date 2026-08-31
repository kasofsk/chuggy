/**
 * Reads a response body under a byte bound and a read bound, refusing it the
 * moment either is passed.
 *
 * THE BOUND IS ON THE STREAM, AND `content-length` ONLY SHORTENS IT. A declared
 * length refuses an oversized body before any of it is read, but it cannot be
 * the bound: a proxy that recompresses a response answers with no length at
 * all, which is what a token endpoint behind one does.
 *
 * THE READ BOUND IS WHAT ENDS AN EMPTY STREAM. A body that yields empty chunks
 * for ever passes any byte bound, so a reader with only that one never returns.
 * It counts the chunks the body yields and not the reads made of it, so a body
 * arriving in exactly `readsMax` chunks is read rather than refused; the read
 * that reports the end is one more than that and is never counted.
 */

export async function boundedResponseBytes(
  response: Response,
  bytesMax: number,
  readsMax: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > bytesMax) {
    await response.body?.cancel();
    throw new RangeError("HTTP response exceeds its byte bound");
  }
  if (response.body === null) return new Uint8Array();
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let reads = 0;
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      reads += 1;
      if (reads > readsMax) {
        await reader.cancel();
        throw new RangeError("HTTP response exceeds its read bound");
      }
      length += read.value.byteLength;
      if (length > bytesMax) {
        await reader.cancel();
        throw new RangeError("HTTP response exceeds its byte bound");
      }
      chunks.push(read.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
