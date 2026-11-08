/**
 * Why a thread was woken without its owner typing: a closed roster, so a wake
 * names a reason rather than carrying a payload. It is a contract because a
 * console words each reason for the member.
 */
export const allThreadWakeReasons = [
  "TicketRefused",
  "RefusalLifted",
  "DraftDeleted",
  "TicketEscalated",
  "TicketCompleted",
  "TicketAbandoned",
] as const;
export type ThreadWakeReason = (typeof allThreadWakeReasons)[number];
