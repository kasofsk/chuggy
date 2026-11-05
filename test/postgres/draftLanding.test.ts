/**
 * Where a draft lands at the installed schema: the landing rosters, what the
 * draft doors default and refuse, and a released draft's version.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiRole,
  draftCreateFunction,
  draftReleaseFunction,
  draftReviseFunction,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { briefFinalizationDefault } from "../../src/interpreter/ticketBrief.ts";
import type pg from "pg";
import { encodeDraftAuthoring } from "../../src/interpreter/authoring.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  migratedDatabase,
  seedLandinglessBinding,
  createdProposingDraft,
  seedProposingBinding,
} from "./migrationHarness.ts";

test("a landing no roster names is refused by the column's own constraint", async () => {
  await migratedDatabase("i90roster", async (subject) => {
    await seedLandinglessBinding(subject);
    for (const mode of ["Push", "PullRequest", "PullRequestMerge"])
      await subject.query(
        `UPDATE project_repository SET landing_mode=$1
          WHERE tenant='tenant-90' AND project='project-90'`,
        [mode],
      );
    await assert.rejects(
      subject.query(
        `UPDATE project_repository SET landing_mode='Unknown'
          WHERE tenant='tenant-90' AND project='project-90'`,
      ),
      /project_repository_landing_mode_is_known/u,
      "the installed CHECK rejects an unknown landing mode",
    );
  });
});

async function createdUnboundDraft(subject: pg.Pool) {
  return (
    await subject.query<{ result: string }>(
      `SELECT result FROM ${draftCreateFunction}(
         'tenant-91','project-91','revision-91','digest-91',0,$1,
         NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],NULL,NULL,NULL,NULL,NULL,NULL,'User','author',NULL)`,
      [encodeDraftAuthoring(plainAuthoring)],
    )
  ).rows;
}

test("the draft door falls back to the landing this tree defaults to", async () => {
  assert.equal(briefFinalizationDefault.mode, "Push");
  await migratedDatabase("i91fallback", async (subject) => {
    await seedProposingBinding(subject);
    assert.deepEqual(await createdUnboundDraft(subject), [
      { result: "Created" },
    ]);
    assert.deepEqual(
      (
        await subject.query<{ finalization_mode: string }>(
          `SELECT finalization_mode FROM draft_brief`,
        )
      ).rows,
      [{ finalization_mode: briefFinalizationDefault.mode }],
    );
  });
});

test("the baseline's door refuses the brief its own resolution left with no head", async () => {
  await migratedDatabase("i91unbranched", async (subject) => {
    await seedProposingBinding(subject);

    assert.deepEqual(await createdProposingDraft(subject, null), [
      { result: "LandingUnbranched", ticket: null },
    ]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT ticket FROM draft WHERE tenant='tenant-91' AND project='project-91'`,
        )
      ).rows,
      [],
      "a refused brief mints no ticket",
    );
  });
});

test("a pull request may default its base but requires a distinct head", async () => {
  await migratedDatabase("i91pairing", async (subject) => {
    await seedProposingBinding(subject);

    const created = await createdProposingDraft(subject, "refs/heads/rt/work");
    assert.equal(created[0]?.result, "Created");
    for (const [written, why] of [
      ["branch=NULL", "names no branch to open from"],
      ["finalization_target=branch", "opens from its own base"],
    ] as const)
      await assert.rejects(
        subject.query(
          `UPDATE draft_brief SET ${written}
            WHERE tenant='tenant-91' AND project='project-91'`,
        ),
        /draft_brief_finalization_is_whole/u,
        `no pull request ${why}`,
      );
    await subject.query(
      `UPDATE draft_brief SET finalization_target='refs/heads/rt/landing'
        WHERE tenant='tenant-91' AND project='project-91'`,
    );
  });
});

/** A draft created through the door with `overrides` as the text it passes. */
async function createdOverriddenDraft(subject: pg.Pool, overrides: string) {
  return (
    await subject.query<{ result: string }>(
      `SELECT result FROM ${draftCreateFunction}(
         'tenant-91','project-91','revision-91','digest-91',0,$1,
         NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],'refs/heads/rt/work',
         NULL,NULL,'bound-91',$2,NULL,'User','author',NULL)`,
      [encodeDraftAuthoring(plainAuthoring), overrides],
    )
  ).rows;
}

