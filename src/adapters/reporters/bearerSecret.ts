/**
 * The `BearerSecret` scheme: a reporter that can shape its request presents
 * its secret as a bearer and this tree's own report document as the body.
 *
 * THE SECRET IS READ FOR EACH REQUEST AND NEVER HELD. A file that arrives
 * after the process started verifies from then on, and one that is emptied or
 * removed stops, with no restart either way.
 *
 * A FILE HOLDING NO SECRET VERIFIES NOTHING. One the read every scheme shares
 * answers nothing for is a reporter nobody can be; so is one holding only
 * blanks, because no bearer is the empty string.
 *
 * WHAT IS COMPARED IS A DIGEST OF EACH, in time that depends on neither, so a
 * refusal says nothing of how much of a guess was right or how long the secret
 * is. A header arrives as its bytes, one to a character, so the file is read
 * the same way and the two are compared as the bytes they are.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { actionReportDocumentSchema } from "../../contract/actionReport.ts";
import type {
  ActionReportRequest,
  ActionReportSaid,
  ActionReporterSchemePort,
} from "../../interpreter/actionReport.ts";
import { asGitObjectId } from "../../interpreter/finalizer.ts";
import { reporterSecretBytes } from "./secretFile.ts";

/** The bearer a request presents, which is never empty, and nothing where it presents none or more than one. */
function bearerSecretPresented(
  headers: ActionReportRequest["headers"],
): string | undefined {
  const authorization = headers["authorization"];
  if (typeof authorization !== "string") return undefined;
  return /^Bearer ([^ ]+)$/iu.exec(authorization)?.[1];
}

/** The secret a file's bytes hold, without the blanks around it. */
function bearerSecretHeld(written: Buffer): string {
  return written.toString("latin1").trim();
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
      const written = await reporterSecretBytes(secretFile);
      if (written === undefined) return undefined;
      return timingSafeEqual(
        bearerSecretDigest(presented),
        bearerSecretDigest(bearerSecretHeld(written)),
      )
        ? bearerSecretDocumentSaid(request.body)
        : undefined;
    },
  };
}
