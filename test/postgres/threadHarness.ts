/**
 * What every thread case needs of a real PostgreSQL: the lead rig 059's suites
 * already stand on, the two thread stores over the roles 062 grants, and a
 * member the project admits for a thread to act under.
 *
 * EACH DOOR STANDS ON THE ROLE IT IS GRANTED TO. The five API-side doors run as
 * `chuggy_api` and the three wake-side ones as `chuggy_selector_service`,
 * because a suite that drove either as the migration owner would be green over
 * a grant that had never been made — which is a defect only the deployed
 * credential meets.
 *
 * A MEMBER IS AN ISSUER, A SUBJECT AND A PRINCIPAL DERIVED FROM BOTH. The
 * authority `draft_revision` is keyed by is derived from that principal and
 * from nothing else, and the wake join matches the two, so a fixture that made
 * up either half independently could pass a join that never matches in a
 * deployment.
 */

import { randomUUID } from "node:crypto";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { postgresAgenticRefusalReads } from "../../src/adapters/postgres/agenticRefusal.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { postgresSessionStoreRows } from "../../src/adapters/postgres/sessionStoreReads.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import { threadSessionMint } from "../../src/adapters/crypto/threadSessionMint.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import { postgresThreadSeeding } from "../../src/adapters/postgres/thread.ts";
import {
  postgresThreadWakes,
  postgresThreads,
} from "../../src/adapters/postgres/thread.ts";
import { sessionStoreStreamsAnswered } from "../../src/contract/http.ts";
import type { Authority } from "../../src/interpreter/operationInbox.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type {
  ThreadSeedingRead,
  ThreadSessionMint,
  ThreadStore,
} from "../../src/interpreter/threadRead.ts";
import type { ThreadWakeStore } from "../../src/interpreter/threadWake.ts";
import { leadRigOpen, leadRigProject, type LeadRig } from "./leadHarness.ts";
import { postgresHarnessKeying } from "./harness.ts";
import type { SessionStoreDouble } from "./storeDouble.ts";

/** One opened subject: the lead rig, and the three stores 062 answers. */
export interface ThreadRig extends LeadRig {
  readonly threads: ThreadStore;
  readonly minting: ThreadSessionMint;
  readonly seeding: ThreadSeedingRead;
  readonly wakes: ThreadWakeStore;
}

export async function threadRigOpen(): Promise<ThreadRig> {
  const lead = await leadRigOpen();
  return {
    ...lead,
    threads: postgresThreads(lead.apiPool, {
      streamsMax: sessionStoreStreamsAnswered,
    }),
    minting: threadSessionMint(),
    seeding: postgresThreadSeeding(lead.apiPool),
    wakes: postgresThreadWakes(lead.selectorPool),
  };
}

/** A provisioned project no other case is holding. */
export function threadRigProject(
  rig: ThreadRig,
  label: string,
): Promise<Partition> {
  return leadRigProject(rig, `thread-${label}`);
}

/** One member: the identity an operation is audited to, and the principal a thread acts as. */
export interface ThreadRigMember {
  readonly principal: Principal;
  readonly authority: Authority;
}

/** The issuer every member of these suites is derived under, named once. */
export const threadRigIssuer = "https://threads.test/";

/** What a member holds where a case is not about the access it holds. */
export const threadRigAccess = new Set(["Read", "Mutate"] as const);

/**
 * A member with a membership on the project, derived exactly the way a
 * deployment derives one: the subject is what an operation is audited to and
 * the principal is `oidcPrincipal` of the issuer and that subject.
 */
export function threadRigMember(
  rig: ThreadRig,
  partition: Partition,
  label: string,
  access: ReadonlySet<
    "Read" | "Mutate" | "DispatchTicket" | "ProposeDispatch"
  > = threadRigAccess,
): ThreadRigMember {
  const principal = oidcPrincipal(
    threadRigIssuer,
    `member-${label}-${randomUUID()}`,
  );
  const member: ThreadRigMember = {
    principal,
    authority: memberAuthority(principal),
  };
  rig.sessions.harness.access.grant({
    partition,
    principal: member.principal,
    access,
  });
  return member;
}

