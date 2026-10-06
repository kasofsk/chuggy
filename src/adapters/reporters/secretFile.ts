/**
 * What the file a roster names for a reporter's secret holds, for every scheme
 * that proves a reporter by one.
 *
 * ONLY A REGULAR FILE IS READ, AND NOTHING IS WAITED FOR. The path is opened
 * without blocking and the open file is asked what it is, so a pipe nobody
 * writes to, a socket, a device and a directory are each nothing, at once. A
 * link is followed first, which is how a mounted secret is swapped.
 *
 * THE BYTES ARE ANSWERED AS WRITTEN, TO A BOUND. Nothing is trimmed and
 * nothing decoded, because one scheme's secret is a line of text and
 * another's is a key. A file past the bound is nothing rather than its
 * beginning, and an empty one is no bytes, which is its scheme's to weigh.
 */

import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

/** The most one secret file may hold. */
export const reporterSecretBytesMax = 4_096;

/** The bytes a regular file holds, read once into a buffer a byte wider than the bound, or nothing. */
export async function reporterSecretBytes(
  path: string,
): Promise<Buffer | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!(await handle.stat()).isFile()) return undefined;
    const buffer = Buffer.alloc(reporterSecretBytesMax + 1);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead > reporterSecretBytesMax) return undefined;
    return buffer.subarray(0, read.bytesRead);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
