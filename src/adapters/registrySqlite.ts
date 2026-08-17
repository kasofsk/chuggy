/**
 * The registry over SQLite: the allowlist of admitted subjects, and the ticket
 * annex, in two tables this adapter creates and solely owns.
 *
 * THE ANNEX IS KEYED BY THE TICKET AND NOTHING ELSE. The dense id the arrival
 * grew is the key, so the join the board performs is a lookup rather than a
 * search, and a ticket with no row is a ticket whose annex write has not landed
 * — which is the state a crash between the two writes leaves and which the
 * board is written to render.
 *
 * IT IS NOT WELDED TO THE JOURNAL. Both stores can share one database file and
 * in this deployment they do, but nothing here opens a transaction spanning a
 * journal append. A transaction across the two would make this store a party to
 * the machine's own decision — a second writer of the book Single writer says
 * has one — so the seam stays open and what a crash inside it leaves is a draft
 * anyone can see and its author can write again, which is the cheaper of the
 * two failures.
 *
 * NO TABLE HOLDS WHAT THE CORE DERIVES. Phase, budgets, deps and program are
 * the machine's and are read from the live core at render time; what is stored
 * here is exactly what no decider has an opinion about.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

import { asTicketId, type TicketId } from "../domain/ids.ts";
import type {
  Registry,
  RegistryUser,
  TicketAnnex,
} from "../interpreter/registry.ts";

/** The two tables this adapter creates and owns; `admin` is a flag because STRICT has no boolean of its own. */
const registrySqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    subject TEXT PRIMARY KEY,
    display TEXT NOT NULL,
    admin INTEGER NOT NULL CHECK (admin IN (0, 1))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS ticket_annex (
    ticket INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    brief TEXT NOT NULL,
    task_type TEXT NOT NULL,
    author TEXT NOT NULL
  ) STRICT;
`;

/** Reads one stored user row, coercing at this boundary because a column another writer left untyped arrives here. */
function registrySqliteUser(
  select: StatementSync,
  subject: string,
): RegistryUser | undefined {
  const row = select.get(subject);
  if (row === undefined) return undefined;
  return {
    subject: String(row["subject"]),
    display: String(row["display"]),
    admin: Number(row["admin"]) === 1,
  };
}

/** Reads every annex row into the map the board joins against the core. */
function registrySqliteAnnexes(
  select: StatementSync,
): ReadonlyMap<TicketId, TicketAnnex> {
  const annexes = new Map<TicketId, TicketAnnex>();
  for (const row of select.all()) {
    annexes.set(asTicketId(Number(row["ticket"])), {
      title: String(row["title"]),
      brief: String(row["brief"]),
      taskType: String(row["task_type"]),
      author: String(row["author"]),
    });
  }
  return annexes;
}

/** The registry over an open connection, whose two tables it creates here and owns alone. */
export function registrySqlite(db: DatabaseSync): Registry {
  db.exec(registrySqliteSchema);
  const selectUser = db.prepare(
    "SELECT subject, display, admin FROM users WHERE subject = ?",
  );
  const upsertUser = db.prepare(
    "INSERT INTO users (subject, display, admin) VALUES (?, ?, ?) ON CONFLICT (subject) DO UPDATE SET display = excluded.display, admin = excluded.admin",
  );
  const insertAnnex = db.prepare(
    "INSERT INTO ticket_annex (ticket, title, brief, task_type, author) VALUES (?, ?, ?, ?, ?) ON CONFLICT (ticket) DO UPDATE SET title = excluded.title, brief = excluded.brief, task_type = excluded.task_type, author = excluded.author",
  );
  const selectAnnexes = db.prepare(
    "SELECT ticket, title, brief, task_type, author FROM ticket_annex ORDER BY ticket",
  );
  return {
    userBySubject: (subject) =>
      Promise.resolve(registrySqliteUser(selectUser, subject)),
    upsertUser: (subject, display, admin) => {
      upsertUser.run(subject, display, admin ? 1 : 0);
      return Promise.resolve();
    },
    writeAnnex: (ticket, annex) => {
      insertAnnex.run(
        ticket,
        annex.title,
        annex.brief,
        annex.taskType,
        annex.author,
      );
      return Promise.resolve();
    },
    annexes: () => Promise.resolve(registrySqliteAnnexes(selectAnnexes)),
  };
}
