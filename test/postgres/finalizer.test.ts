/**
 * Every legal move migration thirteen's grants admit, made as the role that is
 * supposed to make it, and every recovery query the decision record names,
 * asked of a database holding the state it is supposed to find and the state it
 * must not.
 *
 * THE MOVES ARE MADE AND NOT INSPECTED. A grant nobody exercised reads exactly
 * like a grant that works, and the defect that hides there is a column-level
 * grant omitting a column a legal move must write — which refuses the move
 * entirely and is invisible to any test that reads `information_schema` instead
 * of running the statement.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  finalizerClaim,
  finalizerCommit,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  postgresHarnessProject,
  postgresHarnessSubmission,
} from "./harness.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import {
  asForgeBindingId,
  asForgeCredentialReference,
  forgeBindingOf,
  type ForgeRepositoryBinding,
} from "../../src/interpreter/changeProposal.ts";
import {
  asFinalizerOwnerId,
  asRepositoryId,
  type FinalizationClaim,
  type FinalizationView,
} from "../../src/interpreter/finalizer.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { repositoryBindingWriteFunction } from "../../src/adapters/postgres/schema.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** How many rows a recovery query takes, which is what bounds the work a fresh process picks up. */
const recoveryRowsMax = 64;

/** Records what one permit's promotion proved, which is the finalizer's own move. */
async function reconcile(
  project: FinalizerProject,
  permit: string,
  candidate: string,
  verdict: string,
): Promise<void> {
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,'refs/heads/main',$5,$6)`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      candidate,
      verdict,
      verdict === "Unreadable" ? null : candidate,
    ],
  );
}

/** What one recovery query answered for one project, as a plain list of identities. */
async function found(
  project: FinalizerProject,
  sql: string,
  extra: readonly unknown[] = [],
): Promise<readonly string[]> {
  const rows = (await rig.as(sql, [
    project.partition.tenant,
    project.partition.project,
    recoveryRowsMax,
    ...extra,
  ])) as readonly { found: string }[];
  return rows.map((row) => row.found);
}

test("the finalizer claims a request, holds it, and releases a lapsed claim", async () => {
  const project = await finalizerProject(rig, "claim");
  const owner = finalizerIdentity("owner-claim");
  await finalizerClaim(rig, project, owner);
  assert.deepEqual(
    await rig.as(
      `SELECT state, claim_owner, claim_generation::text AS generation, recovery_epoch
         FROM finalization_request WHERE tenant=$1 AND project=$2 AND request=$3`,
      [project.partition.tenant, project.partition.project, project.request],
    ),
    [
      {
        state: "Registered",
        claim_owner: owner,
        generation: "1",
        recovery_epoch: project.epoch,
      },
    ],
  );
  const released = await rig.as(
    `UPDATE finalization_request
        SET state='Open', claim_owner=NULL, claim_expires_at=NULL,
            recovery_epoch=NULL, claim_generation=claim_generation+1
      WHERE tenant=$1 AND project=$2 AND request=$3 RETURNING state`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.deepEqual(released, [{ state: "Open" }]);
});

test("the finalizer prepares, permits, reconciles and concludes without the owner's help", async () => {
  const project = await finalizerProject(rig, "moves");
  await finalizerClaim(rig, project, finalizerIdentity("owner-moves"));
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "moves", { candidate });
  const permit = await finalizerGrantPermit(rig, project, attempt, "moves");
  await reconcile(project, permit, candidate, "Unreadable");
  const read = await rig.as(
    `UPDATE finalization_reconciliation
        SET verdict='Promoted', observed_commit=$4, reconciled_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3 RETURNING verdict`,
    [project.partition.tenant, project.partition.project, permit, candidate],
  );
  assert.deepEqual(read, [{ verdict: "Promoted" }]);
  const spent = await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3 RETURNING state`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(spent, [{ state: "Concluded" }]);
  const fulfilled = await rig.as(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3 RETURNING state`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.deepEqual(fulfilled, [{ state: "Fulfilled" }]);
});

test("an attempt keeps its own repository though the project's oldest binding differs", async () => {
  const project = await finalizerProject(rig, "attempt-binding");
  const used = `repository-used-${finalizerIdentity("attempt-binding")}`;
  const bound = await rig.harness.query(
    `SELECT ${repositoryBindingWriteFunction}($1,$2,$3,$4,$5,$6,$7) AS result`,
    [
      project.partition.tenant,
      project.partition.project,
      used,
      project.epoch,
      finalizerIdentity("operation-attempt-binding"),
      "Administrator",
      "test-operator",
    ],
  );
  assert.deepEqual(bound, [{ result: "Bound" }]);
  const attempting: FinalizerProject = { ...project, repository: used };
  const claim = await finalizerClaim(
    rig,
    project,
    finalizerIdentity("owner-attempt-binding"),
  );
  const attempt = await finalizerPrepare(rig, attempting, "attempt-binding");
  await finalizerGrantPermit(rig, attempting, attempt, "attempt-binding");
  const view = await postgresFinalizer(rig.pool).durableView(claim);
  assert.equal(view?.attempt?.attempt, attempt);
  assert.equal(view?.repository?.repository, used);
});

test("a permit is spent once and never re-identified", async () => {
  const project = await finalizerProject(rig, "spend");
  const attempt = await finalizerPrepare(rig, project, "spend");
  const permit = await finalizerGrantPermit(rig, project, attempt, "spend");
  const keys = [project.partition.tenant, project.partition.project, permit];
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    keys,
  );
  assert.match(
    await rig.refusal(
      `UPDATE commit_permit SET state='Concluded', concluded_at=now()
        WHERE tenant=$1 AND project=$2 AND permit=$3`,
      keys,
    ),
    /is already concluded/u,
  );
});

test("a reconciliation reads its verdict once and never against another candidate", async () => {
  const project = await finalizerProject(rig, "reread");
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "reread", { candidate });
  const permit = await finalizerGrantPermit(rig, project, attempt, "reread");
  await reconcile(project, permit, candidate, "Promoted");
  const keys = [project.partition.tenant, project.partition.project, permit];
  assert.match(
    await rig.refusal(
      `UPDATE finalization_reconciliation SET verdict='NotPromoted'
        WHERE tenant=$1 AND project=$2 AND permit=$3`,
      keys,
    ),
    /a verdict is read once/u,
  );
});

test("at most one permit is live per project, whatever attempt it names", async () => {
  const project = await finalizerProject(rig, "one-live");
  const first = await finalizerPrepare(rig, project, "one-live-first");
  const second = await finalizerPrepare(rig, project, "one-live-second");
  await finalizerGrantPermit(rig, project, first, "one-live-first");
  assert.match(
    await rig.refusal(
      `INSERT INTO commit_permit
         (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
       VALUES ($1,$2,$3,$4,$5,1)`,
      [
        project.partition.tenant,
        project.partition.project,
        finalizerIdentity("permit-one-live-second"),
        second,
        project.epoch,
      ],
    ),
    /commit_permit_one_live/u,
  );
});

test("an attempt is evidence: no update reaches it and no delete removes it", async () => {
  const project = await finalizerProject(rig, "evidence");
  const attempt = await finalizerPrepare(rig, project, "evidence");
  const keys = [project.partition.tenant, project.partition.project, attempt];
  for (const statement of [
    `UPDATE finalization_attempt SET outcome='Failed'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    `DELETE FROM finalization_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
  ]) {
    assert.match(
      await rig.refusal(statement, keys),
      /permission denied for table finalization_attempt/u,
      statement,
    );
  }
  assert.match(
    await rig.harness
      .query(
        `UPDATE finalization_attempt SET outcome='Failed'
          WHERE tenant=$1 AND project=$2 AND attempt=$3`,
        keys,
      )
      .then(
        () => "the owner rewrote an attempt",
        (refused: unknown) => String(refused),
      ),
    /is written once/u,
  );
});

test("recovery finds the prepared attempts no permit has concluded, and nothing settled", async () => {
  const project = await finalizerProject(rig, "recover-attempt");
  const unfinished = await finalizerPrepare(rig, project, "recover-open");
  const candidate = finalizerCommit();
  const settled = await finalizerPrepare(rig, project, "recover-settled", {
    candidate,
  });
  const permit = await finalizerGrantPermit(
    rig,
    project,
    settled,
    "recover-settled",
  );
  await reconcile(project, permit, candidate, "Promoted");
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(
    await found(
      project,
      `SELECT a.attempt AS found FROM finalization_attempt a
         LEFT JOIN commit_permit p
           ON p.tenant=a.tenant AND p.project=a.project AND p.attempt=a.attempt
        WHERE a.tenant=$1 AND a.project=$2 AND a.outcome='Prepared'
          AND (p.permit IS NULL OR p.state <> 'Concluded')
        ORDER BY a.prepared_at LIMIT $3`,
    ),
    [unfinished],
  );
});

test("recovery finds the granted permits with no conclusion, and nothing spent", async () => {
  const project = await finalizerProject(rig, "recover-permit");
  const attempt = await finalizerPrepare(rig, project, "recover-permit");
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "recover-permit",
  );
  const query = `SELECT permit AS found FROM commit_permit
     WHERE tenant=$1 AND project=$2 AND state='Granted'
     ORDER BY granted_at LIMIT $3`;
  assert.deepEqual(await found(project, query), [permit]);
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.deepEqual(await found(project, query), []);
});

test("recovery finds the holds under attention, and no verdict that concluded", async () => {
  const project = await finalizerProject(rig, "recover-hold");
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "recover-hold", {
    candidate,
  });
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "recover-hold",
  );
  await reconcile(project, permit, candidate, "Unreadable");
  const query = `SELECT permit AS found FROM finalization_reconciliation
     WHERE tenant=$1 AND project=$2 AND verdict='Unreadable'
     ORDER BY reconciled_at LIMIT $3`;
  assert.deepEqual(await found(project, query), [permit]);
  await rig.as(
    `UPDATE finalization_reconciliation
        SET verdict='NotPromoted', observed_commit=$4, reconciled_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      finalizerCommit(),
    ],
  );
  assert.deepEqual(await found(project, query), []);
});

