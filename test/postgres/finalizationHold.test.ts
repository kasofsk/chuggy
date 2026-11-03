/**
 * A finalization held unavailable at the installed schema: the hold column, the
 * pass that records a hold, and the doors that weigh it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { allFinalizationHoldKinds } from "../../src/interpreter/finalizer.ts";
import { finalizationUnavailableKinds } from "../../src/contract/rosters.ts";
import type pg from "pg";
import {
  deletionJournalRow,
  deletionPartition,
  journalledRevocation,
  migratedDatabase,
  renamedAttemptFailed,
  renamedAttemptPrepared,
  renamedFinalization,
} from "./migrationHarness.ts";

test("the finalizer's door concludes at either spelling of the outcome it needs work under", async () => {
  for (const outcome of ["FinalizationFailed", "FinalizationNeedsWork"])
    await migratedDatabase("rename_finalizer", async (subject) => {
      await subject.query(
        `${deletionPartition}\n${renamedFinalization(renamedAttemptFailed)}`,
      );
      assert.deepEqual(
        (
          await subject.query(
            `SELECT result,operation FROM submit_finalization_result
               ('tenant-5','project-5','request-5','attempt-5',$1,'PreparationFailed',
                1,'epoch-5','operation-5','subject-5')`,
            [outcome],
          )
        ).rows,
        [{ result: "Submitted", operation: "operation-5" }],
        outcome,
      );
      assert.deepEqual(
        (
          await subject.query(
            "SELECT command_tag FROM operation WHERE operation='operation-5'",
          )
        ).rows,
        [{ command_tag: "ReportFinalizationResult" }],
        outcome,
      );
    });
  await migratedDatabase("rename_finalizer_refused", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${renamedFinalization(renamedAttemptFailed)}`,
    );
    await assert.rejects(
      subject.query(
        `SELECT result FROM submit_finalization_result
           ('tenant-5','project-5','request-5','attempt-5','FinalizationRefused',
            'PreparationFailed',1,'epoch-5','operation-5','subject-5')`,
      ),
      /is not one this boundary submits/u,
    );
  });
});

test("the approval door binds to a ticket the projection holds at the renamed phase", async () => {
  await migratedDatabase("rename_approval", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${renamedFinalization(renamedAttemptPrepared)};
       INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-5','project-5',1,'Finalization',1)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result,action FROM request_finalization_approval
             ('tenant-5','project-5','attempt-5','action-5','epoch-5')`,
        )
      ).rows,
      [{ result: "Requested", action: "action-5" }],
    );
  });
});

/** A claimed request with no attempt behind it, which is what a held pass leaves. */
const heldRequest = `${deletionJournalRow(1, journalledRevocation)};
  UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
  INSERT INTO finalization_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     request_generation,state,claim_owner,claim_generation,claim_expires_at,
     recovery_epoch,kind,work_cycle,finalization_generation)
  VALUES('tenant-5','project-5','request-5',1,0,1,1,1,'Registered','owner-5',1,
         now()+make_interval(secs=>60),'epoch-5','RunFinalizer',1,1)`;

/** The hold door, by the signature a privilege is asked about. */
const heldFunction =
  "record_finalization_hold(text,text,text,text,text,bigint,bigint,text)";

/** The kind the cases below hold a request at, and the one they move it to. */
const heldKind = "TargetUnreadable";

const heldOther = "ProposalDenied";

interface HeldRow {
  readonly hold_kind: string | null;
  readonly hold_passes: number;
  readonly held_since: Date | null;
}

/** A pool whose sessions act as one deployment role, so a grant is exercised rather than asked about. */
function heldRolePool(url: string, role: string): pg.Pool {
  const at = new URL(url);
  at.searchParams.set("options", `-c role=${role}`);
  return postgresPool(at.toString());
}

async function heldRecord(
  subject: pg.Pool,
  kind: string | null,
  claim: { readonly owner: string | null; readonly generation: number } = {
    owner: "owner-5",
    generation: 1,
  },
  request = "request-5",
): Promise<
  readonly { readonly result: string; readonly hold_passes: number }[]