test("a draft revision holds its overrides as one object, and a released definition is granted them by column", async () => {
  await migratedDatabase("overrides040", async (subject) => {
    await seedProposingBinding(subject);
    await assert.rejects(
      createdOverriddenDraft(subject, '["practices"]'),
      /draft_revision_overrides_is_bounded/u,
    );
    assert.deepEqual(
      await createdOverriddenDraft(subject, '{"practices":[]}'),
      [{ result: "Created" }],
    );
    assert.deepEqual(
      (
        await subject.query<{ overrides: unknown }>(
          "SELECT overrides FROM draft_revision",
        )
      ).rows,
      [{ overrides: { practices: [] } }],
    );
    for (const [role, privilege, held] of [
      [ticketServiceRole, "UPDATE", true],
      [apiRole, "SELECT", true],
      [apiRole, "UPDATE", false],
    ] as const)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_column_privilege($1,'ticket_definition','overrides',$2) AS granted",
            [role, privilege],
          )
        ).rows[0]?.granted,
        held,
        `${role} ${privilege}`,
      );
  });
});

test("a draft naming no landing lands where its repository lands, and a revision lands where it says", async () => {
  await migratedDatabase("draft_landing_mode", async (subject) => {
    await seedProposingBinding(subject);
    assert.deepEqual(
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${draftCreateFunction}(
             'tenant-91','project-91','revision-91','digest-91',0,$1,
             NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],'refs/heads/rt/work',
             NULL,NULL,'bound-91',NULL,NULL,'User','author',NULL)`,
          [encodeDraftAuthoring(plainAuthoring)],
        )
      ).rows,
      [{ result: "Created" }],
    );
    assert.deepEqual(
      (
        await subject.query<{ finalization_mode: string }>(
          "SELECT finalization_mode FROM draft_brief",
        )
      ).rows,
      [{ finalization_mode: "PullRequest" }],
      "the draft lands where its repository lands",
    );
    assert.deepEqual(
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${draftReviseFunction}(
             'tenant-91','project-91',1,1,'revision-91',$1,
             NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],'refs/heads/rt/work',
             'Push',NULL,'bound-91',NULL,NULL,'User','author')`,
          [encodeDraftAuthoring(plainAuthoring)],
        )
      ).rows,
      [{ result: "Revised" }],
    );
    assert.deepEqual(
      (
        await subject.query<{ finalization_mode: string }>(
          "SELECT finalization_mode FROM draft_brief",
        )
      ).rows,
      [{ finalization_mode: "Push" }],
      "the revision lands where it says",
    );
  });
});

/** The landing each roster has to take, and one neither may. */
const landingRosterRows: readonly (readonly [string, string, string])[] = [
  [
    "draft_brief_finalization_mode_is_known",
    "None",
    `UPDATE draft_brief SET finalization_mode='None'`,
  ],
  [
    "draft_brief_finalization_mode_is_known",
    "Nowhere",
    `UPDATE draft_brief SET finalization_mode='Nowhere'`,
  ],
  [
    "project_repository_landing_mode_is_known",
    "None",
    `UPDATE project_repository SET landing_mode='None'`,
  ],
  [
    "project_repository_landing_mode_is_known",
    "Nowhere",
    `UPDATE project_repository SET landing_mode='Nowhere'`,
  ],
];

test("both landing rosters take the mode that lands nothing and no other new one", async () => {
  await migratedDatabase("threedeletions_none", async (subject) => {
    await seedProposingBinding(subject);
    assert.deepEqual(
      await createdProposingDraft(subject, "refs/heads/rt/work"),
      [{ result: "Created", ticket: "1" }],
    );
    for (const [constraint, mode, written] of landingRosterRows)
      if (mode === "None")
        assert.equal(
          (await subject.query(written)).rowCount,
          1,
          `${constraint} takes ${mode}`,
        );
      else
        await assert.rejects(
          subject.query(written),
          new RegExp(constraint, "u"),
          `${constraint} refuses ${mode}`,
        );
  });
});

/** Revises draft 1 at the version expected, to the authoring given. */
async function updateRevised(
  subject: pg.Pool,
  expected: number,
  authoring: string,
): Promise<unknown> {
  return (
    await subject.query(
      `SELECT result, authoring_version::int AS version, state FROM ${draftReviseFunction}(
         'tenant-91','project-91',1,$1,'revision-91',$2,
         NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],'refs/heads/branch-91',
         NULL,NULL,'bound-91',NULL,NULL,'User','author')`,
      [expected, authoring],
    )
  ).rows;
}

/** Asks one fence about a draft at the version given, committing when told to. */
async function updateFenced(
  subject: pg.Pool,
  fence: string,
  expected: number,
  commit = false,
  ticket = 1,
): Promise<unknown> {
  return (
    await subject.query<{ matched: boolean }>(
      `SELECT ${fence}('tenant-91','project-91',$1,$2,'revision-91','digest-91',$3) AS matched`,
      [ticket, expected, commit],
    )
  ).rows[0]?.matched;
}

const updateFence = "update_draft_fenced";

