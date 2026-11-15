/**
 * The credentials a job is answered with, each from whichever issuer serves
 * its name.
 *
 * AN ISSUER ANSWERS ONE NAME FOR ONE REQUESTER: a bundle, an absence and why,
 * an outage, or that the name is not one it serves. A deployment's files are
 * one issuer; a credential chuggy mints per job is another, and arrives as one
 * more issuer in the list without a change to who asks.
 *
 * THE RESOLVER DECIDES WHAT NO ISSUER MAY. A name the configuration did not
 * list is left out, as it was never the job's to ask for; a listed name the
 * grant does not carry is absent as `NotGranted` before any issuer is asked;
 * and a name no issuer serves is absent as `NotHeld`. An outage anywhere is an
 * outage of the whole answer, because a job answered nothing for a credential
 * could not tell that from one never held.
 */

import type {
  WorkerHeldCredentialAbsent,
  WorkerHeldCredentialBundle,
} from "../contract/workerPlane.ts";
import type { TaskId, TicketId } from "../domain/ids.ts";
import type { Partition } from "./projectStore.ts";

/** Who a credential is issued to: the project it is for and the task in it that asks. */
export interface CredentialRequester {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly task: TaskId;
}

/** Why an issuer does not serve a name it knows, which never speaks for the grant or the worker's release. */
export type CredentialIssuerAbsence = Exclude<
  WorkerHeldCredentialAbsent["reason"],
  "NotGranted" | "WorkerTooOld"
>;

/** What one issuer answers for one name. */
export type CredentialIssued =
  | { readonly issued: "Bundle"; readonly bundle: WorkerHeldCredentialBundle }
  | { readonly issued: "Absent"; readonly reason: CredentialIssuerAbsence }
  | { readonly issued: "Unavailable" }
  | { readonly issued: "NotServed" };

/** Issues credentials by name, asked as each is needed. */
export interface CredentialIssuer {
  issue(
    requester: CredentialRequester,
    credential: string,
  ): Promise<CredentialIssued>;
}

/** What a job asks credentials for under: who it is, the names its configuration listed and its grant carries, and the names it asked. */
export interface CredentialsAsk {
  readonly requester: CredentialRequester;
  readonly listed: readonly string[];
  readonly granted: readonly string[];
  readonly asked: readonly string[];
}

/** What a job's ask came to: each name served or absent, or an outage. */
export type CredentialsResolved =
  | {
      readonly resolved: "Credentials";
      readonly credentials: readonly WorkerHeldCredentialBundle[];
      readonly absent: readonly WorkerHeldCredentialAbsent[];
    }
  | { readonly resolved: "Unavailable" };

/** Answers a job's ask from the issuers it is built over. */
export interface CredentialResolver {
  resolve(ask: CredentialsAsk): Promise<CredentialsResolved>;
}

/** What the first of `issuers` serving `credential` answers, an issuer that rejects being an outage. */
async function credentialResolverIssued(
  issuers: readonly CredentialIssuer[],
  requester: CredentialRequester,
  credential: string,
): Promise<CredentialIssued> {
  for (const issuer of issuers) {
    const issued = await issuer
      .issue(requester, credential)
      .catch((): CredentialIssued => ({ issued: "Unavailable" }));
    if (issued.issued !== "NotServed") return issued;
  }
  return { issued: "NotServed" };
}

/** Resolves each listed name asked, once each and in the order asked, through `issuers` in their order. */
export function credentialResolver(
  issuers: readonly CredentialIssuer[],
): CredentialResolver {
  return {
    resolve: async (ask) => {
      const listed = new Set(ask.listed);
      const granted = new Set(ask.granted);
      const credentials: WorkerHeldCredentialBundle[] = [];
      const absent: WorkerHeldCredentialAbsent[] = [];
      for (const credential of new Set(ask.asked)) {
        if (!listed.has(credential)) continue;
        if (!granted.has(credential)) {
          absent.push({ credential, reason: "NotGranted" });
          continue;
        }
        const issued = await credentialResolverIssued(
          issuers,
          ask.requester,
          credential,
        );
        switch (issued.issued) {
          case "Unavailable":
            return { resolved: "Unavailable" };
          case "Bundle":
            credentials.push(issued.bundle);
            break;
          case "Absent":
            absent.push({ credential, reason: issued.reason });
            break;
          case "NotServed":
            absent.push({ credential, reason: "NotHeld" });
            break;
        }
      }
      return { resolved: "Credentials", credentials, absent };
    },
  };
}
