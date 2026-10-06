/**
 * The `FluxSignature` scheme: Flux's notification controller posts an event as
 * it writes one, signed with a key this deployment also holds, and this reads
 * the event as what an action did.
 *
 * VERIFIED IS A SIGNATURE AND A TIMESTAMP NEAR THIS CLOCK. `X-Signature` is
 * `sha256=` and the hex of the HMAC-SHA256 of the body's bytes as they
 * arrived, and the event's own `timestamp` stands within the tolerance of
 * this server's clock, on either side of it. A request short of either is
 * answered as one signed with another key is. One sent again inside the
 * tolerance verifies again, so inside it the order reports arrive in is the
 * order they are held in.
 *
 * THE BYTES SIGNED ARE THE BYTES SENT. A body read and written back is another
 * body: Go writes `<`, `>` and `&` as escapes and `JSON.stringify` writes them
 * as themselves. So the digest is taken before anything reads the body.
 *
 * THE KEY IS THE FILE'S BYTES BETWEEN THE WHITE SPACE AT THEIR TWO ENDS, which
 * is what Flux keys its digest with: it takes from its secret what Go's
 * `strings.TrimSpace` takes. A file holding nothing else verifies nobody,
 * because a digest keyed with nothing is anybody's to take.
 *
 * ONLY WHAT A RECONCILIATION CAME TO IS A REPORT. A Kustomization that
 * reconciled succeeded, a Kustomization's error failed, and every other event
 * is verified and ignored. The commit is the hex `metadata.originRevision`
 * ends in after `sha1:`, where that begins the revision or follows the `@`
 * after the pointer it names, and is looked for nowhere else, because a
 * message quotes the revisions of other things; an outcome with no such commit
 * is refused.
 *
 * NOTHING IS HANDED ON THAT A ROW CANNOT HOLD. A detail is cut to the bound a
 * row holds, counted as the relation counts it, with what no text column holds
 * replaced; a link the one link rule refuses is left out and its report kept.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  actionReportDetailCharsMax,
  actionReportDocumentSchema,
  isActionReportLink,
} from "../../contract/actionReport.ts";
import type {
  ActionReportOutcome,
  ActionReportRequest,
  ActionReportSaid,
  ActionReporterSchemePort,
} from "../../interpreter/actionReport.ts";
import { asGitObjectId } from "../../interpreter/finalizer.ts";
import { reporterSecretBytes } from "./secretFile.ts";

/** How far an event's timestamp may stand from this server's clock, on either side, and its request still verify. */
export const fluxSignatureToleranceSecs = 300;

/** A signature as Flux writes one: the scheme's name and a digest in lower-case hex. */
const fluxSignatureWritten = /^sha256=([0-9a-f]{64})$/u;

/** The commit a revision names: the hex it ends in after `sha1:`, which begins it or follows the `@` after a pointer's name. */
const fluxSignatureRevisionCommit = /(?:^|@)sha1:([0-9a-f]{40})$/u;

/** Each character Go's `unicode.IsSpace` holds, which is each Unicode calls white space, as the bytes a file holds it in. */
const fluxSignatureBlanks: readonly Buffer[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
].map((point) => Buffer.from(String.fromCodePoint(point), "utf8"));

/** The digest a request presents, and nothing where it presents none, more than one or one written any other way. */
function fluxSignaturePresented(
  headers: ActionReportRequest["headers"],
): Buffer | undefined {
  const signature = headers["x-signature"];
  if (typeof signature !== "string") return undefined;
  const hex = fluxSignatureWritten.exec(signature)?.[1];
  return hex === undefined ? undefined : Buffer.from(hex, "hex");
}

/** The white space a key's bytes begin with, or end in, as its bytes, and nothing where they do neither. */
function fluxSignatureBlank(key: Buffer, ending: boolean): Buffer | undefined {
  return fluxSignatureBlanks.find((blank) =>
    (ending
      ? key.subarray(-blank.length)
      : key.subarray(0, blank.length)
    ).equals(blank),
  );
}

/** The key a file's bytes hold: what stands between the white space at their two ends, read as bytes. */
function fluxSignatureKey(written: Buffer): Buffer {
  let key = written;
  for (
    let blank = fluxSignatureBlank(key, false);
    blank !== undefined;
    blank = fluxSignatureBlank(key, false)
  )
    key = key.subarray(blank.length);
  for (
    let blank = fluxSignatureBlank(key, true);
    blank !== undefined;
    blank = fluxSignatureBlank(key, true)
  )
    key = key.subarray(0, key.length - blank.length);
  return key;
}