/** Draft 1, revised once past its release: only the update fence commits it, and only at the version it is at. */
async function updateDraftCommitted(subject: pg.Pool): Promise<void> {
  assert.deepEqual(await updateReleasedAt(subject), { released: 1 });
  assert.equal(
    await updateFenced(subject, draftReleaseFunction, 2),
    false,
    "a release of a draft already released",
  );
  assert.equal(
    await updateFenced(subject, updateFence, 1),
    false,
    "a stale update",
  );
  assert.equal(await updateFenced(subject, updateFence, 2, true), true);
  assert.deepEqual(await updateReleasedAt(subject), { released: 2 });
  assert.equal(
    await updateFenced(subject, updateFence, 1, false, 2),
    false,
    "an update of a draft never released",
  );
}

async function updateReleasedAt(subject: pg.Pool): Promise<unknown> {
  return (
    await subject.query(
      `SELECT released_authoring_version::int AS released FROM draft
        WHERE tenant='tenant-91' AND project='project-91' AND ticket=1`,
    )
  ).rows[0];
}

test("a released draft reopens while its ticket is pending, at any dependencies", async () => {
  await migratedDatabase("update_draft", async (subject) => {
    await seedProposingBinding(subject);
    for (const ticket of ["1", "2"])
      assert.deepEqual(
        await createdProposingDraft(subject, "refs/heads/branch-91"),
        [{ result: "Created", ticket }],
      );
    const same = encodeDraftAuthoring(plainAuthoring);
    const moved = encodeDraftAuthoring({
      ...plainAuthoring,
      deps: new Set([2]),
    });
    assert.equal(
      await updateFenced(subject, updateFence, 1),
      false,
      "an unreleased draft",
    );
    assert.equal(
      await updateFenced(subject, draftReleaseFunction, 1, true),
      true,
    );
    assert.deepEqual(await updateReleasedAt(subject), { released: 1 });
    assert.deepEqual(
      await updateRevised(subject, 1, same),
      [{ result: "NotDraft", version: 1, state: "Released" }],
      "a released draft whose ticket nothing has projected",
    );
    await subject.query(
      `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
       VALUES('tenant-91','project-91',1,'Pending',1)`,
    );
    assert.deepEqual(
      await updateRevised(subject, 1, moved),
      [{ result: "Revised", version: 2, state: "Released" }],
      "a revision that moves the dependencies",
    );
    assert.deepEqual(await updateRevised(subject, 1, same), [
      { result: "Stale", version: 2, state: "Released" },
    ]);
    await updateDraftCommitted(subject);
    await subject.query(
      `UPDATE ticket_projection SET phase='Work'
        WHERE tenant='tenant-91' AND project='project-91' AND ticket=1`,
    );
    assert.deepEqual(
      await updateRevised(subject, 2, same),
      [{ result: "NotDraft", version: 2, state: "Released" }],
      "a released draft whose ticket has left Pending",
    );
  });
});

test("the draft's released version is one it has, and only a released draft has one", async () => {
  await migratedDatabase("update_draft_check", async (subject) => {
    await seedProposingBinding(subject);
    assert.deepEqual(
      await createdProposingDraft(subject, "refs/heads/branch-91"),
      [{ result: "Created", ticket: "1" }],
    );
    for (const [label, change] of [
      ["a draft released from no version", "state='Released'"],
      ["an unreleased draft naming a version", "released_authoring_version=1"],
      [
        "a released draft naming a version it never reached",
        "state='Released', released_authoring_version=2",
      ],
    ] as const)
      await assert.rejects(
        subject.query(`UPDATE draft SET ${change}`),
        /draft_release_names_its_version/u,
        label,
      );
  });
});

test("a draft lands Direct unless it is written Serialized, and the column refuses any other", async () => {
  await migratedDatabase("i115landing", async (subject) => {
    await seedProposingBinding(subject);
    const landings = async () =>
      (
        await subject.query<{ landing_policy: string }>(
          "SELECT landing_policy FROM draft_brief",
        )
      ).rows;
    assert.deepEqual(await createdUnboundDraft(subject), [
      { result: "Created" },
    ]);
    assert.deepEqual(await landings(), [{ landing_policy: "Direct" }]);
    const revise = async (landing: string) =>
      (
        await subject.query<{ result: string }>(
          `SELECT result FROM ${draftReviseFunction}(
             'tenant-91','project-91',1,1,'revision-91',$1,
             NULL,'Land it.','{}'::text[],'{}'::text[],'{}'::text[],NULL,
             NULL,NULL,NULL,NULL,NULL,'User','author',$2)`,
          [encodeDraftAuthoring(plainAuthoring), landing],
        )
      ).rows;
    assert.deepEqual(await revise("Serialized"), [{ result: "Revised" }]);
    assert.deepEqual(await landings(), [{ landing_policy: "Serialized" }]);
    await assert.rejects(
      subject.query(`UPDATE draft_brief SET landing_policy='Stacked'`),
      /draft_brief_landing_policy_is_known/u,
    );
  });
});
