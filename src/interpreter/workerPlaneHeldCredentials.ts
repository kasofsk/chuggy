/**
 * The credentials a deployment holds as files, and which of them one attempt
 * is answered with.
 *
 * A HELD CREDENTIAL IS CONFIGURATION. A deployment names each one in a roster:
 * the name a grant gives it, the project it is held for, the variable a job's
 * environment names its file by, and the file it is in. One credential is held
 * at most once for a project, and several entries may name one file.
 *
 * AN ATTEMPT IS ANSWERED ONLY WHAT IT ASKED, WAS GRANTED AND IS HELD FOR. The
 * pod contributes only the names it asks for. The grant is the one the
 * scheduler recorded for the attempt and the project is the attempt's own,
 * both read from what its bearer finds, so no pod widens either by what it
 * sends.
 *
 * A FILE IS READ ON EVERY REQUEST, so a rotated secret is served without a
 * restart, and one that cannot be read is an outage rather than an absence:
 * the deployment said it holds the credential, and a pod answered nothing
 * could not tell that from a credential never held.
 */

import { z } from "zod";

import { identitySchema } from "../contract/http.ts";
import { isHeldCredentialVariable } from "../contract/workerEnvironment.ts";
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

/** One credential as an attempt is answered it. */
export interface HeldCredentialServed {
  readonly credential: string;
  readonly variable: string;
  readonly secret: string;
  /** Absent for a credential held as a file, which does not expire. */
  readonly expiresAtMs?: number;
}

export type HeldCredentialRosterRead =
  | { readonly read: "Roster"; readonly held: readonly HeldCredential[] }
  | { readonly read: "Refused"; readonly why: string };

/** What one attempt's ask came to, an unreadable file kept apart from a credential not served. */
export type HeldCredentialsAnswered =
  | {
      readonly answered: "Credentials";
      readonly credentials: readonly HeldCredentialServed[];
    }
  | { readonly answered: "Unavailable" };

/** What the plane answers an attempt from: the project the attempt is in, the names its recorded grant gives, and the names it asked for. */
export interface HeldCredentialsAsk {
  readonly partition: Partition;
  readonly granted: readonly string[];
  readonly asked: readonly string[];
}

/** Answers an attempt's ask with the credentials it is served, read as it asks. */
export interface WorkerPlaneHeldCredentials {
  served(ask: HeldCredentialsAsk): Promise<HeldCredentialsAnswered>;
}

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

/** Each held credential an attempt asked for, was granted and is held for in its project, once each and in the order it asked. */
export function heldCredentialsSelected(
  held: readonly HeldCredential[],
  ask: HeldCredentialsAsk,
): readonly HeldCredential[] {
  const keyed = new Map(
    held.map((entry) => [
      heldCredentialKey(entry.credential, entry.partition),
      entry,
    ]),
  );
  const granted = new Set(ask.granted);
  return [...new Set(ask.asked)].flatMap((credential) => {
    const entry = keyed.get(heldCredentialKey(credential, ask.partition));
    return entry === undefined || !granted.has(credential) ? [] : [entry];
  });
}

/** The secret a file's text is, its surrounding whitespace trimmed, or nothing where it holds none. */
export function heldCredentialSecret(
  text: string | undefined,
): string | undefined {
  const secret = text?.trim();
  return secret === undefined || secret.length === 0 ? undefined : secret;
}

/** Answers an attempt from `held`, reading each selected credential's file through `read` as it is asked. */
export function workerPlaneHeldCredentials(
  held: readonly HeldCredential[],
  read: HeldCredentialFileRead,
): WorkerPlaneHeldCredentials {
  return {
    served: async (ask) => {
      const credentials: HeldCredentialServed[] = [];
      for (const entry of heldCredentialsSelected(held, ask)) {
        const secret = heldCredentialSecret(
          await read(entry.file).catch(() => undefined),
        );
        if (secret === undefined) return { answered: "Unavailable" };
        credentials.push({
          credential: entry.credential,
          variable: entry.variable,
          secret,
        });
      }
      return { answered: "Credentials", credentials };
    },
  };
}
