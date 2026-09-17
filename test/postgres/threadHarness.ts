import { randomUUID } from "node:crypto";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { threadSessionMint } from "../../src/adapters/crypto/threadSessionMint.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresSessionStoreRows } from "../../src/adapters/postgres/sessionStoreReads.ts";
import { postgresThreadSeeding } from "../../src/adapters/postgres/thread.ts";
import { composeNativeWeb } from "../../src/compose.ts";
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
} from "../../src/interpreter/threadRead.ts";
import { leadRigOpen, leadRigProject, type LeadRig } from "./leadHarness.ts";
import type { SessionStoreDouble } from "./storeDouble.ts";

export interface ThreadRig extends LeadRig {
  readonly minting: ThreadSessionMint;
  readonly seeding: ThreadSeedingRead;
}

export async function threadRigOpen(): Promise<ThreadRig> {
  const lead = await leadRigOpen();
  return {
    ...lead,
    minting: threadSessionMint(),
    seeding: postgresThreadSeeding(lead.apiPool),
  };
}

export function threadRigProject(
  rig: ThreadRig,
  label: string,
): Promise<Partition> {
  return leadRigProject(rig, `thread-${label}`);
}

export interface ThreadRigMember {
  readonly principal: Principal;
  readonly authority: Authority;
}

export const threadRigIssuer = "https://threads.test/";
export const threadRigAccess = new Set(["Read", "Mutate"] as const);

export function threadRigMember(
  rig: ThreadRig,
  partition: Partition,
  label: string,
  access: ReadonlySet<"Read" | "Mutate"> = threadRigAccess,
): ThreadRigMember {
  const principal = oidcPrincipal(
    threadRigIssuer,
    `member-${label}-${randomUUID()}`,
  );
  const member = { principal, authority: memberAuthority(principal) };
  rig.sessions.harness.access.grant({ partition, principal, access });
  return member;
}

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

export function threadRigMemberAlso(
  rig: ThreadRig,
  partition: Partition,
  member: ThreadRigMember,
  access: ReadonlySet<"Read" | "Mutate"> = threadRigAccess,
): void {
  rig.sessions.harness.access.grant({
    partition,
    principal: member.principal,
    access,
  });
}

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

export const threadRigPrompt = "you are a member's thread";
export const threadRigSlot = "claude-code";

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

export function threadRigApp(input: {
  readonly rig: ThreadRig;
  readonly principal: Principal;
  readonly access: ProjectAccess;
  readonly store: SessionStoreDouble;
}) {
  const pool = input.rig.apiPool;
  return createNativeHttpApp(
    composeNativeWeb(
      pool,
      input.access,
      {} as Parameters<typeof composeNativeWeb>[2],
      {
        threads: input.rig.threads,
        sessions: input.rig.minting,
        seeding: input.rig.seeding,
        rows: postgresSessionStoreRows(pool),
        store: input.store,
        credentialSlot: threadRigSlot,
      },
    ),
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
