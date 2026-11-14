/**
 * Why a thread was woken without its owner typing: a closed roster, so a wake
 * names a reason rather than carrying a payload. It is a contract because a
 * console words each reason for the member.
 *
 * It is two rosters joined. A ticket's change row wakes the thread its draft
 * was filed from for one of the first; a thread's own attempt on its member's
 * chat host wakes it for one of the second, about a job, a watch or a timer
 * that thread set.
 */
export const allThreadTicketWakeReasons = [
  "TicketRefused",
  "RefusalLifted",
  "DraftDeleted",
  "TicketEscalated",
  "TicketCompleted",
  "TicketAbandoned",
] as const;
export type ThreadTicketWakeReason =
  (typeof allThreadTicketWakeReasons)[number];

/**
 * `AttemptEnded` is a new attempt having restored the thread's jobs: it names
 * what ended them, because the restore is the same jobs started again and the
 * thread did not end them itself.
 */
export const allThreadJobWakeReasons = [
  "JobExited",
  "WatchMatched",
  "TimerDue",
  "AttemptEnded",
] as const;
export type ThreadJobWakeReason = (typeof allThreadJobWakeReasons)[number];

export const allThreadWakeReasons = [
  ...allThreadTicketWakeReasons,
  ...allThreadJobWakeReasons,
] as const;
export type ThreadWakeReason = (typeof allThreadWakeReasons)[number];