> {
  return (
    await subject.query<{ result: string; hold_passes: number }>(
      `SELECT result,hold_passes FROM record_finalization_hold
         ('tenant-5','project-5',$1,$2,$3,$4,1,'epoch-5')`,
      [request, kind, claim.owner, claim.generation],
    )
  ).rows;
}

async function heldRow(subject: pg.Pool): Promise<HeldRow | undefined> {
  return (
    await subject.query<HeldRow>(
      "SELECT hold_kind,hold_passes,held_since FROM finalization_request WHERE request='request-5'",
    )
  ).rows[0];
}

/** When the hold began, at the server's own precision, which a `Date` truncates to the millisecond. */
async function heldSince(subject: pg.Pool): Promise<string | null | undefined> {
  return (
    await subject.query<{ held_since: string | null }>(
      "SELECT held_since::text AS held_since FROM finalization_request WHERE request='request-5'",
    )
  ).rows[0]?.held_since;
}

/** The members a roster check installs, read off the constraint the server holds. */
async function heldRosterOf(
  subject: pg.Pool,
  relation: string,
  constraint: string,
): Promise<readonly string[]> {
  const held = (
    await subject.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
        WHERE c.conrelid = $1::regclass AND c.conname = $2`,
      [relation, constraint],
    )
  ).rows[0]?.definition;
  assert.ok(held !== undefined, `${constraint} was not found`);
  return [...held.matchAll(/'([^']+)'::text/gu)].map((each) => each[1] ?? "");
}

test("the finalizer's door weighs the outcome it admits and refuses the name it has none of", async () => {
  await migratedDatabase("unavailable_outcomes", async (subject) => {
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result FROM submit_finalization_result
             ('tenant-5','project-5','request-5',NULL,'FinalizationResultUnavailable',
              '${heldKind}',1,'epoch-5','operation-5','subject-5')`,
        )
      ).rows,
      [{ result: "BindingMismatch" }],
      "the door weighs the outcome rather than refusing the name",
    );
    await assert.rejects(
      subject.query(
        `SELECT result FROM submit_finalization_result
           ('tenant-5','project-5','request-5',NULL,'FinalizationUnavailable',
            '${heldKind}',1,'epoch-5','operation-5','subject-5')`,
      ),
      /is not one this boundary submits/u,
    );
  });
});

test("the mailbox admits a kind exactly beside the outcome a held finalization reports, and no outcome off its roster", async () => {
  await migratedDatabase("unavailable_validator", async (subject) => {
    for (const [outcome, kind, admitted] of [
      ["FinalizationResultUnavailable", heldKind, true],
      ["FinalizationResultUnavailable", null, false],
      ["FinalizationNeedsWork", heldKind, false],
      ["FinalizationNeedsWork", null, true],
      ["FinalizationUnavailable", heldKind, false],
      ["FinalizationUnavailable", null, false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ admitted: boolean }>(
            "SELECT ticket_command_is_valid($1::jsonb) AS admitted",
            [
              JSON.stringify({
                version: 1,
                command: "SubmitFinalizationResult",
                request: "request-5",
                requestGeneration: 1,
                recoveryEpoch: "epoch-5",
                outcome,
                ...(kind === null ? {} : { kind }),
              }),
            ],
          )
        ).rows[0]?.admitted,
        admitted,
        `${outcome} carrying ${String(kind)}`,
      );
  });
});

