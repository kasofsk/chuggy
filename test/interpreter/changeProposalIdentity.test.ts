/**
 * The proposal's identity, pinned as bytes.
 *
 * WIDENING THE CREDENTIAL PORT MUST NOT MOVE A PROPOSAL. A finalizer that mints
 * its forge credential has to hand the minting source a partition and a
 * repository, so `ChangeProposalRequest` now carries both. The identity a
 * proposal is opened and found again under is taken over the finalization claim
 * and never over that request, and a run that re-prepared one ticket after this
 * change must ask the forge for the proposal it already opened rather than a
 * second one beside it.
 *
 * THE GOLDEN STRING IS THE WHOLE OF THE PROOF. A case that recomputed the
 * canonical bytes from the same function it is checking would agree with any
 * construction, this one included; a literal written down before the widening
 * disagrees with every construction but the one that stood.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredentialReference,
  changeProposalRequest,
} from "../../src/interpreter/changeProposal.ts";
import {
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type FinalizationClaim,
} from "../../src/interpreter/finalizer.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { canonicalChangeProposalRequest } from "../../src/interpreter/finalizerPreparation.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

/**
 * The claim one ticket's proposal is identified by, whatever the request beside
 * it carries. Only four of its fields reach the canonical bytes, which is what
 * every other field being a fixture value here says.
 */
const claim: FinalizationClaim = {
  partition: { tenant: asTenantId("acme"), project: asProjectId("atlas") },
  ticket: asTicketId(7),
  request: "request-a1b2c3",
  authorizingSeq: 1,
  requestGeneration: 1,
  claimGeneration: 1,
  state: "Open",
  kind: "RunFinalizer",
  recoveryEpoch: asRecoveryEpoch("epoch-1"),
  owner: asFinalizerOwnerId("finalizer-1"),
};

/** The bytes this construction produced before `ChangeProposalRequest` carried a partition. */
const goldenCanonical =
  "22:chuggy:finalization:v18:proposal4:acme5:atlas1:714:request-a1b2c3";

/** The sha256 of those bytes, which is the identity a proposal is opened under. */
const goldenDigest =
  "6c146b9cd3c5694499df4d7273bbedddbf91c6690471b49ed3cd55d4b1f1f0ae";

test("a proposal's identity is the claim's and not the request's", () => {
  const canonical = canonicalChangeProposalRequest(claim);
  assert.equal(canonical, goldenCanonical);
  assert.equal(
    createHash("sha256").update(canonical, "utf8").digest("hex"),
    goldenDigest,
  );
});

test("the partition a request carries reaches the credential and nothing else", () => {
  const of = (partition: { tenant: string; project: string }) =>
    changeProposalRequest({
      binding: {
        forge: asForgeBindingId("forge-alpha"),
        credential: asForgeCredentialReference("forge-alpha-proposals"),
      },
      repository: asRepositoryId("https://forge.invalid/acme/atlas.git"),
      partition: {
        tenant: asTenantId(partition.tenant),
        project: asProjectId(partition.project),
      },
      request: asChangeProposalRequestIdentity(goldenDigest),
      headRef: asGitRefName("refs/heads/chuggy/ticket-7"),
      headCommit: asGitObjectId("b".repeat(40)),
      baseRef: asGitRefName("refs/heads/main"),
      baseCommit: asGitObjectId("c".repeat(40)),
      title: "ticket 7",
      body: "propose it",
    });
  const here = of({ tenant: "acme", project: "atlas" });
  const elsewhere = of({ tenant: "other", project: "elsewhere" });
  assert.deepEqual(here.partition, {
    tenant: "acme",
    project: "atlas",
  });
  assert.equal(here.request, elsewhere.request);
  assert.deepEqual(
    { ...here, partition: undefined },
    { ...elsewhere, partition: undefined },
    "two partitions produce one request in every field the forge is asked with",
  );
});
