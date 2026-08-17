/**
 * The Secret Manager source: one access-secret-version call over `fetch`,
 * mirroring the Jobs client's discipline — no client library, and a bearer
 * re-read from a configured token file on every call because the platform
 * rotates what it mounts there. The exchange that PRODUCES that bearer — the
 * projected workload-identity token traded through STS — is deployment
 * machinery outside this process, which is exactly the depth this source is
 * tested to: it performs no exchange and fakes none.
 *
 * A REFERENCE IS A FULL VERSION NAME, projects through versions, and anything
 * else is refused before a request is formed: the reference becomes the URL
 * path, and a reference that is not a version name is a request this source
 * never meant to make.
 *
 * THE PAYLOAD IS DECODED AND NOTHING MORE. Secret Manager answers the exact
 * bytes that were stored, base64-wrapped for transit, so nothing is trimmed
 * here — a stored newline is the operator's to have not stored.
 */

import { readFileSync } from "node:fs";

import * as z from "zod";

import type { SecretSource } from "../interpreter/secretSource.ts";

/** Where and as whom the source calls: the API base, and the file the ready bearer is re-read from. */
export interface SecretGcpOptions {
  readonly base: string;
  readonly bearerTokenPath: string;
}

/** The one reference shape an access call may name. */
const secretGcpReference = /^projects\/[^/]+\/secrets\/[^/]+\/versions\/[^/]+$/;

const secretGcpAnswerSchema = z.object({
  payload: z.object({ data: z.string() }),
});

/** The source over its options; each call re-reads the bearer and accesses one version. */
export function secretGcpSource(options: SecretGcpOptions): SecretSource {
  return async (reference) => {
    if (!secretGcpReference.test(reference)) {
      throw new Error(
        `secretGcpSource: ${reference} is not a secret version name`,
      );
    }
    const token = readFileSync(options.bearerTokenPath, "utf8").trim();
    const response = await fetch(`${options.base}/v1/${reference}:access`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `secretGcpSource: ${reference} answered ${String(response.status)}`,
      );
    }
    const parsed = secretGcpAnswerSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(
        `secretGcpSource: ${reference} answered no payload this source reads`,
      );
    }
    return Buffer.from(parsed.data.payload.data, "base64").toString("utf8");
  };
}