test("the hold column is the roster's one home and refuses every kind a resume cannot clear", async () => {
  await migratedDatabase("unavailable_roster", async (subject) => {
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    const installed = await heldRosterOf(
      subject,
      "finalization_request",
      "finalization_request_hold_kind_is_known",
    );
    assert.deepEqual(
      [...installed],
      [...finalizationUnavailableKinds],
      "the installed roster matches the runtime, member for member and in order",
    );
    for (const kind of installed)
      assert.ok(
        allFinalizationHoldKinds.some((held) => held === kind),
        `${kind} is a hold the finalizer can reach`,
      );
    const staying = allFinalizationHoldKinds.filter(
      (kind) => !installed.includes(kind),
    );
    assert.ok(staying.length > 0, "a hold that stays a hold is left off");
    for (const kind of [...staying, "NoHoldAtAll"])
      await assert.rejects(
        subject.query(
          `UPDATE finalization_request
              SET hold_kind=$1,hold_passes=1,held_since=now()
            WHERE request='request-5'`,
          [kind],
        ),
        /finalization_request_hold_kind_is_known/u,
        kind,
      );
    for (const [kind, passes, since] of [
      [heldKind, 0, "now()"],
      [heldKind, 1, "NULL"],
      [null, 1, "NULL"],
    ] as const)
      await assert.rejects(
        subject.query(
          `UPDATE finalization_request
              SET hold_kind=$1,hold_passes=${String(passes)},held_since=${since}
            WHERE request='request-5'`,
          [kind],
        ),
        /finalization_request_hold_is_whole/u,
        `${String(kind)} at ${String(passes)}`,
      );
  });
});

test("a recorded hold counts its passes, restarts on another kind and clears on none", async () => {
  await migratedDatabase("unavailable_hold", async (subject) => {
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    assert.deepEqual(await heldRow(subject), {
      hold_kind: null,
      hold_passes: 0,
      held_since: null,
    });
    assert.deepEqual(await heldRecord(subject, heldKind), [
      { result: "Recorded", hold_passes: 1 },
    ]);
    const first = await heldRow(subject);
    const firstSince = await heldSince(subject);
    assert.equal(first?.hold_kind, heldKind);
    assert.ok(first?.held_since instanceof Date);
    assert.deepEqual(await heldRecord(subject, heldKind), [
      { result: "Recorded", hold_passes: 2 },
    ]);
    assert.deepEqual(await heldRow(subject), {
      hold_kind: heldKind,
      hold_passes: 2,
      held_since: first.held_since,
    });
    assert.deepEqual(await heldRecord(subject, heldOther), [
      { result: "Recorded", hold_passes: 1 },
    ]);
    const moved = await heldRow(subject);
    assert.equal(moved?.hold_kind, heldOther);
    assert.equal(moved?.hold_passes, 1);
    assert.notEqual(await heldSince(subject), firstSince);
    assert.deepEqual(await heldRecord(subject, null), [
      { result: "Recorded", hold_passes: 0 },
    ]);
    assert.deepEqual(await heldRow(subject), {
      hold_kind: null,
      hold_passes: 0,
      held_since: null,
    });
    await assert.rejects(
      heldRecord(subject, "ApprovalDeclined"),
      /finalization_request_hold_kind_is_known/u,
    );
  });
});

test("the hold is recorded by the pass holding the claim and by nothing else", async () => {
  await migratedDatabase("unavailable_claim", async (subject) => {
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    assert.deepEqual(
      await heldRecord(
        subject,
        heldKind,
        { owner: "owner-5", generation: 1 },
        "request-6",
      ),
      [{ result: "UnknownRequest", hold_passes: null }],
    );
    for (const claim of [
      { owner: "owner-6", generation: 1 },
      { owner: "owner-5", generation: 2 },
      { owner: null, generation: 1 },
    ])
      assert.deepEqual(
        await heldRecord(subject, heldKind, claim),
        [{ result: "BindingMismatch", hold_passes: null }],
        JSON.stringify(claim),
      );
    assert.deepEqual(await heldRow(subject), {
      hold_kind: null,
      hold_passes: 0,
      held_since: null,
    });
    await subject.query(
      "UPDATE finalization_request SET claim_owner=NULL,claim_expires_at=NULL,recovery_epoch=NULL WHERE request='request-5'",
    );
    assert.deepEqual(await heldRecord(subject, heldKind), [
      { result: "BindingMismatch", hold_passes: null },
    ]);
  });
});

