import assert from "node:assert/strict";
import { test } from "node:test";

import * as ticket from "../../src/domain/chuggernaut/ticket.js";
import {
  ContentRef,
  CycleNumber,
  Generation,
  TicketId,
} from "../../src/domain/chuggernaut/task.js";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalNumber,
  asProposalRemoteIdentity,
  changeProposalRequest,
  type ChangeProposalCreated,
  type ChangeProposalMerged,
  type ChangeProposalRead,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  ticketFinalizerPass,
  type TicketFinalizerClaim,
  type TicketFinalizerStore,
} from "../../src/interpreter/ticketFinalizer.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const commit = "b".repeat(40);
const repository = "https://github.com/example/repository";
const content = new Map([
  [
    4,
    {
      mediaType: "application/json",
      content: JSON.stringify({ commit, repository }),
    },
  ],
  [
    6,
    {
      mediaType: "application/json",
      content:
        '{"kind":"finalizer","operation":"pull-request","target_ref":"refs/heads/main","branch_prefix":"tickets/","merge":false}',
    },
  ],
]);
const obligation = new ticket.FinalizeTicket(
  TicketId(7),
  new ticket.FinalizationOperation(
    CycleNumber(2),
    Generation(3),
    ContentRef(8),
    ContentRef(4),
  ),
  ContentRef(6),
);
const proposal = changeProposalRequest({
  binding: {
    forge: asForgeBindingId("github"),
    credential: asForgeCredentialReference("app"),
  },
  partition,
  repository: asRepositoryId(repository),
  request: asChangeProposalRequestIdentity("c".repeat(64)),
  headRef: asGitRefName("refs/heads/tickets/7"),
  headCommit: asGitObjectId(commit),
  baseRef: asGitRefName("refs/heads/main"),
  baseCommit: asGitObjectId("a".repeat(40)),
  title: "Ticket 7",
  body: `chuggy-handoff:${"c".repeat(64)}`,
});
const proposalEvidence = {
  identity: {
    forge: proposal.binding.forge,
    remote: asProposalRemoteIdentity("pr-7"),
    number: asProposalNumber(7),
  },
  repository: proposal.repository,
  marker: proposal.marker,
  head: proposal.head,
  base: proposal.base,
  title: proposal.title,
  body: proposal.body,
  status: "Open" as const,
};

function initializationStore(
  prepared: (candidate: string, head: string) => void,
): TicketFinalizerStore {
  const claim: TicketFinalizerClaim = {
    partition,
    identity: "delivery",
    generation: 1,
    obligation,
    promotion: "Idle",
    publication: { publication: "Unopened" },
    merging: { merging: "Unasked" },
  };
  let offered = false;
  return {
    register: () => Promise.resolve(true),
    claim: () => {
      if (offered) return Promise.resolve(undefined);
      offered = true;
      return Promise.resolve(claim);
    },
    prepare: (_claim, _repository, _base, candidate, head) => {
      prepared(candidate, head);
      return Promise.resolve(true);
    },
    promotion: () => Promise.resolve(false),
    initialize: () => Promise.resolve(false),
    publication: () => Promise.resolve(false),
    merging: () => Promise.resolve(false),
    complete: () => Promise.resolve(false),
    reported: () => Promise.resolve(false),
    release: () => Promise.resolve(),
  };
}

test("finalization resolves numeric repository and commit content references before Git", async () => {
  let prepared: readonly [string, string] | undefined;
  const binding = {
    partition,
    repository: asRepositoryId(repository),
    recoveryEpoch: asRecoveryEpoch("epoch"),
  };
  const service = {
    owner: "owner",
    leaseMs: 30_000,
    recoveryEpoch: asRecoveryEpoch("epoch"),
    store: initializationStore((candidate, head) => {
      prepared = [candidate, head];
    }),
    contents: () => ({
      read: (reference: ContentRef) =>
        Promise.resolve(content.get(Number(reference))),
      put: () => Promise.resolve(ContentRef(9)),
    }),
    bindings: { binding: () => Promise.resolve(binding) },
    git: {
      observeTarget: () =>
        Promise.resolve({
          observed: "Target",
          target: {
            ref: asGitRefName("refs/heads/main"),
            commit: asGitObjectId("a".repeat(40)),
          },
        } as const),
      prepareSource: (request: {
        readonly ref: string;
        readonly commit: string;
      }) => {
        assert.equal(request.ref, `refs/chuggy/results/${commit}`);
        assert.equal(request.commit, commit);
        return Promise.resolve({
          prepared: "Candidate",
          candidate: asGitObjectId(commit),
        } as const);
      },
    } as never,
    forges: {
      binding: () => ({
        forge: asForgeBindingId("github"),
        credential: asForgeCredentialReference("app"),
      }),
      proposal: () => undefined,
    },
    inbox: { submit: () => Promise.resolve(false) },
    bounds: {
      publication: { creationsMax: 3, reconciliationsMax: 3 },
      merging: { mergesMax: 3, readingsMax: 3 },
    },
    identities: () => ({
      request: asChangeProposalRequestIdentity("c".repeat(64)),
      permit: "permit" as never,
    }),
  };
  assert.equal(await ticketFinalizerPass(service, 1), 1);
  assert.deepEqual(prepared, [commit, "refs/heads/tickets/7"]);
});

