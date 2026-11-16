/**
 * Why a thread was woken without its owner typing: a closed roster, so a wake
 * names a reason rather than carrying a payload. It is a contract because a
 * console words each reason for the member.
 *
 * It is two rosters joined. A ticket's change row wakes the thread its draft
 * was filed from for one of the first; a thread's own attempt on its member's
 * chat host wakes it for one of the second, about a job, a watch or a timer
 * that thread set.
 *
 * A TICKET WAKE REACHES A THREAD ONLY WHERE ITS SETTING IS `On`: the thread's
 * own choice where it made one, else its member's chat host's setting as that
 * host last named it on a poll, else `Off`. A ticket wake that does not reach
 * its thread is not kept for later. The job wakes ask no setting.
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
 * `AttemptEnded` is a new attempt's restore having found jobs that were running
 * and that it did not start again, because they were not started with
 * `restart`. It names those jobs; a restore that only restarted jobs offers no
 * wake.
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

/** Whether ticket wakes reach a thread, as a thread chooses it and as a chat host names it. */
export const threadTicketWakeSettings = ["On", "Off"] as const;
export type ThreadTicketWakeSetting = (typeof threadTicketWakeSettings)[number];

/** A thread's own choice and its member's chat host's setting, each absent where none was made. */
export interface ThreadTicketWakes {
  readonly thread?: ThreadTicketWakeSetting;
  readonly host?: ThreadTicketWakeSetting;
}

/** The setting a thread's ticket wakes follow: its own choice, else its host's, else `Off`. */
export function threadTicketWakesEffective(
  wakes: ThreadTicketWakes,
): ThreadTicketWakeSetting {
  return wakes.thread ?? wakes.host ?? "Off";
}
