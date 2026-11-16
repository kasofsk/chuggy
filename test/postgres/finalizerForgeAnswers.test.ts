/**
 * What GitHub answered a merge is readable afterwards: on the proposal's row,
 * through the landings door, and in the finalizer's log, with the token the
 * forge was asked under in none of them.
 *
 * THE FORGE IS THE REAL ADAPTER OVER A FAKE GITHUB. The rig's remote is a
 * path, so every act but the merge is the fixture's, and the merge is the
 * GitHub adapter's own, addressed at a GitHub repository and answered by a
 * fetch that refuses it the way a ruleset does.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { githubChangeProposals } from "../../src/adapters/forge/githubChangeProposals.ts";
import { postgresTicketLandings } from "../../src/adapters/postgres/ticketLandings.ts";
import { proposalForgeMessageCharsMax } from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asForgeBindingId,
  asForgeCredential,
  asForgeCredentialReference,
  asProposalDisplayUrl,
  asProposalNumber,
  asProposalRemoteIdentity,
  type ChangeProposalForges,
  type ChangeProposalPort,
  type ChangeProposalRequest,
} from "../../src/interpreter/changeProposal.ts";
import {
  asFinalizerOwnerId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { finalizerProcessLog } from "../../src/interpreter/finalizerTelemetry.ts";
import { finalizerPass } from "../../src/interpreter/finalizerRun.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  finalizerBriefBranch,
  finalizerBriefFinalizationTarget,
  finalizerExpireClaim,
  finalizerGitVerb,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerService,
  finalizerSubject,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

const workBranch = "refs/heads/chuggy/forge-answers";
const baseBranch = "refs/heads/chuggy/forge-answers-base";

/** The installation token the fake GitHub is asked under, a value no other fixture string contains. */
const installationToken = "ghs_forgeanswerstoken9x8w7v";

/** A ticket that merges a proposal from its own branch into another. */
async function mergingSubject(label: string): Promise<FinalizerProject> {
  const { project, remote } = await finalizerSubject(rig, label, [
    { path: "one.txt", content: "one\n" },
  ]);
  finalizerGitVerb(remote.origin, "branch", "chuggy/forge-answers", "main");
  finalizerGitVerb(
    remote.origin,
    "branch",
    "chuggy/forge-answers-base",
    "main",
  );
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    workBranch,
  );
  await finalizerBriefFinalizationTarget(
    rig,
    project.partition,
    project.ticket,
    baseBranch,
    "PullRequestMerge",
  );
  return project;
}

/** A forge that opens what it is asked for, and hands every merge to GitHub's adapter over a fetch answering `refusal`. */
function forgeRefusingMerges(refusal: () => Response): ChangeProposalForges {
  const github = githubChangeProposals({
    credentials: {
      credential: () =>
        Promise.resolve({
          resolved: "Credential",
          credential: asForgeCredential(installationToken),
        }),
    },
    fetch: () => Promise.resolve(refusal()),
  });
  const port: ChangeProposalPort = {
    create: (request: ChangeProposalRequest) =>
      Promise.resolve({
        created: "Created",
        evidence: {
          identity: {
            forge: request.binding.forge,
            remote: asProposalRemoteIdentity("forge-answers"),
            number: asProposalNumber(1),
          },
          repository: request.repository,
          marker: request.marker,
          head: request.head,
          base: request.base,
          title: request.title,
          body: request.body,
          status: "Open",
          mergeability: "Mergeable",
          url: asProposalDisplayUrl("https://forge.invalid/proposals/1"),
        },
      }),
    readByMarker: () => Promise.resolve({ read: "Absent" }),
    readByNumber: () => Promise.resolve({ read: "Unavailable" }),
    merge: (request) =>
      github.merge({
        ...request,
        repository: asRepositoryId("https://github.com/kasofsk/chuggy"),
      }),
    updateBranch: () => Promise.resolve({ updated: "Unavailable" }),
    readQueue: () => Promise.resolve({ read: "Unavailable" }),
    enqueue: () => Promise.resolve({ enqueued: "Unavailable" }),
    dequeue: () => Promise.resolve({ dequeued: "Unavailable" }),
  };
  const binding = {
    forge: asForgeBindingId("forge-answers"),
    credential: asForgeCredentialReference("forge-answers-proposals"),
  };
  return { selector: { select: () => port }, bindingOf: () => binding };
}