interface RefusalHarness {
  readonly service: Parameters<typeof ticketFinalizerPass>[0];
  outcome(): string | undefined;
}

function refusalStore(outcome: (value: string) => void): TicketFinalizerStore {
  let generation = 0;
  let publication: TicketFinalizerClaim["publication"] = {
    publication: "Unopened",
  };
  let merging: TicketFinalizerClaim["merging"] = { merging: "Unasked" };
  return {
    register: () => Promise.resolve(true),
    claim: () =>
      Promise.resolve({
        partition,
        identity: "delivery-refused",
        generation: (generation += 1),
        obligation,
        request: proposal,
        repository: {
          partition,
          repository: proposal.repository,
          recoveryEpoch: asRecoveryEpoch("epoch"),
        },
        base: { ref: proposal.base.ref, commit: proposal.base.commit },
        candidate: proposal.head.commit,
        headRef: proposal.head.ref,
        promotion: "Published",
        publication,
        merging,
      }),
    prepare: () => Promise.resolve(false),
    promotion: () => Promise.resolve(false),
    initialize: () => Promise.resolve(false),
    publication: (_claim, value) => {
      publication = value;
      return Promise.resolve(true);
    },
    merging: (_claim, value) => {
      merging = value;
      return Promise.resolve(true);
    },
    complete: (_claim, value) => {
      outcome(value);
      return Promise.resolve(true);
    },
    reported: () => Promise.resolve(false),
    release: () => Promise.resolve(),
  };
}

function refusalHarness(
  create: () => Promise<ChangeProposalCreated>,
  read: () => Promise<ChangeProposalRead>,
  merge = false,
  mergeAnswer: () => Promise<ChangeProposalMerged> = () =>
    Promise.resolve({ merged: "Unavailable" }),
): RefusalHarness {
  let terminal: string | undefined;
  const store = refusalStore((value) => {
    terminal = value;
  });
  return {
    outcome: () => terminal,
    service: {
      owner: "owner",
      leaseMs: 30_000,
      recoveryEpoch: asRecoveryEpoch("epoch"),
      store,
      contents: () => ({
        read: () =>
          Promise.resolve({
            mediaType: "application/json",
            content: (content.get(6)?.content ?? "").replace(
              '"merge":false',
              `"merge":${String(merge)}`,
            ),
          }),
        put: () => Promise.resolve(ContentRef(9)),
      }),
      bindings: { binding: () => Promise.resolve(undefined) },
      git: {} as never,
      forges: {
        binding: () => undefined,
        proposal: () => ({
          create,
          readByMarker: read,
          readByNumber: read,
          merge: mergeAnswer,
        }),
      },
      inbox: { submit: () => Promise.resolve(false) },
      bounds: {
        publication: { creationsMax: 2, reconciliationsMax: 2 },
        merging: { mergesMax: 2, readingsMax: 2 },
      },
      identities: () => ({
        request: proposal.request,
        permit: "permit" as never,
      }),
    },
  };
}

async function refusalRunsToTerminal(harness: RefusalHarness): Promise<void> {
  for (let pass = 0; pass < 12 && harness.outcome() === undefined; pass += 1)
    await ticketFinalizerPass(harness.service, 1);
  assert.equal(harness.outcome(), "Unavailable");
}

test("a forge that permanently denies creation exhausts its bounded attempts", async () => {
  await refusalRunsToTerminal(
    refusalHarness(
      () => Promise.resolve({ created: "Denied" }),
      () => Promise.resolve({ read: "Denied" }),
    ),
  );
});

test("an ambiguous creation with permanently unavailable reads exhausts its bounds", async () => {
  await refusalRunsToTerminal(
    refusalHarness(
      () => Promise.resolve({ created: "Ambiguous" }),
      () => Promise.resolve({ read: "Unavailable" }),
    ),
  );
});

test("a forge that permanently denies merge exhausts its bounded attempts", async () => {
  await refusalRunsToTerminal(
    refusalHarness(
      () => Promise.resolve({ created: "Created", evidence: proposalEvidence }),
      () => Promise.resolve({ read: "Found", evidence: proposalEvidence }),
      true,
      () => Promise.resolve({ merged: "Denied" }),
    ),
  );
});

test("an ambiguous merge with permanently unavailable reads exhausts its bounds", async () => {
  await refusalRunsToTerminal(
    refusalHarness(
      () => Promise.resolve({ created: "Created", evidence: proposalEvidence }),
      () => Promise.resolve({ read: "Unavailable" }),
      true,
      () => Promise.resolve({ merged: "Ambiguous" }),
    ),
  );
});
