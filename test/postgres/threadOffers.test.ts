/**
 * Migrations 120 and 121, each a step of its own: a thread open before 120
 * keeps its roster, one opened after it holds `ThreadOffer`, and a mailbox
 * takes an `OfferReply` only after it; after 121 the member's own door puts
 * one there and nobody else's thread takes it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { postgresMigrateCompatible } from "../../src/adapters/postgres/pool.ts";
import { runtimeSchemaContract } from "../../src/adapters/postgres/runtimeSchema.ts";
import { migrations } from "../../src/adapters/postgres/schema.ts";
import { migration120 } from "../../src/adapters/postgres/schema/migrations/120-thread-offers.ts";
import { migration121 } from "../../src/adapters/postgres/schema/migrations/121-thread-offer-replies.ts";
import { migrationDatabase } from "./migrationHarness.ts";

/** The schema as a deployment holding only the migrations through `last` has it, and the versions this applied. */
async function threadOffersThrough(
  subject: pg.Pool,
  last: number,
): Promise<readonly number[]> {
  const through = migrations
    .filter(({ version }) => version <= last)
    .map(({ version, name }) => ({ version, name }));
  const contract = runtimeSchemaContract(through);
  const migrated = await postgresMigrateCompatible(subject, {
    current: contract,
    retainedPrevious: contract,
  });
  assert.equal(migrated.migrated, "Applied");
  return migrated.migrated === "Applied" ? migrated.versions : [];
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
    await threadOffersThrough(subject, migration120.version - 1);
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
    assert.deepEqual(await threadOffersThrough(subject, migration120.version), [
      migration120.version,
    ]);
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

/** One reply through the member's door, as the API role calls it. */
async function threadOfferReplied(
  subject: pg.Pool,
  principal: string,
  turn: string,
): Promise<unknown> {
  return (
    await subject.query<{ enqueued: string; session: string | null }>(
      `SELECT enqueued,session FROM enqueue_thread_offer_reply(
         'tenant-121','project-121',$1,'session-121-a',$2,'{"version":1}','InCluster')`,
      [principal, turn],
    )
  ).rows[0];
}

test("121 gives a member a door that puts an OfferReply in their own open thread, and no one else's", async () => {
  await migrationDatabase("thread_offer_replies", async (subject) => {
    await threadOffersThrough(subject, migration121.version - 1);
    await subject.query(`
      INSERT INTO tenant(tenant) VALUES('tenant-121');
      INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-121','project-121','Active');
      SELECT * FROM open_member_thread('tenant-121','project-121','principal-a',
        'session-121-a','key-121-a','slot-121','objectives-121')`);
    await assert.rejects(
      threadOfferReplied(subject, "principal-a", "turn-121-0"),
      /enqueue_thread_offer_reply/u,
    );
    assert.deepEqual(await threadOffersThrough(subject, migration121.version), [
      migration121.version,
    ]);
    assert.deepEqual(
      await threadOfferReplied(subject, "principal-b", "turn-121-1"),
      { enqueued: "NotYourThread", session: "session-121-a" },
    );
    assert.deepEqual(
      await threadOfferReplied(subject, "principal-a", "turn-121-1"),
      { enqueued: "Enqueued", session: "session-121-a" },
    );
    assert.deepEqual(
      await threadOfferReplied(subject, "principal-a", "turn-121-1"),
      { enqueued: "AlreadyEnqueued", session: "session-121-a" },
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT turn,input_kind,input FROM session_turn
            WHERE session='session-121-a'`,
        )
      ).rows,
      [
        {
          turn: "turn-121-1",
          input_kind: "OfferReply",
          input: '{"version":1}',
        },
      ],
    );
  });
});
