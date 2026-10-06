/**
 * The `BearerSecret` scheme: a reporter that can shape its request presents
 * its secret as a bearer and this tree's own report document as the body.
 *
 * THE SECRET IS READ FOR EACH REQUEST AND NEVER HELD. A file that arrives
 * after the process started verifies from then on, and one that is emptied or
 * removed stops, with no restart either way.
 *
 * A FILE HOLDING NO SECRET VERIFIES NOTHING. One that is absent, cannot be
 * read or holds more than a secret may be is a reporter nobody can be; so is
 * one holding only blanks, because no bearer is the empty string.
 *
 * WHAT IS COMPARED IS A DIGEST OF EACH, in time that depends on neither, so a
 * refusal says nothing of how much of a guess was right or how long the secret
 * is. A header arrives as its bytes, one to a character, so the file is read
 * the same way and the two are compared as the bytes they are.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";

import { actionReportDocumentSchema } from "../../contract/actionReport.ts";
import type {
  ActionReportRequest,
  ActionReportSaid,
  ActionReporterSchemePort,
} from "../../interpreter/actionReport.ts";
import { asGitObjectId } from "../../interpreter/finalizer.ts";

/** The most one secret file may hold. */
export const bearerSecretBytesMax = 4_096;

/** The bearer a request presents, which is never empty, and nothing where it presents none or more than one. */
function bearerSecretPresented(
  headers: ActionReportRequest["headers"],
): string | undefined {
  const authorization = headers["authorization"];
  if (typeof authorization !== "string") return undefined;
  return /^Bearer ([^ ]+)$/iu.exec(authorization)?.[1];
}

/** The secret one file holds without the blanks around it, read once into a buffer a byte wider than a secret may be. */
async function bearerSecretHeld(path: string): Promise<string | undefined> {
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    const buffer = Buffer.alloc(bearerSecretBytesMax + 1);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead > bearerSecretBytesMax) return undefined;
    return buffer.subarray(0, read.bytesRead).toString("latin1").trim();
  } catch {
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function bearerSecretDigest(secret: string): Buffer {
  return createHash("sha256").update(secret, "latin1").digest();
}

/** What a body holding this tree's own report document says, read from its bytes. */
function bearerSecretDocumentSaid(body: Uint8Array): ActionReportSaid {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    return { said: "Refused" };
  }
  const parsed = actionReportDocumentSchema.safeParse(decoded);
  if (!parsed.success) return { said: "Refused" };
  const { commit, outcome, observedAt, detail, link } = parsed.data;
  return {
    said: "Report",
    report: {
      commit: asGitObjectId(commit),
      outcome,
      ...(observedAt === undefined
        ? {}
        : { observedAtMs: Date.parse(observedAt) }),
      ...(detail === undefined ? {} : { detail }),
      ...(link === undefined ? {} : { link }),
    },
  };
}

export function bearerSecretReporters(): ActionReporterSchemePort {
  return {
    said: async (secretFile, request) => {
      const presented = bearerSecretPresented(request.headers);
      if (presented === undefined) return undefined;
      const held = await bearerSecretHeld(secretFile);
      if (held === undefined) return undefined;
      return timingSafeEqual(
        bearerSecretDigest(presented),
        bearerSecretDigest(held),
      )
        ? bearerSecretDocumentSaid(request.body)
        : undefined;
    },
  };
}