test("recovery finds the claims past their expiry, and no claim still running", async () => {
  const project = await finalizerProject(rig, "recover-lapse");
  await finalizerClaim(rig, project, finalizerIdentity("owner-lapse"));
  const query = `SELECT request AS found FROM finalization_request
     WHERE tenant=$1 AND project=$2 AND claim_owner IS NOT NULL
       AND claim_expires_at < now() ORDER BY claim_expires_at LIMIT $3`;
  assert.deepEqual(await found(project, query), []);
  await rig.as(
    `UPDATE finalization_request SET claim_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.deepEqual(await found(project, query), [project.request]);
});

test("recovery finds the live claims under a stale epoch, and none under the current one", async () => {
  const project = await finalizerProject(rig, "recover-epoch");
  await finalizerClaim(rig, project, finalizerIdentity("owner-epoch"));
  const query = `SELECT request AS found FROM finalization_request
     WHERE tenant=$1 AND project=$2 AND claim_owner IS NOT NULL
       AND recovery_epoch IS DISTINCT FROM $4 LIMIT $3`;
  assert.deepEqual(await found(project, query, [project.epoch]), []);
  assert.deepEqual(await found(project, query, [`${project.epoch}-later`]), [
    project.request,
  ]);
});

test("each relation carries exactly the indexes its recovery and its identities need", async () => {
  const held = (await rig.as(
    `SELECT tablename AS relation, indexname AS held FROM pg_indexes
      WHERE schemaname='public' AND tablename IN
        ('finalization_attempt','commit_permit','finalization_reconciliation',
         'project_repository','input_bundle','input_bundle_reference','native_action')
      ORDER BY tablename, indexname`,
  )) as readonly { relation: string; held: string }[];
  assert.deepEqual(
    held.map((row) => row.held),
    [
      "commit_permit_identity_is_never_reused",
      "commit_permit_is_one_per_attempt",
      "commit_permit_one_live",
      "commit_permit_pkey",
      "commit_permit_unconcluded",
      "finalization_attempt_by_request",
      "finalization_attempt_identity_is_never_reused",
      "finalization_attempt_pkey",
      "finalization_reconciliation_held",
      "finalization_reconciliation_pkey",
      "input_bundle_is_referenceable",
      "input_bundle_pkey",
      "input_bundle_reference_is_declared_once",
      "input_bundle_reference_pkey",
      "native_action_approves_an_attempt_once",
      "native_action_effect_is_materialized_once",
      "native_action_one_open",
      "native_action_pkey",
      "project_repository_is_exclusive",
      "project_repository_is_referenceable",
      "project_repository_pkey",
    ],
  );
  assert.deepEqual(
    await rig.as(
      `SELECT indexname AS held FROM pg_indexes
        WHERE schemaname='public' AND tablename='finalization_request'
          AND indexname IN ('finalization_request_claimable',
            'finalization_request_claim_expiry','finalization_request_epoch',
            'finalization_request_one_live','finalization_request_one_open')
        ORDER BY indexname`,
    ),
    [
      { held: "finalization_request_claim_expiry" },
      { held: "finalization_request_claimable" },
      { held: "finalization_request_epoch" },
      { held: "finalization_request_one_live" },
    ],
  );
});

test("the bindings and bundles hold no column any unfinished work could be found by", async () => {
  assert.deepEqual(
    await rig.as(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name IN ('project_repository','input_bundle','input_bundle_reference')
          AND column_name IN
            ('state','claim_owner','claim_expires_at','lease_expires_at','verdict',
             'outcome','terminal_at','concluded_at')`,
    ),
    [],
  );
});

