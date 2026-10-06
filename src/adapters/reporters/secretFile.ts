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
 * another's is a key. An empty file is no bytes, which is its scheme's to
 * weigh.
 *
 * A FILE IS ANSWERED WHOLE OR AS NOTHING. One read may bring less than a file
 * holds, so a file is read until a read finds its end, and one holding more
 * than the bound is nothing rather than its beginning however its reads came
 * back.
 */

import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

/** The most one secret file may hold. */
export const reporterSecretBytesMax = 4_096;

/** An open file as it is read: up to `length` bytes from `position` in it, into `buffer` from `offset`, answering how many it brought, which is none only at its end. */
export interface ReporterSecretReadable {
  readonly read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ readonly bytesRead: number }>;
}

/** Everything a file's reads bring up to its end, or nothing where they bring more than the bound. */
export async function reporterSecretBytesRead(
  file: ReporterSecretReadable,
): Promise<Buffer | undefined> {
  const buffer = Buffer.alloc(reporterSecretBytesMax + 1);
  let held = 0;
  while (held < buffer.length) {
    const { bytesRead } = await file.read(
      buffer,
      held,
      buffer.length - held,
      held,
    );
    if (bytesRead <= 0) return buffer.subarray(0, held);
    held += bytesRead;
  }
  return undefined;
}

/** The bytes a regular file holds, or nothing. */
export async function reporterSecretBytes(
  path: string,
): Promise<Buffer | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!(await handle.stat()).isFile()) return undefined;
    return await reporterSecretBytesRead(handle);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