test("the door concludes unavailable on the recorded hold and on nothing else", async () => {
  for (const [label, recorded, attempt, kind, result] of [
    ["the kind the request is held at", heldKind, null, heldKind, "Submitted"],
    ["no hold at all", null, null, heldKind, "BindingMismatch"],
    ["neither a hold nor a kind", null, null, null, "BindingMismatch"],
    ["another kind", heldKind, null, heldOther, "BindingMismatch"],
    [
      "an attempt's own failure",
      heldKind,
      null,
      "PreparationFailed",
      "BindingMismatch",
    ],
    ["no kind at all", heldKind, null, null, "BindingMismatch"],
    [
      "an attempt beside it",
      heldKind,
      "attempt-5",
      heldKind,
      "BindingMismatch",
    ],
  ] as const)
    await migratedDatabase("unavailable_door", async (subject) => {
      await subject.query(`${deletionPartition}\n${heldRequest}`);
      if (recorded !== null) await heldRecord(subject, recorded);
      assert.deepEqual(
        (
          await subject.query(
            `SELECT result FROM submit_finalization_result
               ('tenant-5','project-5','request-5',$1,'FinalizationResultUnavailable',
                $2,1,'epoch-5','operation-5','subject-5')`,
            [attempt, kind],
          )
        ).rows,
        [{ result }],
        label,
      );
      if (result !== "Submitted") return;
      const written = (
        await subject.query<{ command_tag: string; command: string }>(
          "SELECT command_tag,command FROM operation WHERE operation='operation-5'",
        )
      ).rows[0];
      assert.equal(written?.command_tag, "ReportFinalizationResult");
      assert.deepEqual(JSON.parse(written.command), {
        version: 1,
        command: "SubmitFinalizationResult",
        request: "request-5",
        requestGeneration: 1,
        recoveryEpoch: "epoch-5",
        outcome: "FinalizationResultUnavailable",
        kind,
      });
      const kept = await heldRow(subject);
      assert.equal(kept?.hold_kind, heldKind);
      assert.equal(kept?.hold_passes, 1);
      assert.ok(
        kept.held_since instanceof Date,
        "the request keeps its evidence",
      );
    });
});

test("the finalizer records a hold the api role reads and cannot record itself", async () => {
  await migratedDatabase("unavailable_roles", async (subject, url) => {
    await subject.query(`${deletionPartition}\n${heldRequest}`);
    const finalizer = heldRolePool(url, finalizerRole);
    const api = heldRolePool(url, apiRole);
    try {
      assert.deepEqual(await heldRecord(finalizer, heldKind), [
        { result: "Recorded", hold_passes: 1 },
      ]);
      await assert.rejects(heldRecord(api, heldKind), /permission denied/u);
      assert.deepEqual(
        (
          await api.query(
            "SELECT hold_kind,hold_passes FROM finalization_request WHERE ticket=1",
          )
        ).rows,
        [{ hold_kind: heldKind, hold_passes: 1 }],
      );
      await assert.rejects(
        api.query("SELECT state FROM finalization_request"),
        /permission denied/u,
      );
    } finally {
      await finalizer.end();
      await api.end();
    }
    for (const [role, granted] of [
      [finalizerRole, true],
      [apiRole, false],
      ["public", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS granted",
            [role, heldFunction],
          )
        ).rows[0]?.granted,
        granted,
        role,
      );
    assert.equal(
      (
        await subject.query<{ owner: string }>(
          "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure",
          [heldFunction],
        )
      ).rows[0]?.owner,
      boundaryOwnerRole,
    );
  });
});

test("the approval door writes a desk task at no escalation", async () => {
  await migratedDatabase("escalation_approval", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${renamedFinalization(renamedAttemptPrepared)};
       INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-5','project-5',1,'Finalization',1)`,
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT result,action FROM request_finalization_approval
             ('tenant-5','project-5','attempt-5','action-5','epoch-5')`,
        )
      ).rows,
      [{ result: "Requested", action: "action-5" }],
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT escalation FROM native_action WHERE action='action-5'",
        )
      ).rows,
      [{ escalation: "NoEscalation" }],
    );
  });
});
