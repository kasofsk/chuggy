/**
 * What every case in this directory needs of a real Ory Keto: the ports over
 * its read API, the writer over its write API, and objects no other case is
 * using.
 *
 * THERE IS NO FAKE HERE AND THAT IS THE POINT. The model decides what `read`
 * follows from, the server decides what a missing relation answers, and both
 * are claims about the authority rather than about the adapter. A double would
 * answer them by agreeing with the encoding this tree already believes.
 *
 * OBJECTS ARE UNIQUE PER CASE rather than the server being fresh per case. The
 * gate's container holds its tuples in memory and is reused between runs, so a
 * case that assumed an empty server would pass once and then answer for
 * whatever the run before it wrote.
 *
 * THE SITE IS THE EXCEPTION, because it is one object and every case shares it.
 * No case assumes it holds nothing or asserts that it did not change; its
 * default is written only where it is missing, and a case that makes someone
 * its administrator uses a principal of its own and removes the grant itself.
 */

import { randomUUID } from "node:crypto";

import {
  ketoProjectAccess,
  ketoReadiness,
  ketoTenantClaims,
} from "../../src/adapters/keto/projectAccess.ts";
import { ketoProjectGrants } from "../../src/adapters/keto/projectGrants.ts";
import { ketoAccessTuples } from "../../src/adapters/keto/accessTuples.ts";
import type { AccessTupleReader } from "../../src/interpreter/accessPlane.ts";
import {
  checkedProjectAccessSettings,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import type { TenantClaims } from "../../src/interpreter/projectCreation.ts";
import {
  checkedProjectGrantSettings,
  siteAuthorityDefaults,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "../../src/interpreter/projectGrant.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

export const ketoHarnessReadUrlVar = "CHUG_KETO_READ_URL";
export const ketoHarnessWriteUrlVar = "CHUG_KETO_WRITE_URL";

/** The issuer every principal in this directory is derived from. */
export const ketoHarnessIssuer = "https://accounts.keto.test";

/** One of the two URLs, or a failure saying which gate supplies it. */
function ketoHarnessUrl(variable: string): string {
  const url = process.env[variable];
  if (url === undefined || url === "")
    throw new Error(
      `${variable} is unset; this suite is run by .chug/tasks/check-keto.sh, which starts an authority and sets it`,
    );
  return url;
}

export function ketoHarnessReadUrl(): string {
  return ketoHarnessUrl(ketoHarnessReadUrlVar);
}

export function ketoHarnessWriteUrl(): string {
  return ketoHarnessUrl(ketoHarnessWriteUrlVar);
}

/** The port as a deployment composes it, over the gate's own authority. */
export function ketoHarnessAccess(): ProjectAccess {
  return ketoHarnessAccessAt(ketoHarnessReadUrl());
}

/** The same port over some other read URL, for the case about one that is not there. */
export function ketoHarnessAccessAt(readUrl: string): ProjectAccess {
  return ketoProjectAccess(
    checkedProjectAccessSettings({ readUrl, requestTimeoutMs: 2_000 }),
  );
}

/** The tenant claims a creation asks, over the same read API. */
export function ketoHarnessClaims(): TenantClaims {
  return ketoTenantClaims(
    checkedProjectAccessSettings({
      readUrl: ketoHarnessReadUrl(),
      requestTimeoutMs: 2_000,
    }),
  );
}

/** The listing the access plane reads holders with, over the same read API. */
export function ketoHarnessTuples(): AccessTupleReader {
  return ketoAccessTuples(
    checkedProjectAccessSettings({
      readUrl: ketoHarnessReadUrl(),
      requestTimeoutMs: 2_000,
    }),
  );
}

/** Readiness as a root composes it, over a read URL a case chooses. */
export function ketoHarnessReadinessAt(readUrl: string): {
  ready(): Promise<boolean>;
} {
  return ketoReadiness(
    checkedProjectAccessSettings({ readUrl, requestTimeoutMs: 2_000 }),
  );
}

/** The writer as the provisioning command composes it, over the same authority. */
export function ketoHarnessGrants(): ProjectGrantWriter {
  return ketoProjectGrants(
    checkedProjectGrantSettings({ writeUrl: ketoHarnessWriteUrl() }),
  );
}

/**
 * A tenant and project pair no other case addresses. Both carry a `/` because
 * the object encoding has to be injective over text that may contain any
 * separator, and a fixture without one would never exercise that.
 */
export function ketoHarnessPartition(label: string): Partition {
  const suffix = randomUUID();
  return {
    tenant: asTenantId(`keto/${label}-${suffix}`),
    project: asProjectId(`web/${label}-${suffix}`),
  };
}

/**
 * The project kinds a person's role gives. The roster's other kinds are asked
 * of relations saying who may grant, which no role is.
 */
export const ketoHarnessRoleKinds: readonly ProjectAccessKind[] = [
  "Read",
  "Mutate",
  "DispatchTicket",
  "ProposeDispatch",
  "ManageProjectSelector",
  "Execute",
  "Administer",
];

/** Whether the authority already holds one tuple, asked by the listing that names it whole. */
async function ketoHarnessHeld(grant: ProjectGrant): Promise<boolean> {
  const url = new URL("relation-tuples", ketoHarnessReadUrl());
  url.searchParams.set("namespace", grant.namespace);
  url.searchParams.set("object", grant.object);
  url.searchParams.set("relation", grant.relation);
  if (grant.holder.subject === "Principal")
    url.searchParams.set("subject_id", grant.holder.principal);
  else {
    url.searchParams.set("subject_set.namespace", grant.holder.namespace);
    url.searchParams.set("subject_set.object", grant.holder.object);
    url.searchParams.set(
      "subject_set.relation",
      grant.holder.subject === "Holders" ? grant.holder.relation : "",
    );
  }
  url.searchParams.set("page_size", "1");
  const answered = await fetch(url);
  if (!answered.ok)
    throw new Error(
      `the listing of ${url.toString()} answered ${String(answered.status)}`,
    );
  const listed = (await answered.json()) as { relation_tuples: unknown[] };
  return listed.relation_tuples.length > 0;
}

/** The site's default tuples, written where the shared site does not hold them already. */
export async function ketoHarnessSiteDefaults(): Promise<void> {
  const grants = ketoHarnessGrants();
  for (const grant of siteAuthorityDefaults())
    if (!(await ketoHarnessHeld(grant))) await grants.write(grant);
}
