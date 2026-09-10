/**
 * What every case in this directory needs of a real Ory Keto: the port over
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
 */

import { randomUUID } from "node:crypto";

import { ketoProjectAccess } from "../../src/adapters/keto/projectAccess.ts";
import { ketoProjectGrants } from "../../src/adapters/keto/projectGrants.ts";
import {
  checkedProjectAccessSettings,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  checkedProjectGrantSettings,
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