/**
 * A second project under the SAME tenant. Every other fixture here mints a
 * fresh tenant as well as a fresh project, so `m.project=s.project` is never a
 * load-bearing predicate under them; this is what makes it one.
 */
export async function threadRigSiblingProject(
  rig: ThreadRig,
  partition: Partition,
  label: string,
): Promise<Partition> {
  const sibling = {
    tenant: partition.tenant,
    project: asProjectId(`project-sibling-${label}-${randomUUID()}`),
  };
  await rig.sessions.harness.store.createProject(sibling);
  return sibling;
}

/** Grants a member the same access on a further project, under the same authority. */
export function threadRigMemberAlso(
  rig: ThreadRig,
  partition: Partition,
  member: ThreadRigMember,
  access: ReadonlySet<
    "Read" | "Mutate" | "DispatchTicket" | "ProposeDispatch"
  > = threadRigAccess,
): void {
  rig.sessions.harness.access.grant({
    partition,
    principal: member.principal,
    access,
  });
}

/** Withdraws a member's access, which is what makes their thread ownerless. */
export function threadRigRevoke(
  rig: ThreadRig,
  partition: Partition,
  member: ThreadRigMember,
): void {
  if (
    !rig.sessions.harness.access.revoke({
      partition,
      principal: member.principal,
    })
  )
    throw new Error("thread rig: there was no access to withdraw");
}

/** What a thread is opened with where a case is about neither the prompt nor the slot. */
export const threadRigPrompt = "you are a member's thread";
export const threadRigSlot = "claude-code";

/** Opens one member's thread, refusing anything but the arm the case expected. */
export async function threadRigThread(
  rig: ThreadRig,
  partition: Partition,
  member: ThreadRigMember,
  expected: "Opened" | "AlreadyOpen" = "Opened",
) {
  const opened = await rig.threads.open({
    partition,
    principal: member.principal,
    session: rig.minting.session(),
    systemPrompt: threadRigPrompt,
    credentialSlot: threadRigSlot,
  });
  if (opened.opened !== expected)
    throw new Error(`thread rig: opening answered ${opened.opened}`);
  return opened.thread;
}

/** A turn identity no other case is using. */
export function threadRigTurnId(label: string): string {
  return `thread-turn-${label}-${randomUUID()}`;
}

/**
 * A ticket standing in one phase, with the change that says so. The projection
 * is written straight because how a phase is reached is the actor's business
 * and these suites are about what the change beside it records.
 */
export async function threadRigTicketPhase(
  rig: ThreadRig,
  partition: Partition,
  ticket: TicketId,
  phase: string,
): Promise<void> {
  await rig.sessions.harness.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
     VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (tenant,project,ticket)
       DO UPDATE SET phase=EXCLUDED.phase,seq=ticket_projection.seq+1`,
    [partition.tenant, partition.project, ticket, phase],
  );
  await rig.sessions.harness.query(
    `SELECT append_project_change($1,$2,'Ticket',$3)`,
    [partition.tenant, partition.project, String(ticket)],
  );
}

/**
 * The app the thread routes are driven through, composed from the bundle the
 * ROOT composes. It is here rather than in either suite because the two that
 * drive it differ in one thing — which project access answers — and a second
 * copy of the composition is a second place a port is added to.
 */
export function threadRigApp(input: {
  readonly rig: ThreadRig;
  readonly principal: Principal;
  readonly access: ProjectAccess;
  readonly store: SessionStoreDouble;
}) {
  const pool = input.rig.apiPool;
  const leads = postgresLeadReads(pool);
  const web = composeNativeWeb(
    pool,
    postgresHarnessKeying(),
    input.access,
    postgresExecutionBacklogGuard(pool),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      leads,
      store: input.store,
      refusals: postgresAgenticRefusalReads(pool),
      history: leads,
    },
    {
      threads: postgresThreads(pool, {
        streamsMax: sessionStoreStreamsAnswered,
      }),
      sessions: threadSessionMint(),
      seeding: postgresThreadSeeding(pool),
      rows: postgresSessionStoreRows(pool),
      store: input.store,
      credentialSlot: threadRigSlot,
    },
  );
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: input.principal },
        }),
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
}