/** Takes the subject through its preparation, its push, its proposal and its first merge, and answers every line its log wrote. */
async function mergedOnce(
  project: FinalizerProject,
  label: string,
  forges: ChangeProposalForges,
): Promise<readonly string[]> {
  const lines: string[] = [];
  const log = finalizerProcessLog((line) => {
    lines.push(line);
  });
  const service = finalizerService(rig, finalizerRemotePort(rig), log, forges);
  for (const step of ["prepare", "push", "open", "merge"]) {
    await finalizerExpireClaim(rig, project);
    await finalizerPass(
      service,
      asFinalizerOwnerId(`owner-${label}-${step}`),
      asRecoveryEpoch(project.epoch),
    );
  }
  return lines;
}

/** The merges this subject's row counts and the newest merge answer it keeps. */
async function mergeKept(
  project: FinalizerProject,
): Promise<{ merge_attempts: number; merge: Record<string, unknown> }> {
  const rows = await rig.as(
    `SELECT merge_attempts, forge_answers->'merge' AS merge
       FROM finalization_change_proposal WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  return rows[0] as { merge_attempts: number; merge: Record<string, unknown> };
}

/** The proposal the landings door answers of this subject's one request. */
async function landingProposal(project: FinalizerProject) {
  const landings = await postgresTicketLandings(
    rig.harness.writerPool,
  ).landings(project.partition, asTicketId(project.ticket), 1);
  return landings?.[0]?.proposal;
}

test("a merge a ruleset refused keeps GitHub's status and message on its row, through the landings door and in one log line, and the token in none", async () => {
  const project = await mergingSubject("forge-answers-refused");
  const lines = await mergedOnce(
    project,
    "forge-answers-refused",
    forgeRefusingMerges(
      () =>
        new Response(
          JSON.stringify({ message: "Repository rule violations found" }),
          { status: 405 },
        ),
    ),
  );

  const kept = await mergeKept(project);
  assert.equal(kept.merge_attempts, 1);
  assert.equal(kept.merge["status"], 405);
  assert.equal(kept.merge["message"], "Repository rule violations found");
  assert.equal(kept.merge["outcome"], "NotMergeable");
  assert.equal(typeof kept.merge["askedAt"], "string");
  assert.equal(typeof kept.merge["answeredAt"], "string");

  const proposal = await landingProposal(project);
  assert.equal(proposal?.mergesAsked, 1);
  assert.equal(proposal.mergeAnswer?.status, 405);
  assert.equal(
    proposal.mergeAnswer.message,
    "Repository rule violations found",
  );
  assert.equal(proposal.mergeAnswer.outcome, "NotMergeable");
  assert.equal(proposal.mergeAnswer.messageCut, undefined);
  assert.equal(proposal.mergeAnswer.answeredAt, kept.merge["answeredAt"]);

  const merges = lines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((fields) => fields["act"] === "merge");
  assert.deepEqual(merges, [
    {
      finalizer: "forgeAct",
      ticket: project.ticket,
      request: project.request,
      act: "merge",
      outcome: "NotMergeable",
      status: 405,
      message: "Repository rule violations found",
    },
  ]);
  assert.ok(lines.length > merges.length, "the other acts were logged too");
  for (const line of lines)
    assert.equal(line.includes(installationToken), false, line);
});

test("a merge answer past its bound is cut to it, and the row and the landings door both say so", async () => {
  const project = await mergingSubject("forge-answers-cut");
  const said = "r".repeat(proposalForgeMessageCharsMax + 7);
  await mergedOnce(
    project,
    "forge-answers-cut",
    forgeRefusingMerges(
      () => new Response(JSON.stringify({ message: said }), { status: 405 }),
    ),
  );

  const kept = await mergeKept(project);
  assert.equal(
    kept.merge["message"],
    said.slice(0, proposalForgeMessageCharsMax),
  );
  assert.equal(kept.merge["messageCut"], true);

  const proposal = await landingProposal(project);
  assert.equal(
    proposal?.mergeAnswer?.message,
    said.slice(0, proposalForgeMessageCharsMax),
  );
  assert.equal(proposal.mergeAnswer.messageCut, true);
});
