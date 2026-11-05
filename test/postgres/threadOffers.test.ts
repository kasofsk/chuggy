/**
 * Migration 120's step: a thread open before it keeps its roster, one opened
 * after it holds `ThreadOffer`, and a mailbox takes an `OfferReply` only
 * after it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import {
  postgresMigrate,
  postgresMigrateCompatible,
} from "../../src/adapters/postgres/pool.ts";
import { migrations } from "../../src/adapters/postgres/schema.ts";
import { migration120 } from "../../src/adapters/postgres/schema/migrations/120-thread-offers.ts";
import { migrationDatabase } from "./migrationHarness.ts";

/** The schema as it stood before 120, installed as a deployment holding only the migrations below it. */
async function threadOffersBefore(subject: pg.Pool): Promise<void> {
  const before = migrations
    .filter(({ version }) => version < migration120.version)
    .map(({ version, name }) => ({ version, name }));
  const contract = { required: before, compatible: before };
  assert.equal(
    (
      await postgresMigrateCompatible(subject, {
        current: contract,
        retainedPrevious: contract,
      })
    ).migrated,
    "Applied",
  );
}

/** The rosters of every thread, by principal. */
async function threadOffersRosters(
  subject: pg.Pool,
): Promise<readonly unknown[]> {
  return (
    await subject.query<{ principal: string; capabilities: string[] }>(
      `SELECT principal,capabilities FROM agent_session
        WHERE kind='Thread' ORDER BY principal`,
    )
  ).rows;
}

test("120 leaves an open thread's roster as it stood, a thread opened after it may offer, and a mailbox takes a reply to an offer", async () => {
  await migrationDatabase("thread_offers", async (subject) => {
    await threadOffersBefore(subject);
    await subject.query(`
      INSERT INTO tenant(tenant) VALUES('tenant-120');
      INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-120','project-120','Active');
      SELECT * FROM open_member_thread('tenant-120','project-120','principal-a',
        'session-120-a','key-120-a','slot-120','objectives-120')`);
    await assert.rejects(
      subject.query(
        `INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input,route)
         VALUES('tenant-120','project-120','session-120-a','turn-120-0',1,'OfferReply','declined','InCluster')`,
      ),
      /session_turn_kind_is_known/u,
    );
    assert.deepEqual(await postgresMigrate(subject), [migration120.version]);
    await subject.query(
      `SELECT * FROM open_member_thread('tenant-120','project-120','principal-b',
         'session-120-b','key-120-b','slot-120','objectives-120')`,
    );
    const opened = [
      "RepositoryRead",
      "RunCommands",
      "ProjectRead",
      "DraftAuthor",
      "DraftOriginate",
      "TicketDispatch",
    ];
    assert.deepEqual(await threadOffersRosters(subject), [
      { principal: "principal-a", capabilities: opened },
      {
        principal: "principal-b",
        capabilities: [...opened, "ThreadOffer"],
      },
    ]);
    await subject.query(
      `INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input,route)
       VALUES('tenant-120','project-120','session-120-b','turn-120-1',1,'OfferReply','declined','InCluster')`,
    );
    for (const [relation, refused, constraint] of [
      [
        "agent_session",
        `UPDATE agent_session SET capabilities=ARRAY['Unknown']::text[]
          WHERE session='session-120-a'`,
        "agent_session_capabilities_are_known",
      ],
      [
        "session_turn",
        `UPDATE session_turn SET input_kind='Unknown' WHERE turn='turn-120-1'`,
        "session_turn_kind_is_known",
      ],
    ] as const)
      await assert.rejects(
        subject.query(refused),
        new RegExp(constraint, "u"),
        relation,
      );
  });
});
