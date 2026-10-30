/**
 * What the new-ticket address says about where a ticket starts: from nothing,
 * from another ticket it duplicates, or on a draft the project already holds,
 * which its submit releases.
 *
 * A draft named beside a ticket to duplicate wins, because the draft is what
 * a submit would write to and the duplicate only what a form is seeded from.
 */

export interface TicketCreationQuery {
  readonly from?: number;
  readonly draft?: number;
}

function ticketCreationNumberOf(value: unknown): number | undefined {
  const read =
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value;
  return typeof read === "number" && Number.isSafeInteger(read) && read > 0
    ? read
    : undefined;
}

/** Where the address starts, read off the query the router parsed, which
 * hands a number back as one and a quoted one as text. */
export function ticketCreationQueryOf(
  search: Readonly<Record<string, unknown>>,
): TicketCreationQuery {
  const draft = ticketCreationNumberOf(search["draft"]);
  if (draft !== undefined) return { draft };
  const from = ticketCreationNumberOf(search["from"]);
  return from === undefined ? {} : { from };
}
