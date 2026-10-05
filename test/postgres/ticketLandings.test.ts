/**
 * A ticket's own read carries the commit each of its merged change proposals
 * landed, read through the API's own credential, because a read the API holds
 * no grant for is one this layer would only discover in production.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  finalizerCommit,
  finalizerDigest,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPromote,
  finalizerRigOpen,
  finalizerSubject,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresHarnessRolePool } from "./harness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** One project whose ticket's first finalization promoted its candidate. */
async function landingSubject(
  label: string,
): Promise<{ project: FinalizerProject; attempt: string }> {
  const { project } = await finalizerSubject(rig, label, [
    { path: "one.txt", content: "one\n" },
  ]);
  const attempt = await finalizerPromote(rig, project, label);
  return { project, attempt };
}

/** The permit one attempt was granted under. */
async function landingPermit(
  project: FinalizerProject,
  attempt: string,
): Promise<string> {
  const rows = (await rig.harness.query(
    `SELECT permit FROM commit_permit
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt],
  )) as readonly { permit: string }[];
  const permit = rows[0]?.permit;
  if (permit === undefined)
    throw new Error("landing case: the attempt was granted no permit");
  return permit;
}

/** A created proposal under one permit, settled as `merge` names. */
async function landingProposal(
  project: FinalizerProject,
  request: string,
  permit: string,
  merge: string,
): Promise<void> {
  await rig.harness.query(
    `INSERT INTO finalization_change_proposal
       (tenant,project,request,permit,proposal_request,head_ref,head_commit,
        base_ref,base_commit,title,body,attempts,creation,creation_evidence,
        merge_attempts,merge,merge_reason,merge_commit)
     VALUES ($1,$2,$3,$4,$5,'refs/heads/chuggy/landing',$6,
             'refs/heads/main',$6,'ticket 1: land it','land it',1,'Created',
             '{"status":"Open"}'::jsonb,1,$7::text,
             CASE WHEN $7::text='NotMergeable' THEN 'Conflict' END,$8)`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      permit,
      finalizerDigest(),
      finalizerCommit(),
      merge,
      merge === "Merged" ? finalizerCommit() : null,
    ],
  );
}

/**
 * A further finalization of the same ticket, authorized one journal entry
 * before the first so that the order the read answers in is the journal's and
 * not the order the rows were written in, and its attempt and permit copied
 * from the first's.
 */
async function landingEarlierFinalization(
  project: FinalizerProject,
  attempt: string,
  label: string,
): Promise<{ request: string; permit: string }> {
  const request = finalizerIdentity(`request-${label}`);
  const earlier = finalizerIdentity(`attempt-${label}`);
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,
        ticket_version,request_generation,state,kind,work_cycle,
        finalization_generation)
     SELECT tenant,project,$4,authorizing_seq-1,effect_position,ticket,
            ticket_version-1,request_generation,'Fulfilled',kind,work_cycle,
            finalization_generation
       FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      request,
    ],
  );
  await rig.harness.query(
    `INSERT INTO finalization_attempt
       (tenant,project,attempt,request,ticket,repository,input_bundle,
        input_bundle_digest,target_ref,target_commit,strategy,
        configuration_revision,configuration_digest,approval_required,outcome,
        candidate_commit,failure_kind,conflict_manifest,
        conflict_manifest_digest,attempt_digest)
     SELECT tenant,project,$4,$5,ticket,repository,input_bundle,
            input_bundle_digest,target_ref,target_commit,strategy,
            configuration_revision,configuration_digest,approval_required,
            outcome,candidate_commit,failure_kind,conflict_manifest,
            conflict_manifest_digest,$6
       FROM finalization_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      attempt,
      earlier,
      request,
      finalizerDigest(),
    ],
  );
  const permit = await finalizerGrantPermit(rig, project, earlier, label);
  return { request, permit };
}

/** What the ticket's own read carries, read as the API reads it. */
async function landingRead(project: FinalizerProject) {
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const read = await postgresNativeReads(asApi).ticket(
      project.partition,
      asTicketId(project.ticket),
    );
    return read?.landedCommits;
  } finally {
    await asApi.end();
  }
}

/** The commit the proposal answering `request` landed, as the owner reads it. */
async function landingCommitOf(
  project: FinalizerProject,
  request: string,
): Promise<string | undefined> {
  const rows = (await rig.harness.query(
    `SELECT merge_commit FROM finalization_change_proposal
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, request],
  )) as readonly { merge_commit: string }[];
  return rows[0]?.merge_commit;
}

test("a ticket merged twice carries both commits, in the order its finalizations were requested", async () => {
  const { project, attempt } = await landingSubject("landtwice");
  await landingProposal(
    project,
    project.request,
    await landingPermit(project, attempt),
    "Merged",
  );
  const earlier = await landingEarlierFinalization(
    project,
    attempt,
    "landtwice",
  );
  await landingProposal(project, earlier.request, earlier.permit, "Merged");
  assert.deepEqual(await landingRead(project), [
    {
      repository: project.repository,
      commit: await landingCommitOf(project, earlier.request),
    },
    {
      repository: project.repository,
      commit: await landingCommitOf(project, project.request),
    },
  ]);
});

test("a proposal that never merged carries no commit", async () => {
  const { project, attempt } = await landingSubject("landrefused");
  await landingProposal(
    project,
    project.request,
    await landingPermit(project, attempt),
    "NotMergeable",
  );
  assert.deepEqual(await landingRead(project), []);
});

test("a ticket that opened no proposal carries no commit", async () => {
  const { project } = await landingSubject("landnone");
  assert.deepEqual(await landingRead(project), []);
});
