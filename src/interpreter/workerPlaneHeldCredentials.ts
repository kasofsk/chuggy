/**
 * The credentials a deployment holds as files, and the issuer that serves
 * them.
 *
 * A HELD CREDENTIAL IS CONFIGURATION. A deployment names each one in a roster:
 * the name a grant gives it, the project it is held for, the variable a job's
 * environment names its file by, and the file it is in. One credential is held
 * at most once for a project, and several entries may name one file. No name
 * is in the prefix chuggy issues its own under, so no file stands in for one.
 *
 * A CREDENTIAL IS SERVED ONLY FOR THE PROJECT IT IS HELD FOR. The project is
 * the requester's own, read from what its bearer finds, so no pod widens it by
 * what it sends; which names it may ask for is the resolver's to decide.
 *
 * A FILE IS READ ON EVERY REQUEST, so a rotated secret is served without a
 * restart, and one that cannot be read is an outage rather than an absence:
 * the deployment said it holds the credential, and a pod answered nothing
 * could not tell that from a credential never held.
 */

import { z } from "zod";

import { identitySchema, textCodePointsCount } from "../contract/http.ts";
import { heldCredentialSecretCharsMax } from "../contract/workerPlane.ts";
import {
  isHeldCredentialVariable,
  isIssuedCredential,
  issuedCredentialPrefix,
} from "../contract/workerEnvironment.ts";
import type { CredentialIssuer } from "./credentialIssuers.ts";
import { asProjectId, asTenantId, type Partition } from "./projectStore.ts";

/** The most credentials one deployment holds. */
export const heldCredentialsMax = 256;

/** The longest path a held credential's file is named by. */
export const heldCredentialFileCharsMax = 4_096;

/** One credential as a deployment holds it. */
export interface HeldCredential {
  readonly credential: string;
  readonly partition: Partition;
  readonly variable: string;
  readonly file: string;
}

export type HeldCredentialRosterRead =
  | { readonly read: "Roster"; readonly held: readonly HeldCredential[] }
  | { readonly read: "Refused"; readonly why: string };

/** The text a file holds, or nothing where it is not a readable regular file within its bound. */
export type HeldCredentialFileRead = (
  file: string,
) => Promise<string | undefined>;

const heldCredentialRosterSchema = z
  .array(
    z.strictObject({
      credential: identitySchema,
      tenant: identitySchema,
      project: identitySchema,
      variable: identitySchema,
      file: z.string().min(1).max(heldCredentialFileCharsMax),
    }),
  )
  .max(heldCredentialsMax);

function heldCredentialRosterRefused(why: string): HeldCredentialRosterRead {
  return { read: "Refused", why };
}

/** The key one credential is held under for one project. */
function heldCredentialKey(credential: string, partition: Partition): string {
  return JSON.stringify([partition.tenant, partition.project, credential]);
}

/** Reads a deployment's roster without reading its files. */
export function heldCredentialRoster(
  encoded: string,
): HeldCredentialRosterRead {
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return heldCredentialRosterRefused("is not JSON");
  }
  const parsed = heldCredentialRosterSchema.safeParse(decoded);
  if (!parsed.success)
    return heldCredentialRosterRefused(
      `is not a roster of held credentials at ${JSON.stringify(parsed.error.issues[0]?.path ?? [])}`,
    );
  const keys = new Set<string>();
  const held: HeldCredential[] = [];
  for (const entry of parsed.data) {
    if (isIssuedCredential(entry.credential))
      return heldCredentialRosterRefused(
        `names ${entry.credential}, which is in the prefix ${issuedCredentialPrefix} reserved to the credentials chuggy issues`,
      );
    if (!isHeldCredentialVariable(entry.variable))
      return heldCredentialRosterRefused(
        `names ${entry.variable}, which is not a variable ending _FILE outside CHUG_, CLAUDE_ and GIT_`,
      );
    const partition = {
      tenant: asTenantId(entry.tenant),
      project: asProjectId(entry.project),
    };
    const key = heldCredentialKey(entry.credential, partition);
    if (keys.has(key))
      return heldCredentialRosterRefused(
        `holds ${entry.credential} for ${entry.tenant}/${entry.project} twice`,
      );
    keys.add(key);
    held.push({
      credential: entry.credential,
      partition,
      variable: entry.variable,
      file: entry.file,
    });
  }
  return { read: "Roster", held };
}

/** The secret a file's text is, its surrounding whitespace trimmed, or nothing where it holds none or more than the contract carries. */
export function heldCredentialSecret(
  text: string | undefined,
): string | undefined {
  const secret = text?.trim();
  return secret === undefined ||
    secret.length === 0 ||
    textCodePointsCount(secret) > heldCredentialSecretCharsMax
    ? undefined
    : secret;
}

/** The secret `entry`'s file holds, read through `read` now, or nothing where it holds none. */
async function heldCredentialFileSecret(
  entry: HeldCredential,
  read: HeldCredentialFileRead,
): Promise<string | undefined> {
  return heldCredentialSecret(await read(entry.file).catch(() => undefined));
}

/** The name a held credential's file is written under in the bundle it is served as. */
export const heldCredentialBundleFile = "secret";

/**
 * Issues each credential `held` holds for the requester's project as a bundle
 * of its one file, read through `read` as it is asked, the variable naming
 * that file's path; a name not held for the project is not this issuer's.
 */
export function heldCredentialIssuer(
  held: readonly HeldCredential[],
  read: HeldCredentialFileRead,
): CredentialIssuer {
  const keyed = new Map(
    held.map((entry) => [
      heldCredentialKey(entry.credential, entry.partition),
      entry,
    ]),
  );
  return {
    issue: async (requester, credential) => {
      const entry = keyed.get(
        heldCredentialKey(credential, requester.partition),
      );
      if (entry === undefined) return { issued: "NotServed" };
      const secret = await heldCredentialFileSecret(entry, read);
      if (secret === undefined) return { issued: "Unavailable" };
      return {
        issued: "Bundle",
        bundle: {
          credential,
          files: [
            {
              file: heldCredentialBundleFile,
              content: { kind: "Secret", secret },
            },
          ],
          variables: [
            {
              kind: "Path",
              variable: entry.variable,
              file: heldCredentialBundleFile,
            },
          ],
        },
      };
    },
  };
}
