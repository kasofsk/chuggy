/**
 * The registry's own promises: the allowlist read whose absence is the refusal,
 * the operator's upsert, and the annex a ticket may or may not have.
 *
 * THE MISSING ANNEX IS A CASE, NOT A GAP. The arrival and its annex row are two
 * writes, so a ticket with no row is a state this store must be able to be in
 * and answer about; the map it hands back simply omits that ticket, and what
 * the board does with the omission is `test/adapters/httpApi.test.ts`'s.
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { registrySqlite } from "../../src/adapters/registrySqlite.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { Registry, TicketAnnex } from "../../src/interpreter/registry.ts";

/** A fresh registry over a database that lives only as long as the case does. */
function registrySubject(t: { after: (close: () => void) => void }): Registry {
  const database = new DatabaseSync(":memory:");
  t.after(() => {
    database.close();
  });
  return registrySqlite(database);
}

/** One annex, as an author would have written it at arrival. */
const registryAnnex: TicketAnnex = {
  title: "wire the desk",
  brief: "the face the fabric never sees",
  taskType: "code",
  author: "subject-1",
};

test("a subject the registry does not hold is absent, and absence is the refusal", async (t) => {
  const registry = registrySubject(t);
  assert.equal(await registry.userBySubject("nobody"), undefined);
});

test("an upsert writes the row, and a second one replaces what it held", async (t) => {
  const registry = registrySubject(t);
  await registry.upsertUser("subject-1", "Ada", false);
  assert.deepEqual(await registry.userBySubject("subject-1"), {
    subject: "subject-1",
    display: "Ada",
    admin: false,
  });
  await registry.upsertUser("subject-1", "Ada Lovelace", true);
  assert.deepEqual(await registry.userBySubject("subject-1"), {
    subject: "subject-1",
    display: "Ada Lovelace",
    admin: true,
  });
});

test("the annex is written under the ticket it annotates and read back whole", async (t) => {
  const registry = registrySubject(t);
  await registry.writeAnnex(asTicketId(2), registryAnnex);
  const annexes = await registry.annexes();
  assert.deepEqual(annexes.get(asTicketId(2)), registryAnnex);
  assert.equal(annexes.size, 1);
});

test("a ticket whose annex write never landed simply has no row", async (t) => {
  const registry = registrySubject(t);
  await registry.writeAnnex(asTicketId(1), registryAnnex);
  const annexes = await registry.annexes();
  assert.equal(annexes.has(asTicketId(1)), true);
  assert.equal(annexes.has(asTicketId(2)), false);
});

test("the annex of a draft left without one can be written again", async (t) => {
  const registry = registrySubject(t);
  assert.equal((await registry.annexes()).has(asTicketId(1)), false);
  await registry.writeAnnex(asTicketId(1), registryAnnex);
  await registry.writeAnnex(asTicketId(1), {
    ...registryAnnex,
    title: "wire the desk, again",
  });
  assert.equal(
    (await registry.annexes()).get(asTicketId(1))?.title,
    "wire the desk, again",
  );
});
