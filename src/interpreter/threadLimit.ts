/**
 * How many threads one member may hold open in a project: a row of their own
 * there, read by the project's members and written by its administrators.
 *
 * ABSENT IS `threadsOpenDefault`, and the durable read is what answers it, so
 * this read and the door that opens a thread cannot disagree about a member
 * nobody set. A limit lowered below what a member holds closes nothing; it
 * refuses their next open until they are under it.
 *
 * THE MEMBER IS NAMED BY THEIR SUBJECT under the site's issuer, as a member's
 * runners are, so the principal a row is keyed by is derived here and never
 * taken from the wire.
 */

import { threadsOpenMax } from "../contract/http.ts";
import type { Authority } from "./operationInbox.ts";
import type { PlacementRead, PlacementWrite } from "./placementRoute.ts";
import { oidcPrincipal, type Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** One member's row and the door it is written through; `limit` answers the default where there is no row. */
export interface ThreadLimitStore {
  limit(partition: Partition, member: Principal): Promise<number>;
  write(
    partition: Partition,
    member: Principal,
    threadsMax: number,
    authority: Authority,
  ): Promise<PlacementWrite>;
}

/** One member's limit, and whether the reader may change it. */
export interface ThreadLimitView {
  readonly threadsMax: number;
  readonly administers: boolean;
}

export type ThreadLimitWritten =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Written" | "Unchanged";
      readonly view: ThreadLimitView;
    };

/** One member's limit in a project, read under `Read` and written by an administrator. */
export interface ThreadLimitAdministration {
  read(
    principal: Principal,
    partition: Partition,
    subject: string,
  ): Promise<PlacementRead<ThreadLimitView>>;
  write(
    principal: Principal,
    partition: Partition,
    subject: string,
    threadsMax: number,
  ): Promise<ThreadLimitWritten>;
}

/** A limit as the door accepts it, for every caller the wire's schema does not bound. */
export function checkedThreadsMax(threadsMax: number): number {
  if (
    !Number.isSafeInteger(threadsMax) ||
    threadsMax < 1 ||
    threadsMax > threadsOpenMax
  )
    throw new RangeError(
      `a member's thread limit is between 1 and ${String(threadsOpenMax)}`,
    );
  return threadsMax;
}

async function threadLimitRead(
  access: ProjectAccess,
  store: ThreadLimitStore,
  principal: Principal,
  partition: Partition,
  member: Principal,
): Promise<PlacementRead<ThreadLimitView>> {
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  const administers =
    (await access.authorize(principal, partition, "Administer")) !== undefined;
  return {
    result: "Found",
    view: { threadsMax: await store.limit(partition, member), administers },
  };
}

async function threadLimitWrite(
  access: ProjectAccess,
  store: ThreadLimitStore,
  principal: Principal,
  partition: Partition,
  member: Principal,
  threadsMax: number,
): Promise<ThreadLimitWritten> {
  const checked = checkedThreadsMax(threadsMax);
  const authority = await access.authorize(principal, partition, "Administer");
  if (authority === undefined) return { result: "NotFound" };
  const written = await store.write(partition, member, checked, authority);
  if (written === "NotFound") return { result: "NotFound" };
  return {
    result: written,
    view: {
      threadsMax: await store.limit(partition, member),
      administers: true,
    },
  };
}

export function threadLimitAdministration(
  access: ProjectAccess,
  store: ThreadLimitStore,
  issuer: string,
): ThreadLimitAdministration {
  return {
    read: (principal, partition, subject) =>
      threadLimitRead(
        access,
        store,
        principal,
        partition,
        oidcPrincipal(issuer, subject),
      ),
    write: (principal, partition, subject, threadsMax) =>
      threadLimitWrite(
        access,
        store,
        principal,
        partition,
        oidcPrincipal(issuer, subject),
        threadsMax,
      ),
  };
}