/** A field an event may leave out, read as left out where it is anything but text. */
const fluxSignatureText = z.string().optional().catch(undefined);

/** What of an event is read. Its `timestamp` is an instant by the rule a report document's is, and every other field is read where it is there. */
const fluxSignatureEventSchema = z.object({
  timestamp: actionReportDocumentSchema.shape.observedAt.unwrap(),
  severity: fluxSignatureText,
  reason: fluxSignatureText,
  message: fluxSignatureText,
  involvedObject: z
    .object({ kind: fluxSignatureText })
    .optional()
    .catch(undefined),
  metadata: z
    .object({
      revision: fluxSignatureText,
      originRevision: fluxSignatureText,
      link: fluxSignatureText,
    })
    .optional()
    .catch(undefined),
});
type FluxSignatureEvent = z.infer<typeof fluxSignatureEventSchema>;

/** The event a body holds, or nothing where it holds no event stating when it happened. */
function fluxSignatureEvent(body: Uint8Array): FluxSignatureEvent | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
  return fluxSignatureEventSchema.safeParse(decoded).data;
}

/** What an event says its action came to and what describes that, or nothing where it says neither outcome. */
function fluxSignatureOutcome(
  event: FluxSignatureEvent,
):
  | { readonly outcome: ActionReportOutcome; readonly described?: string }
  | undefined {
  if (event.involvedObject?.kind !== "Kustomization") return undefined;
  const { severity, reason, message, metadata } = event;
  if (severity === "error")
    return {
      outcome: "Failed",
      ...(message === undefined ? {} : { described: message }),
    };
  if (severity !== "info" || reason !== "ReconciliationSucceeded")
    return undefined;
  const revision = metadata?.revision;
  return {
    outcome: "Succeeded",
    ...(revision === undefined ? {} : { described: revision }),
  };
}

/** What stands in a detail where no text column holds what was written: the character a decoder writes for what it cannot read. */
const fluxSignatureUnheld = String.fromCodePoint(0xfffd);

/** Text as a row holds a detail: a NUL and an unpaired surrogate each replaced, and what is past the bound cut off. */
function fluxSignatureDetail(described: string): string {
  return [...described.toWellFormed().replaceAll("\u0000", fluxSignatureUnheld)]
    .slice(0, actionReportDetailCharsMax)
    .join("");
}

/** What a verified event says, `observedAtMs` being its own timestamp. */
function fluxSignatureSaid(
  event: FluxSignatureEvent,
  observedAtMs: number,
): ActionReportSaid {
  const found = fluxSignatureOutcome(event);
  if (found === undefined) return { said: "Ignored" };
  const commit = fluxSignatureRevisionCommit.exec(
    event.metadata?.originRevision ?? "",
  )?.[1];
  if (commit === undefined) return { said: "Refused" };
  const detail = fluxSignatureDetail(found.described ?? "");
  const link = event.metadata?.link;
  return {
    said: "Report",
    report: {
      commit: asGitObjectId(commit),
      outcome: found.outcome,
      observedAtMs,
      ...(detail === "" ? {} : { detail }),
      ...(link === undefined || !isActionReportLink(link) ? {} : { link }),
    },
  };
}

/** The scheme over a clock, which answers this server's time in milliseconds. */
export function fluxSignatureReporters(
  nowMs: () => number,
): ActionReporterSchemePort {
  return {
    said: async (secretFile, request) => {
      const presented = fluxSignaturePresented(request.headers);
      if (presented === undefined) return undefined;
      const written = await reporterSecretBytes(secretFile);
      if (written === undefined) return undefined;
      const key = fluxSignatureKey(written);
      if (key.length === 0) return undefined;
      const signed = createHmac("sha256", key).update(request.body).digest();
      if (!timingSafeEqual(signed, presented)) return undefined;
      const event = fluxSignatureEvent(request.body);
      if (event === undefined) return undefined;
      const observedAtMs = Date.parse(event.timestamp);
      const apartMs = Math.abs(nowMs() - observedAtMs);
      if (!(apartMs <= fluxSignatureToleranceSecs * 1_000)) return undefined;
      return fluxSignatureSaid(event, observedAtMs);
    },
  };
}
