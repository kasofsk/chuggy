/**
 * What a finished task handed over, stored under that task's identity in one
 * table this face creates and solely owns.
 *
 * FIRST WRITE WINS, WHICH IS THE DOMAIN'S RULE RATHER THAN A NEW ONE.
 * `resolveTask` keeps the first completion of a task and ignores every repeat,
 * so a second declaration must leave the first body standing — otherwise the
 * journal and this table would disagree about what one task produced. The insert
 * ignores its conflict, so a re-delivery costs a row that already exists.
 *
 * THE VERDICT IS NOT HERE. It is the decision's own pick and the core carries it
 * on the task it resolved, so a column for it would be a stored duplicate of a
 * fact the machine derives (standing rule 3). Neither is the producing task of a
 * ticket's mark, which the journal determines.
 *
 * THE KIND AND THE PAYLOAD ARE TWO COLUMNS RATHER THAN ONE BLOB, so what the
 * table holds is legible at a SQL prompt and the constraint that a kind is one
 * this vocabulary names belongs to the storage rather than to a comment. The
 * write switches the vocabulary exhaustively, so a body added in
 * `src/interpreter/artifact.ts` stops this file compiling; the read is over
 * stored text, which is outside this process's control, and refuses what it does
 * not recognise instead of trusting it.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

import { assertNever } from "../../domain/assertNever.ts";
import { asTaskId, type TaskId, type TicketId } from "../../domain/ids.ts";
import type { ArtifactBody } from "../../interpreter/artifact.ts";
import type { Parsed } from "../../interpreter/wire.ts";

/** One stored body, under the task that declared it. */
export interface HttpApiArtifact {
  readonly task: TaskId;
  readonly body: ArtifactBody;
}

/** The bodies this deployment kept, keyed by the completing task's identity. */
export interface HttpApiArtifacts {
  /** Keeps this body under that task, leaving whatever an earlier delivery already wrote. */
  write(ticket: TicketId, taskId: TaskId, body: ArtifactBody): Promise<void>;

  /** The body one task declared, or nothing at all when this store kept none. */
  read(
    ticket: TicketId,
    taskId: TaskId,
  ): Promise<Parsed<ArtifactBody> | undefined>;

  /** Every body one ticket's tasks declared, in task order, refusing the lot when a row is not one this face writes. */
  forTicket(ticket: TicketId): Promise<Parsed<readonly HttpApiArtifact[]>>;
}

/** The one table this adapter creates and owns; the pair is the key because a body belongs to one task of one ticket. */
const httpApiArtifactSchema = `
  CREATE TABLE IF NOT EXISTS artifacts (
    ticket INTEGER NOT NULL,
    task INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('BGitRef', 'BNote', 'BNone')),
    payload TEXT NOT NULL,
    PRIMARY KEY (ticket, task)
  ) STRICT;
`;

/** The two columns one body becomes, switched over the vocabulary so a body added to it stops this file compiling. */
function httpApiArtifactColumns(body: ArtifactBody): readonly [string, string] {
  switch (body.body) {
    case "BGitRef":
      return [body.body, body.branch];
    case "BNote":
      return [body.body, body.text];
    case "BNone":
      return [body.body, ""];
    default:
      return assertNever(body);
  }
}

/** Reads a stored row back into the vocabulary, refusing a kind or an empty payload this face would never have written. */
function httpApiArtifactBody(
  kind: string,
  payload: string,
): Parsed<ArtifactBody> {
  switch (kind) {
    case "BGitRef":
      return payload === ""
        ? { parsed: "Refused", why: "a stored BGitRef names no branch" }
        : { parsed: "Ok", value: { body: "BGitRef", branch: payload } };
    case "BNote":
      return payload === ""
        ? { parsed: "Refused", why: "a stored BNote carries no text" }
        : { parsed: "Ok", value: { body: "BNote", text: payload } };
    case "BNone":
      return { parsed: "Ok", value: { body: "BNone" } };
    default:
      return { parsed: "Refused", why: `${kind} is no body this face stores` };
  }
}

/** One row's kind and payload as the columns hold them, coerced here because a column another writer left untyped arrives here. */
function httpApiArtifactRead(
  row: Readonly<Record<string, unknown>>,
): Parsed<ArtifactBody> {
  return httpApiArtifactBody(String(row["kind"]), String(row["payload"]));
}

/** Every row one ticket holds, refused whole where any one of them is not a body this face writes. */
function httpApiArtifactRows(
  select: StatementSync,
  ticket: TicketId,
): Parsed<readonly HttpApiArtifact[]> {
  const stored: HttpApiArtifact[] = [];
  for (const row of select.all(ticket)) {
    const body = httpApiArtifactRead(row);
    if (body.parsed === "Refused") return body;
    stored.push({ task: asTaskId(Number(row["task"])), body: body.value });
  }
  return { parsed: "Ok", value: stored };
}

/** The store over an open connection, whose one table it creates here and owns alone. */
export function httpApiArtifacts(db: DatabaseSync): HttpApiArtifacts {
  db.exec(httpApiArtifactSchema);
  const keep = db.prepare(
    "INSERT INTO artifacts (ticket, task, kind, payload) VALUES (?, ?, ?, ?) ON CONFLICT (ticket, task) DO NOTHING",
  );
  const selectOne = db.prepare(
    "SELECT kind, payload FROM artifacts WHERE ticket = ? AND task = ?",
  );
  const selectForTicket = db.prepare(
    "SELECT task, kind, payload FROM artifacts WHERE ticket = ? ORDER BY task",
  );
  return {
    write: (ticket, taskId, body) => {
      const [kind, payload] = httpApiArtifactColumns(body);
      keep.run(ticket, taskId, kind, payload);
      return Promise.resolve();
    },
    read: (ticket, taskId) => {
      const row = selectOne.get(ticket, taskId);
      return Promise.resolve(
        row === undefined ? undefined : httpApiArtifactRead(row),
      );
    },
    forTicket: (ticket) =>
      Promise.resolve(httpApiArtifactRows(selectForTicket, ticket)),
  };
}
