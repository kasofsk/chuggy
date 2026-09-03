/**
 * What every inquiry case needs of a real PostgreSQL: the thread rig 062's
 * suites already stand on, the API-side inquiry store 063 grants, and a lead
 * that has actually run — a runtime reference bound, one settled turn, and the
 * batches that turn flushed.
 *
 * A LEAD THAT HAS NOT RUN IS THE DEGENERATE CASE AND NOT THE FIXTURE. Every
 * assertion about a fork is an assertion about resuming a transcript, so the
 * rig's lead is one there is a transcript to resume: `inquiryRigLead` drives the
 * plane exactly as a pod does — open an attempt, bind the reference, claim the
 * turn, record the batches, answer with the range — because a fixture that
 * wrote those rows directly would be green over a door the deployed credential
 * cannot reach.
 *
 * THE STORE IS DRIVEN THROUGH THE WORKER PLANE'S ROLE and the doors through the
 * API's, because a suite that drove either as the migration owner would be
 * green over a grant that had never been made.
 */

import { createHash, randomUUID } from "node:crypto";

import { postgresLeadInquiries } from "../../src/adapters/postgres/leadInquiry.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  type SessionId,
  type SessionStoreStream,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { LeadInquiryStore } from "../../src/interpreter/leadInquiry.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  type ThreadRig,
  type ThreadRigMember,
} from "./threadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigSession,
  sessionRigTurn,
  type SessionRigAttempt,
} from "./sessionHarness.ts";

/** One opened subject: the thread rig, and the store 063 answers the API with. */
export interface InquiryRig extends ThreadRig {
  readonly inquiries: LeadInquiryStore;
}

export async function inquiryRigOpen(): Promise<InquiryRig> {
  const threads = await threadRigOpen();
  return { ...threads, inquiries: postgresLeadInquiries(threads.apiPool) };
}

/** A provisioned project no other case is holding. */
export function inquiryRigProject(
  rig: InquiryRig,
  label: string,
): Promise<Partition> {
  return threadRigProject(rig, `inquiry-${label}`);
}

export { threadRigMember as inquiryRigMember };
export type { ThreadRigMember as InquiryRigMember };

/** What a lead is opened with where a case is about neither the objectives nor the roster. */
export const inquiryRigLeadPrompt = "you are the project's lead";

/** The digest of one batch's bytes, which is all the durable side holds of them. */
export function inquiryRigDigest(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

/** One session that has run: its identity, its runtime reference and its main stream. */
export interface InquiryRigRun {
  readonly session: SessionId;
  readonly reference: string;
  readonly stream: SessionStoreStream;
  readonly attempt: SessionRigAttempt;
  /** The last batch the settled turn flushed, which is the head a fork resumes from. */
  readonly settledBatch: number;
}

/** What a case varies about the session it drives, and nothing else. */
export interface InquiryRigRunOpening {
  readonly kind?: "Lead" | "Thread";
  readonly principal?: string;
  readonly systemPrompt?: string;
  /** How many batches the settled turn flushes; none makes a session with no head. */
  readonly batches?: number;
}

/**
 * One session with a settled turn behind it, driven through the plane the way a
 * pod drives it: the turn is enqueued FIRST, because an attempt over a mailbox
 * with nothing queued is `NotLaunchable` and that is the scheduler's own rule.
 */
export async function inquiryRigRun(
  rig: InquiryRig,
  partition: Partition,
  label: string,
  opening: InquiryRigRunOpening = {},
): Promise<InquiryRigRun> {
  const batches = opening.batches ?? 1;
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: opening.kind ?? "Lead",
    ...(opening.principal === undefined
      ? {}
      : { principal: opening.principal }),
    capabilities: ["ProjectRead"],
    systemPrompt: opening.systemPrompt ?? inquiryRigLeadPrompt,
  });
  const turn = await sessionRigTurn(rig.sessions, partition, session, label);
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    label,
  );
  const reference = `runtime-${label}-${randomUUID()}`;
  const bound = await rig.sessions.plane.bind({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    reference,
  });
  if (bound !== "Bound")
    throw new Error(
      `inquiry rig: binding ${label}'s reference answered ${bound}`,
    );
  const stream = asSessionStoreStream(reference);
  await inquiryRigClaim(rig, attempt, turn);
  for (let batch = 1; batch <= batches; batch += 1)
    await inquiryRigRecord(rig, attempt, stream, batch);
  const answered = await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: `${label} answered`,
    ...(batches === 0 ? {} : { batchFirst: 1, batchLast: batches }),
  });
  if (answered !== "Answered")
    throw new Error(
      `inquiry rig: settling ${label}'s turn answered ${answered}`,
    );
  return { session, reference, stream, attempt, settledBatch: batches };
}

/** A lead with one settled turn behind it, which is every fork case's subject. */
export function inquiryRigLead(
  rig: InquiryRig,
  partition: Partition,
  label: string,
  opening: InquiryRigRunOpening = {},
): Promise<InquiryRigRun> {
  return inquiryRigRun(rig, partition, `${label}-lead`, {
    ...opening,
    kind: "Lead",
  });
}

/** Claims the turn a case is about, refusing anything but the turn it asked for. */
export async function inquiryRigClaim(
  rig: InquiryRig,
  attempt: SessionRigAttempt,
  turn: SessionTurnId,
): Promise<void> {
  const claimed = await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  if (claimed?.turn !== turn)
    throw new Error(
      `inquiry rig: claiming answered ${String(claimed?.turn)} rather than ${turn}`,
    );
}

/** Records one batch through the plane, refusing anything but a stored one. */
export async function inquiryRigRecord(
  rig: InquiryRig,
  attempt: SessionRigAttempt,
  stream: SessionStoreStream,
  batch: number,
): Promise<string> {
  const digest = inquiryRigDigest(`${stream}/${String(batch)}`);
  const recorded = await rig.sessions.plane.record({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    stream,
    batch,
    digest,
    bytes: 1,
    events: 1,
  });
  if (recorded !== "Stored")
    throw new Error(`inquiry rig: recording batch answered ${recorded}`);
  return digest;
}

/** One inquiry identity no other case is using, and the turn it takes. */
export function inquiryRigIdentities(label: string): {
  readonly session: SessionId;
  readonly turn: SessionTurnId;
} {
  const drawn = randomUUID();
  return {
    session: asSessionId(`inq-${label}-${drawn}`),
    turn: asSessionTurnId(`inq-turn-${label}-${drawn}`),
  };
}

/** One session row as the durable side holds it, for the columns no port answers. */
export async function inquiryRigSessionRow(
  rig: InquiryRig,
  session: SessionId,
): Promise<Record<string, unknown>> {
  const rows = await rig.sessions.harness.query(
    `SELECT kind,principal,parent_session,capabilities,credential_slot,
            account,cluster,state,system_prompt,closed_at IS NULL AS open
       FROM agent_session WHERE session=$1`,
    [session],
  );
  const row = rows[0];
  if (row === undefined)
    throw new Error(`inquiry rig: no session ${session} to read back`);
  return row;
}

/** Every batch one session's store holds, as the digests a comparison can hold. */
export async function inquiryRigStoreDigests(
  rig: InquiryRig,
  session: SessionId,
): Promise<readonly string[]> {
  const rows = await rig.sessions.harness.query(
    `SELECT stream,batch::text AS batch,digest FROM session_store_batch
      WHERE session=$1 ORDER BY stream,batch`,
    [session],
  );
  return rows.map(
    (row) =>
      `${String(row["stream"])}/${String(row["batch"])}/${String(row["digest"])}`,
  );
}
