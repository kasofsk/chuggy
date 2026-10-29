/** The content address of a configuration revision, which a store keeps beside it and a reader compares by. */

import { createHash } from "node:crypto";

/** The content address of one canonical configuration revision. */
export function configurationRevisionDigest(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}
