/**
 * The inbox's entries grouped by what each asks a person, and where focus goes
 * when the item a reader was in leaves.
 *
 * AN ENTRY IS ONE ITEM IN ONE GROUP, so its answers stay together: an
 * evaluation approval it holds puts it with the approvals, else it is a
 * question — its phase's or an open escalation's. Each group keeps the read's
 * order, and a group with no entry is not drawn.
 */

import type { InboxEntryResponse } from "../../../../src/contract/responses.ts";

export const inboxGroupKinds = ["Approvals", "Questions"] as const;

export type InboxGroupKind = (typeof inboxGroupKinds)[number];

export interface InboxGroup {
  readonly kind: InboxGroupKind;
  readonly entries: readonly InboxEntryResponse[];
}

/** One item: the group it is drawn in and the ticket it is about. */
export interface InboxItem {
  readonly kind: InboxGroupKind;
  readonly ticket: number;
}

export function inboxEntryGroupKind(entry: InboxEntryResponse): InboxGroupKind {
  if (entry.actions.some((action) => action.kind === "EvaluationApproval"))
    return "Approvals";
  return "Questions";
}

/** The groups the entries make, in `inboxGroupKinds` order, an empty one left out. */
export function inboxGroups(
  entries: readonly InboxEntryResponse[],
): readonly InboxGroup[] {
  return inboxGroupKinds.flatMap((kind) => {
    const held = entries.filter((entry) => inboxEntryGroupKind(entry) === kind);
    return held.length === 0 ? [] : [{ kind, entries: held }];
  });
}

function inboxGroupOf(
  groups: readonly InboxGroup[],
  kind: InboxGroupKind,
): InboxGroup | undefined {
  return groups.find((group) => group.kind === kind);
}

export function inboxGroupsHold(
  groups: readonly InboxGroup[],
  item: InboxItem,
): boolean {
  return (
    inboxGroupOf(groups, item.kind)?.entries.some(
      (entry) => entry.ticket.ticket === item.ticket,
    ) === true
  );
}

export type InboxFocusTarget =
  | { readonly to: "Item"; readonly item: InboxItem }
  | { readonly to: "Group"; readonly kind: InboxGroupKind }
  | { readonly to: "Clear" };

/**
 * Where focus goes once `left` is no longer drawn: the next item after it in
 * its group that is still drawn, else its group's heading, else the first
 * group's heading, else the line saying the inbox is clear.
 */
export function inboxFocusAfter(
  before: readonly InboxGroup[],
  after: readonly InboxGroup[],
  left: InboxItem,
): InboxFocusTarget {
  if (inboxGroupsHold(after, left))
    throw new Error("the item focus is moved from is still drawn");
  const was = inboxGroupOf(before, left.kind)?.entries ?? [];
  const at = was.findIndex((entry) => entry.ticket.ticket === left.ticket);
  const next = was
    .slice(at + 1)
    .map((entry) => ({ kind: left.kind, ticket: entry.ticket.ticket }))
    .find((item) => inboxGroupsHold(after, item));
  if (next !== undefined) return { to: "Item", item: next };
  if (inboxGroupOf(after, left.kind) !== undefined)
    return { to: "Group", kind: left.kind };
  const first = after[0];
  return first === undefined
    ? { to: "Clear" }
    : { to: "Group", kind: first.kind };
}
