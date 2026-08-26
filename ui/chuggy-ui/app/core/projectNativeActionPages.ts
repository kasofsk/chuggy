/**
 * The project's open native actions as the inbox holds them, and what a page or
 * a live frame does to that list.
 *
 * The whole list is gathered on the read rather than a page at a time, because
 * an open action is a question addressed to a person and a reader who cannot
 * see one has no way to know it is there. Two bounds hold that: the pages one
 * read will ask for, and the rows this list will carry at once. Where the wire
 * still has more, the cursor survives the walk and is what tells the badge its
 * number is short.
 *
 * A FRAME REPLACES A TICKET'S ACTIONS RATHER THAN MERGING THEM. The
 * representation is the per-ticket read's own body, so it is the whole truth
 * about that ticket's open questions and an empty one is how an answered action
 * leaves. That is also what makes folding a frame twice land where folding it
 * once does, which the shell and the inbox screen both rely on.
 */

import { ticketNativeActionsResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  ProjectNativeActionResponse,
  ProjectNativeActionsResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

export const projectNativeActionPagesMax = 8;
export const projectNativeActionRowsMax = 200;

export interface ProjectNativeActionRows {
  readonly actions: readonly ProjectNativeActionResponse[];
  readonly nextCursor: string | undefined;
  readonly pagesRead: number;
  readonly failure: string | undefined;
}

export const projectNativeActionRowsEmpty: ProjectNativeActionRows = {
  actions: [],
  nextCursor: undefined,
  pagesRead: 0,
  failure: undefined,
};

/** The order the read gave, with an action already held kept where it is: a
 * page that repeats one must not list it twice. */
function projectNativeActionRowsMerged(
  held: readonly ProjectNativeActionResponse[],
  arriving: readonly ProjectNativeActionResponse[],
): readonly ProjectNativeActionResponse[] {
  const seen = new Set(held.map((action) => action.action));
  const merged = [...held];
  for (const action of arriving) {
    if (seen.has(action.action)) continue;
    if (merged.length >= projectNativeActionRowsMax) break;
    seen.add(action.action);
    merged.push(action);
  }
  return merged;
}

export function projectNativeActionRowsAppend(
  previous: ProjectNativeActionRows,
  page: ProjectNativeActionsResponse,
): ProjectNativeActionRows {
  return {
    actions: projectNativeActionRowsMerged(previous.actions, page.actions),
    nextCursor: page.nextCursor,
    pagesRead: previous.pagesRead + 1,
    failure: undefined,
  };
}

export function projectNativeActionRowsHaveMore(
  rows: ProjectNativeActionRows,
): boolean {
  return (
    rows.nextCursor !== undefined &&
    rows.pagesRead < projectNativeActionPagesMax &&
    rows.actions.length < projectNativeActionRowsMax
  );
}

/**
 * The walk to either bound, or to the page the wire stops at. A refusal keeps
 * the actions already gathered and records why; only a first page that will not
 * read is answered with the refusal itself, because a list holding nothing has
 * nothing to say instead.
 */
export async function projectNativeActionRowsRead(
  readPage: (
    cursor: string | undefined,
  ) => Promise<ApiResult<ProjectNativeActionsResponse>>,
): Promise<ApiResult<ProjectNativeActionRows>> {
  let rows = projectNativeActionRowsEmpty;
  for (let page = 0; page < projectNativeActionPagesMax; page += 1) {
    const answered = await readPage(
      rows.pagesRead === 0 ? undefined : rows.nextCursor,
    );
    if (answered.outcome !== "Ok") {
      if (rows.pagesRead === 0) return answered;
      return {
        outcome: "Ok",
        value: { ...rows, failure: panelReason(answered) },
      };
    }
    rows = projectNativeActionRowsAppend(rows, answered.value);
    if (!projectNativeActionRowsHaveMore(rows)) break;
  }
  return { outcome: "Ok", value: rows };
}

function projectNativeActionRowsWithout(
  rows: ProjectNativeActionRows,
  ticket: number,
): readonly ProjectNativeActionResponse[] {
  return rows.actions.filter((action) => action.ticket !== ticket);
}

/**
 * A `NativeAction` frame folded in. The resource is the ticket and a null
 * representation is its tombstone; anything the per-ticket read's schema
 * rejects leaves the list alone, because a list that cannot read a frame is
 * better stale than wrong.
 */
export function projectNativeActionRowsFold(
  previous: ProjectNativeActionRows | undefined,
  resource: string,
  representation: unknown,
): ProjectNativeActionRows | undefined {
  if (previous === undefined) return previous;
  const ticket = Number(resource);
  if (!Number.isSafeInteger(ticket) || ticket <= 0) return previous;
  const kept = projectNativeActionRowsWithout(previous, ticket);
  if (representation === null) return { ...previous, actions: kept };
  const read = ticketNativeActionsResponseSchema.safeParse(representation);
  if (!read.success) return previous;
  const arriving = read.data.actions.map((action) => ({ ticket, ...action }));
  return {
    ...previous,
    actions: [...arriving, ...kept].slice(0, projectNativeActionRowsMax),
  };
}