/** Two forges, each holding one of the project's repositories, keyed by its host. */
const finalizerForges: readonly ForgeRepositoryBinding[] = [
  {
    binding: {
      forge: asForgeBindingId("forge-one"),
      credential: asForgeCredentialReference("credential-one"),
    },
    repositoryHost: "forge-one.example",
  },
  {
    binding: {
      forge: asForgeBindingId("forge-two"),
      credential: asForgeCredentialReference("credential-two"),
    },
    repositoryHost: "forge-two.example",
  },
];

/**
 * A second ticket of the same project working in a repository of its own. The
 * fixture history authors one ticket, so the draft, the brief that names the
 * repository and the request a finalizer would claim are written here.
 */
async function finalizerSibling(
  project: FinalizerProject,
  repository: string,
): Promise<FinalizerProject> {
  const ticket = project.ticket + 1;
  const keys = [project.partition.tenant, project.partition.project, ticket];
  await rig.harness.query(
    `INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision)
     VALUES ($1,$2,$3,1,'Released',$4)`,
    [...keys, project.configurationRevision],
  );
  await rig.harness.query(
    `INSERT INTO draft_brief (tenant,project,ticket,intent,repository)
     VALUES ($1,$2,$3,'Work the sibling repository.',$4)`,
    [...keys, repository],
  );
  const request = `${project.authorizingSeq}:1:RunFinalizer`;
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,
        ticket_version,request_generation,kind)
     VALUES ($1,$2,$4,$5,1,$3,$5,1,'RunFinalizer')`,
    [...keys, request, project.authorizingSeq],
  );
  return { ...project, ticket, request };
}

test("two tickets of one project each finalize in the repository their brief names", async () => {
  const worked = "https://forge-one.example/worked.git";
  const sibling = "https://forge-two.example/sibling.git";
  const project = await finalizerProject(rig, "sibling-repository", worked);
  const bound = await rig.harness.query(
    `SELECT ${repositoryBindingWriteFunction}($1,$2,$3,$4,$5,$6,$7) AS result`,
    [
      project.partition.tenant,
      project.partition.project,
      sibling,
      project.epoch,
      finalizerIdentity("operation-sibling-repository"),
      "Administrator",
      "test-operator",
    ],
  );
  assert.deepEqual(bound, [{ result: "Bound" }]);
  const other = await finalizerSibling(project, sibling);
  const store = postgresFinalizer(rig.pool);
  const views = [];
  for (const [each, owner] of [
    [project, "owner-sibling-worked"],
    [other, "owner-sibling-other"],
  ] as const) {
    const claim = await finalizerClaim(rig, each, finalizerIdentity(owner));
    views.push((await store.durableView(claim))?.repository?.repository);
  }
  assert.deepEqual(views, [worked, sibling]);
  assert.deepEqual(
    views.map((each) =>
      each === undefined
        ? undefined
        : forgeBindingOf(finalizerForges, asRepositoryId(each))?.forge,
    ),
    ["forge-one", "forge-two"],
  );
});

/**
 * A project no operation has ever bound a repository to, with a ticket released
 * in it — the shape migration 82's backfill leaves a brief in where its own
 * project binds nothing, written by hand because the release door refuses that
 * shape today. The journal entry is fabricated rather than replayed, as
 * `nativeActionFixture.ts` already does for a desk task's own fence, and
 * `brief: false` omits the brief row entirely, for the shape a ticket released
 * before migration 42 created `draft_brief` still carries.
 */
async function finalizerUnboundTicket(
  label: string,
  options: { readonly brief?: boolean } = {},
): Promise<{ partition: Partition; request: string; ticket: number }> {
  const partition = await postgresHarnessProject(rig.harness.store, label);
  const submission = postgresHarnessSubmission(partition, label);
  await rig.harness.inbox.accept(submission);
  const epoch = await rig.harness.store.currentRecoveryEpoch();
  const ticket = 1;
  const request = `request-${label}`;
  const seeding = await rig.harness.begin();
  await seeding.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES ($1,$2,1,'{}',$3,'genesis','owner',1,$4,'Operation',$5)`,
    [
      partition.tenant,
      partition.project,
      `digest-${label}`,
      epoch,
      submission.operation,
    ],
  );
  await seeding.query(
    `UPDATE decision_input SET state='Journaled', decided_seq=1, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$3`,
    [partition.tenant, partition.project, submission.operation],
  );
  await seeding.query(
    `INSERT INTO configuration_revision
       (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES ($1,$2,$3,'{}',$4,'Test','migration')`,
    [
      partition.tenant,
      partition.project,
      `revision-${label}`,
      `digest-config-${label}`,
    ],
  );
  await seeding.query(
    `INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision)
     VALUES ($1,$2,$3,1,'Released',$4)`,
    [partition.tenant, partition.project, ticket, `revision-${label}`],
  );
  if (options.brief !== false) {
    await seeding.query(
      `INSERT INTO draft_brief (tenant,project,ticket,intent)
       VALUES ($1,$2,$3,'a ticket released before this project ever bound a repository')`,
      [partition.tenant, partition.project, ticket],
    );
  }
  await seeding.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,
        ticket_version,request_generation,kind)
     VALUES ($1,$2,$3,1,0,$4,1,1,'RunFinalizer')`,
    [partition.tenant, partition.project, request, ticket],
  );
  await seeding.commit();
  return { partition, request, ticket };
}

/** The durable view a fresh claim on `finalizerUnboundTicket`'s request gathers. */
async function finalizerUnboundView(
  label: string,
  partition: Partition,
  request: string,
  ticket: number,
): Promise<FinalizationView | undefined> {
  const claim: FinalizationClaim = {
    partition,
    request,
    ticket: asTicketId(ticket),
    authorizingSeq: 1,
    requestGeneration: 1,
    claimGeneration: 0,
    state: "Open",
    kind: "RunFinalizer",
    recoveryEpoch: asRecoveryEpoch(
      await rig.harness.store.currentRecoveryEpoch(),
    ),
    owner: asFinalizerOwnerId(`owner-${label}`),
  };
  return postgresFinalizer(rig.pool).durableView(claim);
}

test("a released ticket in a partition with no binding at all holds its finalization view honestly unbound", async () => {
  const label = "unbound-partition";
  const { partition, request, ticket } = await finalizerUnboundTicket(label);
  const view = await finalizerUnboundView(label, partition, request, ticket);
  assert.equal(view?.repository, undefined);
});

test("a released ticket with no brief row at all still holds a finalization view", async () => {
  const label = "unbound-partition-briefless";
  const { partition, request, ticket } = await finalizerUnboundTicket(label, {
    brief: false,
  });
  const view = await finalizerUnboundView(label, partition, request, ticket);
  assert.notEqual(view, undefined);
  assert.equal(view?.repository, undefined);
});
